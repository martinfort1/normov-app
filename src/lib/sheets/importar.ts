/* Sube el contenido de un Libro (ver parsers.ts) a Supabase. Es idempotente: se puede llamar todas las veces que
   haga falta, no duplica. Lo usan tres caminos, con el mismo código:
     - el sync automático desde Google Sheets (src/app/api/sync/route.ts, con la service role key),
     - la importación de Excel desde la app (src/app/api/importar/route.ts, con la sesión del usuario: rige RLS),
     - el importador manual por línea de comandos (scripts/import-sheets.ts).
   Cada hoja se importa por separado (importarRemitos, importarCargas, importarMovProveedores, importarCheques). */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parsePrincipal, parseCtaClientes, parseClientesDiego, parseProveedores, parseCheques, parseCombustible,
  type Libro, type Unidad,
} from './parsers';
import { hasher, hasherSinRemito, partesMov, partesCheque, partesCarga, partesSinRemito } from './claves';

export interface ResultadoImport { n: number; mensaje: string }

const chunk = <T,>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const ok = <T,>(r: { data: T; error: { message: string } | null }, ctx: string): T => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
};

/** Columnas que agregó la migración 0006. Si el código nuevo corre antes que la migración, se reintenta sin ellas
 *  en vez de romper el sync (los datos de siempre entran igual; lo nuevo entra cuando se corra la migración). */
const COLUMNAS_NUEVAS = ['fecha_pago', 'precio_litro', 'cuit', 'foto_path', 'origen', 'creado_por', 'autor', 'creado'];
const faltaColumnaNueva = (msg: string) => /schema cache|does not exist|no existe/i.test(msg) && COLUMNAS_NUEVAS.some((c) => msg.includes(c));

type Fila = Record<string, unknown>;

/** Upsert por tandas. Todas las filas de una llamada tienen que traer las mismas columnas. */
async function upsertar(db: SupabaseClient, tabla: string, filas: Fila[], onConflict: string) {
  for (const part of chunk(filas)) {
    let r = await db.from(tabla).upsert(part, { onConflict });
    if (r.error && faltaColumnaNueva(r.error.message)) {
      const limpio = part.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !COLUMNAS_NUEVAS.includes(k))));
      r = await db.from(tabla).upsert(limpio, { onConflict });
    }
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
  }
}

async function idMap(db: SupabaseClient, table: string, keyCol: string, rows: Fila[], onConflict: string) {
  const map = new Map<string, string>();
  for (const part of chunk(rows)) {
    const data = (ok(await db.from(table).upsert(part, { onConflict }).select(`id,${keyCol}`), table) ?? []) as unknown as Record<string, string>[];
    for (const d of data) map.set(d[keyCol], d.id);
  }
  return map;
}

// ───────────── maestros: clientes, obras, materiales ─────────────
export interface Maestros { clientes: Map<string, string>; obras: Map<string, string>; materiales: Map<string, string> }
interface RefMaestro { razon: string | null; cliente: string | null; material: string | null; unidad: Unidad }

/** Crea los clientes / obras / materiales que falten y devuelve sus ids. */
export async function resolverMaestros(db: SupabaseClient, filas: RefMaestro[]): Promise<Maestros> {
  const razones = [...new Set(filas.map((r) => r.razon).filter((x): x is string => !!x))];
  const clientes = await idMap(db, 'clientes', 'razon_social', razones.map((razon_social) => ({ razon_social })), 'razon_social');

  const obraKeys = new Map<string, { cliente_id: string | null; nombre: string }>();
  for (const r of filas) {
    if (!r.cliente) continue;
    const cid = r.razon ? clientes.get(r.razon) ?? null : null;
    obraKeys.set(`${cid}|${r.cliente}`, { cliente_id: cid, nombre: r.cliente });
  }
  const obras = new Map<string, string>();
  for (const part of chunk([...obraKeys.values()])) {
    const data = (ok(await db.from('obras').upsert(part, { onConflict: 'cliente_id,nombre' }).select('id,cliente_id,nombre'), 'obras') ?? []) as { id: string; cliente_id: string | null; nombre: string }[];
    for (const o of data) obras.set(`${o.cliente_id}|${o.nombre}`, o.id);
  }

  const mats = new Map<string, string>();
  for (const r of filas) if (r.material) mats.set(r.material, r.unidad);
  const materiales = await idMap(db, 'materiales', 'nombre', [...mats].map(([nombre, unidad]) => ({ nombre, unidad })), 'nombre');
  return { clientes, obras, materiales };
}

