/* Importa las planillas (.xlsx exportadas de Google Drive) a Supabase.
   Es idempotente: se puede correr todas las veces que haga falta.

   Uso:
     npm run import -- --planilla data/planilla.xlsx --diego data/diego.xlsx --comb data/combustible.xlsx
   Cada archivo es opcional. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import {
  parsePrincipal, parseCtaClientes, parseClientesDiego, parseProveedores, parseCheques, parseCombustible,
} from '../src/lib/sheets/parsers';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
const db = createClient(url, key, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const load = (p: string) => XLSX.read(readFileSync(p), { type: 'buffer', cellDates: false });

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

async function idMap(table: string, keyCol: string, rows: Record<string, unknown>[], onConflict: string) {
  const map = new Map<string, string>();
  for (const part of chunk(rows)) {
    const data = ok(await db.from(table).upsert(part, { onConflict }).select(`id,${keyCol}`), table) as unknown as Record<string, string>[];
    for (const d of data) map.set(d[keyCol], d.id);
  }
  return map;
}

async function importPlanilla(path: string) {
  const wb = load(path);
  const rows = parsePrincipal(wb);
  const sinNumero = rows.filter((r) => !r.numero).length;
  const byNum = new Map<string, (typeof rows)[number]>();
  let duplicados = 0;
  for (const r of rows) { if (!r.numero) continue; if (byNum.has(r.numero)) duplicados++; byNum.set(r.numero, r); } // gana la última fila
  const uniq = [...byNum.values()];

  const razones = [...new Set(uniq.map((r) => r.razon).filter((x): x is string => !!x))];
  const clientes = await idMap('clientes', 'razon_social', razones.map((razon_social) => ({ razon_social })), 'razon_social');

  const obraKeys = new Map<string, { cliente_id: string | null; nombre: string }>();
  for (const r of uniq) {
    if (!r.cliente) continue;
    const cid = r.razon ? clientes.get(r.razon) ?? null : null;
    obraKeys.set(`${cid}|${r.cliente}`, { cliente_id: cid, nombre: r.cliente });
  }
  const obras = new Map<string, string>();
  for (const part of chunk([...obraKeys.values()])) {
    const data = ok(await db.from('obras').upsert(part, { onConflict: 'cliente_id,nombre' }).select('id,cliente_id,nombre'), 'obras') ?? [];
    for (const o of data) obras.set(`${o.cliente_id}|${o.nombre}`, o.id);
  }

  const mats = new Map<string, string>();
  for (const r of uniq) if (r.material) mats.set(r.material, r.unidad);
  const materiales = await idMap('materiales', 'nombre', [...mats].map(([nombre, unidad]) => ({ nombre, unidad })), 'nombre');

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
  for (const part of chunk(payload)) ok(await db.from('remitos').upsert(part, { onConflict: 'numero' }), 'remitos');
  console.log(`Remitos: ${payload.length} importados · ${sinNumero} sin número (omitidos) · ${duplicados} duplicados en la planilla.`);

  const saldos = parseCtaClientes(wb);
  await replaceSaldos('cta_clientes', saldos);
}

async function replaceSaldos(fuente: string, saldos: { nombre: string; ventas: number; cobranzas: number; saldo: number }[]) {
  ok(await db.from('saldos_clientes_planilla').delete().eq('fuente', fuente), 'saldos (borrar)');
  const byName = new Map(saldos.map((s) => [s.nombre, s])); // clave (fuente, nombre) única
  for (const part of chunk([...byName.values()].map((s) => ({ fuente, ...s, capturado: new Date().toISOString() }))))
    ok(await db.from('saldos_clientes_planilla').insert(part), 'saldos');
  console.log(`Saldos clientes (${fuente}): ${byName.size}`);
}

async function importDiego(path: string) {
  const wb = load(path);
  await replaceSaldos('clientes_diego', parseClientesDiego(wb));

  const movs = parseProveedores(wb);
  const provs = await idMap('proveedores', 'nombre', [...new Set(movs.map((m) => m.proveedor))].map((nombre) => ({ nombre })), 'nombre');
  const hash = hasher();
  const movPayload = movs.map((m) => ({
    proveedor_id: provs.get(m.proveedor)!, fecha: m.fecha, centro_costo: m.centro || null, unidad_negocio: m.unidad || null,
    rubro: m.rubro || null, subrubro: m.subrubro || null, detalle: m.detalle || null, nro_factura: m.factura || null,
    debe: m.debe, haber: m.haber, forma_pago: m.forma || null, nro_cheque: m.cheque || null, observaciones: m.obs || null,
    source_hash: hash([m.fecha, m.proveedor, m.detalle, m.factura, m.debe, m.haber, m.forma, m.cheque]),
  }));
  for (const part of chunk(movPayload)) ok(await db.from('movimientos_proveedor').upsert(part, { onConflict: 'source_hash' }), 'movimientos');
  console.log(`Movimientos de proveedores: ${movPayload.length}`);

  const chq = parseCheques(wb);
  const hc = hasher();
  const chqPayload = chq.map((c) => ({
    tipo: c.tipo, contraparte: c.contraparte || null, numero: c.numero || null, banco: c.banco || null, librador: c.librador || null,
    monto: c.monto, emision: c.emision, vencimiento: c.vto, estado: c.estado, endosado_a: c.endosado || null, observaciones: c.obs || null,
    source_hash: hc([c.tipo, c.numero, c.banco, c.monto, c.vto, c.contraparte]), // el estado cambia: no entra en el hash
  }));
  for (const part of chunk(chqPayload)) ok(await db.from('cheques').upsert(part, { onConflict: 'source_hash' }), 'cheques');
  console.log(`Cheques: ${chqPayload.length}`);
}

async function importComb(path: string) {
  const rows = parseCombustible(load(path));
  const h = hasher();
  const payload = rows.map((r) => ({
    fecha: r.fecha, remito: r.remito || null, patente: r.patente, es_camion: r.camion, litros: r.litros,
    tipo: r.tipo, estacion: r.estacion, chofer: r.chofer, source_hash: h([r.fecha, r.remito, r.patente, r.litros, r.tipo, r.estacion]),
  }));
  for (const part of chunk(payload)) ok(await db.from('cargas_combustible').upsert(part, { onConflict: 'source_hash' }), 'combustible');
  console.log(`Cargas de combustible: ${payload.length}`);
}

async function main() {
  const [p, d, c] = [arg('planilla'), arg('diego'), arg('comb')];
  if (!p && !d && !c) { console.log('Nada para importar. Ver el encabezado de este archivo.'); return; }
  if (p) await importPlanilla(p);
  if (d) await importDiego(d);
  if (c) await importComb(c);
  console.log('Listo.');
}
main().catch((e) => { console.error('ERROR:', e.message ?? e); process.exit(1); });
