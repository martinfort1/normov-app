/* Parsers de las planillas de Google Sheets.
   Trabajan sobre un "Libro": un mapa { nombre de hoja -> filas (array de arrays) },
   sin depender de si esas filas vinieron de un .xlsx (scripts/import-sheets.ts) o
   directo de la planilla en vivo (src/app/api/sync/route.ts, vía Apps Script). */
import * as XLSX from 'xlsx';

type Cell = unknown;
export type Row = Cell[];
export type Libro = Record<string, Row[]>;

export const clean = (s: unknown) => String(s ?? '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
export const up = (s: unknown) => clean(s).toUpperCase();
const hnorm = (s: unknown) => up(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).replace(/\\/g, '').replace(/\$/g, '').replace(/\s/g, '');
  if (!s || s === '-') return 0;
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : neg ? -n : n;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Acepta: serial de Excel, Date, "AAAA-MM-DD…" (lo que manda Apps Script) o "DD/MM/AAAA". */
export function toISO(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = XLSX.SSF.parse_date_code(v);
    return d ? iso(d.y, d.m, d.d) : null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0].slice(0, 10);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
  return null;
}

export function remitoKey(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return v ? String(Math.round(v)) : null;
  const s = up(v).replace(/\s/g, '').replace(/^N[°º.]*/, '');
  if (!s || /^[0+\-.]+$/.test(s)) return null;
  if (/^\d+(\.0+)?$/.test(s)) return String(parseInt(s, 10));
  return s;
}

/** Texto o null cuando la celda no trae dato (vacío, 0, #N/A…). */
export function label(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return v === 0 ? null : String(v);
  const s = up(v);
  if (!s || s === '0' || s === '#N/A' || s === '#REF!' || s === '#ERROR!') return null;
  return s;
}

export type Unidad = 'm3' | 't' | 'h';
export function unitOf(material: string | null): Unidad {
  const m = up(material);
  if (/CENIZ/.test(m)) return 't';
  if (/^HORAS?$/.test(m)) return 'h';
  return 'm3';
}

function findHeader(rows: Row[], req: string[]) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = (rows[i] || []).map(hnorm);
    if (req.every((r) => h.some((c) => c === r || c.startsWith(r)))) return i;
  }
  return -1;
}
function col(h: string[], name: string) {
  const i = h.findIndex((c) => c === name);
  return i >= 0 ? i : h.findIndex((c) => c.startsWith(name));
}

interface Located { sheet: string; rows: Row[]; hi: number; h: string[] }
/** Busca la hoja por nombre; si no está (o no tiene esas columnas), prueba las demás. */
function locate(libro: Libro, name: string, req: string[]): Located {
  const tryOne = (n: string): Located | null => {
    const rows = libro[n];
    if (!rows) return null;
    const hi = findHeader(rows, req);
    return hi < 0 ? null : { sheet: n, rows, hi, h: (rows[hi] || []).map(hnorm) };
  };
  const first = tryOne(name);
  if (first) return first;
  for (const n of Object.keys(libro)) {
    if (n === name) continue;
    const r = tryOne(n);
    if (r) return r;
  }
  throw new Error(`No se encontró la hoja "${name}" con las columnas esperadas (${req.join(', ')}).`);
}

