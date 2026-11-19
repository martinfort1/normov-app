/* Rentabilidad por camión: ventas menos material, gasoil, chofer y arreglos. Función pura (sin base de datos): se prueba sola.
   Portado del tablero de NOR MOV en la planilla; las fuentes ahora son las tablas de la app. */
import { clave } from './precios';
import { costoDeLista, type ListaCosto } from './costos';

export type Rubro = 'Minorista' | 'Mayorista';
export const GAS_DEFECTO = 2476;
export const FERIADOS = ['2026-01-01', '2026-02-16', '2026-02-17', '2026-03-23', '2026-03-24', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-15', '2026-06-20', '2026-07-09', '2026-07-10', '2026-08-17', '2026-09-24', '2026-10-12', '2026-11-23', '2026-12-07', '2026-12-08', '2026-12-25'];
/** Pago por jornada al chofer (viaje) y valor hora UOCRA para las jornadas en el Ingenio (ceniza). */
export const TARIFAS = { may: 15000, min: 10000, sab: 0.5, dom: 1, horaIngenio: 6697 };
/** Patentes que en la planilla figuran con otra letra y se cuentan como la principal. */
export const ALIAS_PATENTE: Record<string, string> = { HCA546: 'HCQ546', HCB546: 'HCQ546' };

const NO_MEC = /COMBUST|GASOIL|MATERIAL|ARIDO|SUELDO|JORNAL|HONORAR/;
const TALLER = /TALLER|MANTEN|REPUEST|NEUMAT|CUBIERT|MECANIC|LUBRIC|GOMERI|SERVICE|FLOTA/;

export const patenteKey = (s: string | null | undefined) => {
  const k = clave(s).replace(/[^A-Z0-9]/g, '');
  return ALIAS_PATENTE[k] ?? k;
};

export interface Camion { patente: string; rubro: Rubro }
export interface Viaje { fecha: string; camion: string | null; chofer: string | null; material: string; cantera: string | null; m3: number; venta: number; costo: number; remito: string; cliente: string }
export interface Carga { fecha: string; patente: string; litros: number }
export interface PrecioGas { desde: string; precio: number }
export interface GastoProv { fecha: string; proveedor: string; rubro: string; subrubro: string; centro: string; detalle: string; obs: string; factura: string; debe: number }
export interface Opciones { incluirIngenio: boolean; repartir: boolean; horas: number; precioGas: number | null }

export interface Grupo { material: string; cantera: string; viajes: number; m3: number; ventas: number; costo: number; src: Set<string> }
export interface Gasto extends GastoProv { neto: number }
export interface Fila {
  k: string; rubro: Rubro; viajes: number; m3: number; ventas: number; mat: number; gas: number; litros: number; cargas: number; gasDef: number;
  chofer: number; mec: number; mecPror: number; mecT: number; mecL: Gasto[]; porMat: Map<string, Grupo>; est: number; sinC: Viaje[];
  fines: number; diasIng: number; ch: Map<string, number>; costo: number; res: number; mg: number | null;
  /** Por tipo de viaje (Minorista, Mayorista o Ingenio); el gasoil y los arreglos se reparten según la cantidad de viajes. */
  rub: Partial<Record<TipoViaje, PorTipo>>;
}
export type TipoViaje = 'Minorista' | 'Mayorista' | 'Ingenio';
export interface PorTipo { viajes: number; m3: number; ventas: number; mat: number; chofer: number; gas: number; mec: number; res: number }
export interface Resultado {
  list: Fila[]; fuera: Map<string, number>; sinPat: number; sinAsig: Gasto[]; totSA: number; precioGas: number;
}

/** Costo de gasoil por litro vigente a la fecha (última lista que ya empezó). */
export function precioGasA(lista: PrecioGas[], fecha: string): number | null {
  let hit: PrecioGas | null = null;
  for (const p of lista) if (p.desde <= fecha && (!hit || p.desde > hit.desde)) hit = p;
  return hit && hit.precio > 0 ? hit.precio : null;
}

/** Costo por m³ del material de un viaje y de dónde salió. */
export function costoMaterial(v: Viaje, lista: ListaCosto[], promedio: Map<string, number>): { u: number; src: string } {
  if (/CENIZ/.test(clave(v.material))) return { u: 0, src: 'ingenio' };
  const hit = costoDeLista(lista, { cantera: v.cantera ?? '', material: v.material, fecha: v.fecha });
  if (hit && hit.costo > 0) return { u: hit.costo, src: 'lista de costos' };
  if (v.costo > 0 && v.m3 > 0) return { u: v.costo / v.m3, src: 'remito' };
  const prom = promedio.get(clave(v.material));
  if (prom) return { u: prom, src: 'promedio de canteras' };
  return { u: 0, src: 'sin costo' };
}

/** Promedio del costo vigente por material, entre todas las canteras. */
export function promediosPorMaterial(lista: ListaCosto[], hasta: string): Map<string, number> {
  const ult = new Map<string, ListaCosto>();
  for (const f of lista) {
    if (f.desde > hasta) continue;
    const k = clave(f.cantera) + '|' + clave(f.material), a = ult.get(k);
    if (!a || f.desde > a.desde) ult.set(k, f);
  }
  const acc = new Map<string, number[]>();
  for (const f of ult.values()) if (f.m3 > 0) { const m = clave(f.material); acc.set(m, [...(acc.get(m) ?? []), f.m3]); }
  return new Map([...acc].map(([m, v]) => [m, v.reduce((a, b) => a + b, 0) / v.length]));
}

export function calcularRentabilidad(d: {
  camiones: Camion[]; viajes: Viaje[]; cargas: Carga[]; preciosGas: PrecioGas[]; costos: ListaCosto[]; gastos: GastoProv[]; hasta: string;
}, o: Opciones): Resultado {
  const feriados = new Set(FERIADOS);
  const precioDef = o.precioGas && o.precioGas > 0 ? o.precioGas : GAS_DEFECTO;
  const M = new Map<string, Fila>();
  for (const c of d.camiones) {
    const k = patenteKey(c.patente);
    if (k && !M.has(k)) M.set(k, { k: c.patente.trim().toUpperCase(), rubro: c.rubro, viajes: 0, m3: 0, ventas: 0, mat: 0, gas: 0, litros: 0, cargas: 0, gasDef: 0, chofer: 0, mec: 0, mecPror: 0, mecT: 0, mecL: [], porMat: new Map(), est: 0, sinC: [], fines: 0, diasIng: 0, ch: new Map(), costo: 0, res: 0, mg: null, rub: {} });
  }
  const promedio = promediosPorMaterial(d.costos, d.hasta);
  const fuera = new Map<string, number>(); let sinPat = 0;
  const diasIng = new Set<string>();

  for (const v of d.viajes) {
    const k = patenteKey(v.camion);
    if (!k) { sinPat++; continue; }
    const o2 = M.get(k);
    if (!o2) { fuera.set(k, (fuera.get(k) ?? 0) + 1); continue; }
    const ing = /CENIZ/.test(clave(v.material));
    if (ing && !o.incluirIngenio) continue;
    const chof = v.chofer && !/^\(?sin dato\)?$/i.test(v.chofer.trim()) ? v.chofer.trim() : '';
    o2.viajes++; o2.m3 += v.m3; o2.ventas += v.venta;
    if (chof) o2.ch.set(chof, (o2.ch.get(chof) ?? 0) + 1);
    const dow = new Date(v.fecha + 'T12:00:00').getDay();
    if (dow === 0 || dow === 6 || feriados.has(v.fecha)) o2.fines++;
    let cm = 0, chp = 0, src = 'ingenio';
    if (ing) {
      const dk = k + '|' + clave(chof) + '|' + v.fecha;
      if (!diasIng.has(dk)) { diasIng.add(dk); o2.diasIng++; chp = TARIFAS.horaIngenio * o.horas; }
    } else {
      const c = costoMaterial(v, d.costos, promedio);
      cm = c.u * v.m3; src = c.src;
      if (src === 'sin costo') o2.sinC.push(v); else if (src !== 'lista de costos') o2.est++;
      chp = (o2.rubro === 'Minorista' ? TARIFAS.min : TARIFAS.may) * (feriados.has(v.fecha) || dow === 0 ? 1 + TARIFAS.dom : dow === 6 ? 1 + TARIFAS.sab : 1);
    }
    o2.mat += cm; o2.chofer += chp;
    const tipo: TipoViaje = ing ? 'Ingenio' : o2.rubro;
    const R = o2.rub[tipo] ?? (o2.rub[tipo] = { viajes: 0, m3: 0, ventas: 0, mat: 0, chofer: 0, gas: 0, mec: 0, res: 0 });
    R.viajes++; R.m3 += v.m3; R.ventas += v.venta; R.mat += cm; R.chofer += chp;
    const gk = (ing ? 'CENIZA' : clave(v.material)) + '|' + clave(v.cantera);
    const g = o2.porMat.get(gk) ?? { material: ing ? 'CENIZA (Ingenio)' : v.material, cantera: v.cantera ?? '—', viajes: 0, m3: 0, ventas: 0, costo: 0, src: new Set<string>() };
    g.viajes++; g.m3 += v.m3; g.ventas += v.venta; g.costo += cm; g.src.add(src); o2.porMat.set(gk, g);
  }

  for (const c of d.cargas) {
    const o2 = M.get(patenteKey(c.patente)); if (!o2) continue;
    const p = precioGasA(d.preciosGas, c.fecha);
    o2.litros += c.litros; o2.cargas++; o2.gas += c.litros * (p ?? precioDef); if (!p) o2.gasDef++;
  }

  const claves = [...M.keys()].map((k) => [k, k] as const).concat(Object.entries(ALIAS_PATENTE).filter(([, b]) => M.has(b)).map(([a, b]) => [a, b] as const));
  const sinAsig: Gasto[] = [];
  for (const m of d.gastos) {
    if (!(m.debe > 0)) continue;
    const rub = clave(m.rubro + ' ' + m.subrubro);
    if (/COMPRA ?DE ?MAQUINARIA/.test(rub) || NO_MEC.test(rub)) continue;
    const neto = /^S/i.test(m.factura.trim()) ? m.debe / 1.21 : m.debe;
    const txt = clave([m.detalle, m.obs, m.subrubro, m.centro].join(' ')).replace(/[^A-Z0-9]/g, '');
    const hit = claves.find(([a]) => txt.includes(a));
    if (hit) { const o2 = M.get(hit[1])!; o2.mec += neto; o2.mecL.push({ ...m, neto }); }
    else if (TALLER.test(clave(m.rubro + ' ' + m.subrubro + ' ' + m.centro))) sinAsig.push({ ...m, neto });
  }
  const totSA = sinAsig.reduce((a, m) => a + m.neto, 0);
  const viajesT = [...M.values()].reduce((a, f) => a + f.viajes, 0);
  if (o.repartir && totSA && viajesT) for (const f of M.values()) f.mecPror = totSA * f.viajes / viajesT;
  for (const f of M.values()) {
    f.mecT = f.mec + f.mecPror; f.costo = f.mat + f.gas + f.chofer; f.res = f.ventas - f.costo - f.mecT; f.mg = f.ventas ? f.res / f.ventas : null;
    for (const R of Object.values(f.rub)) {
      const p = f.viajes ? R.viajes / f.viajes : 0;
      R.gas = f.gas * p; R.mec = f.mecT * p; R.res = R.ventas - R.mat - R.chofer - R.gas - R.mec;
    }
  }
  return { list: [...M.values()], fuera, sinPat, sinAsig, totSA, precioGas: precioDef };
}