export function idsMaestros(m: Maestros, r: Pick<RefMaestro, 'razon' | 'cliente' | 'material'>) {
  const cid = r.razon ? m.clientes.get(r.razon) ?? null : null;
  return {
    cliente_id: cid,
    obra_id: r.cliente ? m.obras.get(`${cid}|${r.cliente}`) ?? null : null,
    material_id: r.material ? m.materiales.get(r.material) ?? null : null,
  };
}

// ───────────── viajes (hoja PRINCIPAL) ─────────────
export async function importarRemitos(libro: Libro, db: SupabaseClient): Promise<ResultadoImport> {
  const rows = parsePrincipal(libro);
  const sinNumero = rows.filter((r) => !r.numero).length;

  // La clave es (número, fecha): el número de remito se reutiliza con el tiempo, no es un ID global.
  // Los viajes sin número (chofer no lo cargó, obra sin remito, etc.) igual se guardan: se les arma un
  // identificador estable a partir de sus propios datos ("SR-…"); en la interfaz se muestran como "(sin número)".
  // Si el archivo trae el ID de la app (exportado desde acá), la fila se identifica por ese ID: así se puede
  // cambiar el número o la fecha en Excel y reimportar sin duplicar.
  const generarSR = hasherSinRemito();
  type Conv = (typeof rows)[number] & { numero: string };
  const porClave = new Map<string, Conv>();
  const porId = new Map<string, Conv>();
  let repetidos = 0;
  for (const r of rows) {
    const numero = r.numero ?? generarSR(partesSinRemito(r));
    const fila: Conv = { ...r, numero };
    if (r.id) { porId.set(r.id, fila); continue; }
    const k = `${numero}|${r.fecha}`;
    if (porClave.has(k)) repetidos++;
    porClave.set(k, fila); // gana la última fila
  }
  const todas = [...porClave.values(), ...porId.values()];

  const maestros = await resolverMaestros(db, todas);
  const payload = (r: Conv) => ({
    numero: r.numero, fecha: r.fecha, ...idsMaestros(maestros, r),
    camion: r.camion, chofer: r.chofer, cantera: r.cantera,
    cantidad: r.cantidad, precio: r.precio, total: r.total, neto: r.neto, costo: r.costo,
  });
  await upsertar(db, 'remitos', [...porClave.values()].map(payload), 'numero,fecha');
  await upsertar(db, 'remitos', [...porId.entries()].map(([id, r]) => ({ id, ...payload(r) })), 'id');

  const mensaje = `Remitos: ${todas.length} importados (${sinNumero} sin número propio, guardados igual) · ${repetidos} repetidos (mismo número Y fecha) en la planilla.`;
  return { n: todas.length, mensaje };
}

async function reemplazarSaldos(db: SupabaseClient, fuente: string, saldos: { nombre: string; ventas: number; cobranzas: number; saldo: number }[]) {
  ok(await db.from('saldos_clientes_planilla').delete().eq('fuente', fuente), 'saldos (borrar)');
  const porNombre = new Map(saldos.map((s) => [s.nombre, s])); // clave (fuente, nombre) única
  for (const part of chunk([...porNombre.values()].map((s) => ({ fuente, ...s, capturado: new Date().toISOString() }))))
    ok(await db.from('saldos_clientes_planilla').insert(part), 'saldos');
}

/** Sync de la Planilla NORMOV 2026: viajes + saldos de clientes (hoja Cta Clientes). */
export async function importarPlanilla(libro: Libro, db: SupabaseClient): Promise<string> {
  const r = await importarRemitos(libro, db);
  const saldos = parseCtaClientes(libro);
  await reemplazarSaldos(db, 'cta_clientes', saldos);
  return `${r.mensaje} Saldos clientes (cta_clientes): ${saldos.length}.`;
}