// ───────────── Planilla NORMOV 2026 ─────────────
export interface RemitoRow {
  numero: string | null; fecha: string; cliente: string | null; razon: string | null; camion: string | null;
  chofer: string | null; cantera: string | null; material: string | null; unidad: Unidad;
  cantidad: number; precio: number; total: number; neto: number; costo: number;
}
export function parsePrincipal(libro: Libro): RemitoRow[] {
  const L = locate(libro, 'PRINCIPAL', ['FECHA', 'REMITO', 'CHOFER', 'PRECIO VTA']);
  const h = L.h;
  const c = {
    fecha: col(h, 'FECHA'), cliente: col(h, 'CLIENTE'), razon: col(h, 'RAZON SOCIAL'), remito: col(h, 'REMITO'),
    camion: col(h, 'CAMION'), m3: h.indexOf('MT3') >= 0 ? h.indexOf('MT3') : col(h, 'MT3'), cantera: col(h, 'CANTERA'),
    material: col(h, 'MATERIAL'), chofer: col(h, 'CHOFER'), precio: col(h, 'PRECIO VTA'),
    total: h.indexOf('TOTAL'), neto: h.indexOf('NETO'), costo: h.indexOf('COSTO MAT.'), costoU: h.indexOf('COSTO MATERIAL'),
  };
  const out: RemitoRow[] = [];
  for (let i = L.hi + 1; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (!r) continue;
    const fecha = toISO(r[c.fecha]);
    if (!fecha) continue;
    const total = c.total >= 0 ? num(r[c.total]) : 0;
    const material = label(r[c.material]);
    const cantidad = num(r[c.m3]);
    const neto = (c.neto >= 0 ? num(r[c.neto]) : 0) || total;
    const costo = c.costo >= 0 ? num(r[c.costo]) : c.costoU >= 0 ? num(r[c.costoU]) * cantidad : 0;
    out.push({
      numero: remitoKey(r[c.remito]), fecha, cliente: label(r[c.cliente]), razon: label(r[c.razon]),
      camion: label(r[c.camion]), chofer: label(r[c.chofer]), cantera: label(r[c.cantera]),
      material, unidad: unitOf(material), cantidad, precio: num(r[c.precio]), total: total || neto, neto, costo,
    });
  }
  return out;
}

export interface SaldoRow { nombre: string; ventas: number; cobranzas: number; saldo: number }
export function parseCtaClientes(libro: Libro): SaldoRow[] {
  const L = locate(libro, 'Cta Clientes', ['RAZON SOCIAL', 'VENTAS TOTALES', 'SALDO']);
  const h = L.h;
  const c = { n: col(h, 'RAZON SOCIAL'), v: col(h, 'VENTAS TOTALES'), co: col(h, 'COBRANZAS'), s: h.indexOf('SALDO') };
  const out: SaldoRow[] = [];
  for (let i = L.hi + 1; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (!r) continue;
    const nombre = clean(r[c.n]);
    if (!nombre || /^TOTAL/i.test(nombre)) continue;
    out.push({ nombre, ventas: num(r[c.v]), cobranzas: num(r[c.co]), saldo: num(r[c.s]) });
  }
  return out;
}

// ───────────── NORMOV Diego 2026 ─────────────
export function parseClientesDiego(libro: Libro): SaldoRow[] {
  const L = locate(libro, 'Clientes', ['CLIENTE', 'TOTAL FACTURADO', 'SALDO']);
  const h = L.h;
  const c = { n: h.indexOf('CLIENTE'), f: col(h, 'TOTAL FACTURADO'), co: col(h, 'TOTAL COBRADO'), s: col(h, 'SALDO') };
  const out: SaldoRow[] = [];
  for (let i = L.hi + 1; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (!r) continue;
    const nombre = clean(r[c.n]);
    if (!nombre || /^total$/i.test(nombre)) continue; // la fila TOTAL viene mezclada con los clientes
    out.push({ nombre, ventas: num(r[c.f]), cobranzas: num(r[c.co]), saldo: num(r[c.s]) });
  }
  return out;
}

export interface MovProvRow {
  fecha: string | null; proveedor: string; centro: string; unidad: string; subrubro: string; rubro: string;
  detalle: string; factura: string; debe: number; haber: number; forma: string; cheque: string; obs: string;
}
export function parseProveedores(libro: Libro): MovProvRow[] {
  const L = locate(libro, 'Cta Cte Proveedores', ['FECHA', 'PROVEEDOR', 'DEBE', 'HABER']);
  const h = L.h;
  const c = {
    f: col(h, 'FECHA'), p: col(h, 'PROVEEDOR'), cen: col(h, 'CENTRO DE'), un: col(h, 'UNIDAD DE NEGOCIO'),
    sub: col(h, 'SUB-RUBRO'), rub: h.indexOf('RUBRO'), det: col(h, 'DETALLE'), fac: col(h, 'N° FACTURA'),
    d: col(h, 'DEBE'), hb: col(h, 'HABER'), fp: col(h, 'FORMA DE PAGO'), ch: col(h, 'N° CHEQUE'), obs: col(h, 'OBSERVACIONES'),
  };
  const out: MovProvRow[] = [];
  for (let i = L.hi + 1; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (!r) continue;
    const debe = num(r[c.d]), haber = num(r[c.hb]);
    let p = clean(r[c.p]);
    if (!p && !debe && !haber) continue;
    if (!p || p === '-') p = '(sin proveedor)';
    out.push({
      fecha: toISO(r[c.f]), proveedor: p, centro: clean(r[c.cen]), unidad: clean(r[c.un]), subrubro: clean(r[c.sub]),
      rubro: clean(r[c.rub]), detalle: clean(r[c.det]), factura: c.fac >= 0 ? clean(r[c.fac]) : '', debe, haber,
      forma: clean(r[c.fp]), cheque: c.ch >= 0 ? clean(r[c.ch]) : '', obs: clean(r[c.obs]),
    });
  }
  return out;
}

