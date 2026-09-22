/* Sube el contenido de un Libro (ver parsers.ts) a Supabase. Usa la service role key: se salta RLS.
   Es idempotente: se puede llamar todas las veces que haga falta, no duplica.
   Lo llaman tanto scripts/import-sheets.ts (planillas .xlsx locales) como
   src/app/api/sync/route.ts (planilla en vivo, vía Apps Script). */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parsePrincipal, parseCtaClientes, parseClientesDiego, parseProveedores, parseCheques, parseCombustible, type Libro,
} from './parsers';

const chunk = <T,>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const ok = <T,>(r: { data: T; error: { message: string } | null }, ctx: string): T => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
};

/** Hash estable de la fila + n° de ocurrencia, para que filas idénticas legítimas no colisionen. */
function hasher() {
  const seen = new Map<string, number>();
  return (parts: unknown[]) => {
    const base = createHash('sha1').update(JSON.stringify(parts)).digest('hex');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}:${n}`;
  };
}

async function idMap(db: SupabaseClient, table: string, keyCol: string, rows: Record<string, unknown>[], onConflict: string) {
  const map = new Map<string, string>();
  for (const part of chunk(rows)) {
    const data = (ok(await db.from(table).upsert(part, { onConflict }).select(`id,${keyCol}`), table) ?? []) as unknown as Record<string, string>[];
    for (const d of data) map.set(d[keyCol], d.id);
  }
  return map;
}

export async function importarPlanilla(libro: Libro, db: SupabaseClient): Promise<string> {
  const rows = parsePrincipal(libro);
  const sinNumero = rows.filter((r) => !r.numero).length;
  // La clave es (número, fecha): el número de remito se reutiliza con el tiempo, no es un ID global.
  // Los viajes sin número (chofer no lo cargó, obra sin remito, etc.) igual se guardan: se les arma
  // un identificador estable a partir de sus propios datos ("SR-…"), para que no se pierdan ni se
  // dupliquen en cada sync. Se muestran como "(sin número)" en la interfaz (ver lib/format.ts) y no
  // entran como candidatos a certificar, porque un certificado necesita un número real que el cliente
  // pueda chequear contra su remito en papel.
  const generarSR = hasher();
  const byNum = new Map<string, (typeof rows)[number]>();
  let duplicados = 0;
  for (const r of rows) {
    const numero = r.numero ?? 'SR-' + generarSR([r.fecha, r.cliente, r.razon, r.material, r.cantidad, r.precio, r.camion, r.chofer, r.cantera]).slice(0, 12);
    const k = `${numero}|${r.fecha}`;
    if (byNum.has(k)) duplicados++;
    byNum.set(k, { ...r, numero }); // gana la última fila
  }
  const uniq = [...byNum.values()];

  const razones = [...new Set(uniq.map((r) => r.razon).filter((x): x is string => !!x))];
  const clientes = await idMap(db, 'clientes', 'razon_social', razones.map((razon_social) => ({ razon_social })), 'razon_social');

  const obraKeys = new Map<string, { cliente_id: string | null; nombre: string }>();
  for (const r of uniq) {
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
  for (const r of uniq) if (r.material) mats.set(r.material, r.unidad);
  const materiales = await idMap(db, 'materiales', 'nombre', [...mats].map(([nombre, unidad]) => ({ nombre, unidad })), 'nombre');

  const payload = uniq.map((r) => {
    const cid = r.razon ? clientes.get(r.razon) ?? null : null;
    return {
      numero: r.numero!, fecha: r.fecha, cliente_id: cid,
      obra_id: r.cliente ? obras.get(`${cid}|${r.cliente}`) ?? null : null,
      material_id: r.material ? materiales.get(r.material) ?? null : null,
      camion: r.camion, chofer: r.chofer, cantera: r.cantera,
      cantidad: r.cantidad, precio: r.precio, total: r.total, neto: r.neto, costo: r.costo, origen: 'planilla' as const,
    };
  });
  for (const part of chunk(payload)) ok(await db.from('remitos').upsert(part, { onConflict: 'numero,fecha' }), 'remitos');

  const saldos = parseCtaClientes(libro);
  await replaceSaldos(db, 'cta_clientes', saldos);

  return `Remitos: ${payload.length} importados (${sinNumero} sin número propio, guardados igual) · ${duplicados} repetidos (mismo número Y fecha) en la planilla. Saldos clientes (cta_clientes): ${saldos.length}.`;
}

async function replaceSaldos(db: SupabaseClient, fuente: string, saldos: { nombre: string; ventas: number; cobranzas: number; saldo: number }[]) {
  ok(await db.from('saldos_clientes_planilla').delete().eq('fuente', fuente), 'saldos (borrar)');
  const byName = new Map(saldos.map((s) => [s.nombre, s])); // clave (fuente, nombre) única
  for (const part of chunk([...byName.values()].map((s) => ({ fuente, ...s, capturado: new Date().toISOString() }))))
    ok(await db.from('saldos_clientes_planilla').insert(part), 'saldos');
}

export async function importarDiego(libro: Libro, db: SupabaseClient): Promise<string> {
  const saldos = parseClientesDiego(libro);
  await replaceSaldos(db, 'clientes_diego', saldos);

  const movs = parseProveedores(libro);
  const provs = await idMap(db, 'proveedores', 'nombre', [...new Set(movs.map((m) => m.proveedor))].map((nombre) => ({ nombre })), 'nombre');
  const hash = hasher();
  const movPayload = movs.map((m) => ({
    proveedor_id: provs.get(m.proveedor)!, fecha: m.fecha, centro_costo: m.centro || null, unidad_negocio: m.unidad || null,
    rubro: m.rubro || null, subrubro: m.subrubro || null, detalle: m.detalle || null, nro_factura: m.factura || null,
    debe: m.debe, haber: m.haber, forma_pago: m.forma || null, nro_cheque: m.cheque || null, observaciones: m.obs || null,
    source_hash: hash([m.fecha, m.proveedor, m.detalle, m.factura, m.debe, m.haber, m.forma, m.cheque]),
  }));
  for (const part of chunk(movPayload)) ok(await db.from('movimientos_proveedor').upsert(part, { onConflict: 'source_hash' }), 'movimientos');

  const chq = parseCheques(libro);
  const hc = hasher();
  const chqPayload = chq.map((c) => ({
    tipo: c.tipo, contraparte: c.contraparte || null, numero: c.numero || null, banco: c.banco || null, librador: c.librador || null,
    monto: c.monto, emision: c.emision, vencimiento: c.vto, estado: c.estado, endosado_a: c.endosado || null, observaciones: c.obs || null,
    source_hash: hc([c.tipo, c.numero, c.banco, c.monto, c.vto, c.contraparte]), // el estado cambia: no entra en el hash
  }));
  for (const part of chunk(chqPayload)) ok(await db.from('cheques').upsert(part, { onConflict: 'source_hash' }), 'cheques');

  return `Saldos clientes (clientes_diego): ${saldos.length}. Movimientos de proveedores: ${movPayload.length}. Cheques: ${chqPayload.length}.`;
}

export async function importarCombustible(libro: Libro, db: SupabaseClient): Promise<string> {
  const rows = parseCombustible(libro);
  const h = hasher();
  const payload = rows.map((r) => ({
    fecha: r.fecha, remito: r.remito || null, patente: r.patente, es_camion: r.camion, litros: r.litros,
    tipo: r.tipo, estacion: r.estacion, chofer: r.chofer, source_hash: h([r.fecha, r.remito, r.patente, r.litros, r.tipo, r.estacion]),
  }));
  for (const part of chunk(payload)) ok(await db.from('cargas_combustible').upsert(part, { onConflict: 'source_hash' }), 'combustible');
  return `Cargas de combustible: ${payload.length}.`;
}