// ───────────── proveedores (hoja Cta Cte Proveedores) ─────────────
export async function importarMovProveedores(libro: Libro, db: SupabaseClient): Promise<ResultadoImport> {
  const movs = parseProveedores(libro);
  const provs = await idMap(db, 'proveedores', 'nombre', [...new Set(movs.map((m) => m.proveedor))].map((nombre) => ({ nombre })), 'nombre');
  const hash = hasher();
  const filas = movs.map((m) => ({
    id: m.id,
    datos: {
      proveedor_id: provs.get(m.proveedor)!, fecha: m.fecha, centro_costo: m.centro || null, unidad_negocio: m.unidad || null,
      rubro: m.rubro || null, subrubro: m.subrubro || null, detalle: m.detalle || null, nro_factura: m.factura || null,
      debe: m.debe, haber: m.haber, forma_pago: m.forma || null, nro_cheque: m.cheque || null, observaciones: m.obs || null,
      fecha_pago: m.fechaPago, source_hash: hash(partesMov(m)),
    },
  }));
  await upsertar(db, 'movimientos_proveedor', filas.filter((f) => !f.id).map((f) => f.datos), 'source_hash');
  await upsertar(db, 'movimientos_proveedor', filas.filter((f) => f.id).map((f) => ({ id: f.id, ...f.datos })), 'id');
  return { n: filas.length, mensaje: `Movimientos de proveedores: ${filas.length}.` };
}

// ───────────── cheques (hoja Cheques) ─────────────
export async function importarCheques(libro: Libro, db: SupabaseClient): Promise<ResultadoImport> {
  const chq = parseCheques(libro);
  const hash = hasher();
  const filas = chq.map((c) => ({
    id: c.id,
    datos: {
      tipo: c.tipo, contraparte: c.contraparte || null, numero: c.numero || null, banco: c.banco || null, librador: c.librador || null,
      monto: c.monto, emision: c.emision, vencimiento: c.vto, estado: c.estado, endosado_a: c.endosado || null, observaciones: c.obs || null,
      cuit: c.cuit || null, source_hash: hash(partesCheque(c)), // el estado cambia: no entra en el hash
    },
  }));
  await upsertar(db, 'cheques', filas.filter((f) => !f.id).map((f) => f.datos), 'source_hash');
  await upsertar(db, 'cheques', filas.filter((f) => f.id).map((f) => ({ id: f.id, ...f.datos })), 'id');
  return { n: filas.length, mensaje: `Cheques: ${filas.length}.` };
}

/** Sync de NORMOV Diego 2026. Cada hoja se importa por separado: si una falla, las otras igual se actualizan.
 *  Si algo falló, al final se avisa con un error que dice qué hoja (así queda registrado en Sistema). */
export async function importarDiego(libro: Libro, db: SupabaseClient): Promise<string> {
  const partes: string[] = [];
  const fallas: string[] = [];
  const correr = async (nombre: string, fn: () => Promise<string>) => {
    try { partes.push(await fn()); }
    catch (e) { fallas.push(`${nombre}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  await correr('Saldos de clientes', async () => {
    const saldos = parseClientesDiego(libro);
    await reemplazarSaldos(db, 'clientes_diego', saldos);
    return `Saldos clientes (clientes_diego): ${saldos.length}.`;
  });
  await correr('Proveedores', async () => (await importarMovProveedores(libro, db)).mensaje);
  await correr('Cheques', async () => (await importarCheques(libro, db)).mensaje);

  if (fallas.length) throw new Error(`${fallas.join(' | ')}${partes.length ? ` (lo demás se importó: ${partes.join(' ')})` : ''}`);
  return partes.join(' ');
}

// ───────────── combustible (hoja Cargas) ─────────────
export async function importarCargas(libro: Libro, db: SupabaseClient): Promise<ResultadoImport> {
  const rows = parseCombustible(libro);
  const hash = hasher();
  const filas = rows.map((r) => ({
    id: r.id,
    datos: {
      fecha: r.fecha, remito: r.remito || null, patente: r.patente, es_camion: r.camion, litros: r.litros,
      tipo: r.tipo, estacion: r.estacion, chofer: r.chofer, precio_litro: r.precioLitro, source_hash: hash(partesCarga(r)),
    },
  }));
  await upsertar(db, 'cargas_combustible', filas.filter((f) => !f.id).map((f) => f.datos), 'source_hash');
  await upsertar(db, 'cargas_combustible', filas.filter((f) => f.id).map((f) => ({ id: f.id, ...f.datos })), 'id');
  return { n: filas.length, mensaje: `Cargas de combustible: ${filas.length}.` };
}

/** Sync de la Planilla Combustible. */
export async function importarCombustible(libro: Libro, db: SupabaseClient): Promise<string> {
  return (await importarCargas(libro, db)).mensaje;
}