export interface ChequeRow {
  emision: string | null; tipo: string; contraparte: string; numero: string; banco: string; librador: string;
  monto: number; vto: string | null; estado: string; endosado: string; obs: string;
}
export function parseCheques(libro: Libro): ChequeRow[] {
  const L = locate(libro, 'Cheques', ['FECHA EMISION', 'MONTO', 'ESTADO']);
  const h = L.h;
  const c = {
    fe: col(h, 'FECHA EMISION'), tipo: col(h, 'TIPO'), cp: col(h, 'CLIENTE/PROVEEDOR'), nro: col(h, 'N° CHEQUE'),
    banco: col(h, 'BANCO'), lib: col(h, 'LIBRADOR'), monto: col(h, 'MONTO'), vto: col(h, 'FECHA VENCIMIENTO'),
    estado: h.indexOf('ESTADO'), end: col(h, 'ENDOSADO A'), obs: col(h, 'OBSERVACIONES'),
  };
  const out: ChequeRow[] = [];
  for (let i = L.hi + 1; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (!r) continue;
    const monto = num(r[c.monto]);
    const tipo = up(r[c.tipo]);
    if (!monto || !(tipo || r[c.nro])) continue;
    const nro = r[c.nro];
    out.push({
      emision: toISO(r[c.fe]),
      tipo: tipo.startsWith('TERC') ? 'Tercero' : tipo.startsWith('PROP') ? 'Propio' : tipo || '—',
      contraparte: clean(r[c.cp]).replace(/^-$/, ''),
      numero: typeof nro === 'number' ? String(Math.round(nro)) : clean(nro),
      banco: clean(r[c.banco]), librador: clean(r[c.lib]), monto, vto: toISO(r[c.vto]),
      estado: clean(r[c.estado]) || '—', endosado: clean(r[c.end]), obs: clean(r[c.obs]),
    });
  }
  return out;
}

// ───────────── Planilla Combustible ─────────────
const PLATE = /^([A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2})$/;
export const isTruck = (p: string) => PLATE.test(up(p).replace(/[\s\-.]/g, ''));

export interface CargaRow {
  fecha: string | null; remito: string; patente: string; litros: number; tipo: string; estacion: string; chofer: string; camion: boolean;
}
export function parseCombustible(libro: Libro): CargaRow[] {
  const L = locate(libro, 'Cargas', ['PATENTE', 'LITROS']);
  const h = L.h;
  const c = {
    f: col(h, 'FECHA'), rem: col(h, 'REMITO'), pat: col(h, 'PATENTE'), lt: col(h, 'LITROS'),
    tipo: h.indexOf('TIPO'), est: col(h, 'ESTACION'), ch: col(h, 'CHOFER'),
  };
  const out: CargaRow[] = [];
  for (let i = L.hi + 1; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (!r) continue;
    const patente = up(r[c.pat]);
    const litros = num(r[c.lt]);
    if (!patente || !litros) continue;
    out.push({
      fecha: toISO(r[c.f]), remito: clean(r[c.rem]), patente, litros,
      tipo: up(r[c.tipo]) || '—', estacion: up(r[c.est]) || '—', chofer: up(r[c.ch]) || '—', camion: isTruck(patente),
    });
  }
  return out;
}
