/* Cómo se identifica cada fila para no duplicarla, venga de donde venga (sync de la planilla, Excel o formulario).
   Sirve tanto para el sync automático como para la carga desde la app: si la misma fila entra por dos lados,
   se reconoce como la misma. Solo servidor (usa node:crypto). */
import { createHash } from 'node:crypto';
import type { MovProvRow, ChequeRow, CargaRow, RemitoRow } from './parsers';

export const sha = (parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex');

/** Qué datos definen una fila (el estado de un cheque no entra: cambia con el tiempo). */
export const partesMov = (m: Pick<MovProvRow, 'fecha' | 'proveedor' | 'detalle' | 'factura' | 'debe' | 'haber' | 'forma' | 'cheque'>) =>
  [m.fecha, m.proveedor, m.detalle, m.factura, m.debe, m.haber, m.forma, m.cheque];
export const partesCheque = (c: Pick<ChequeRow, 'tipo' | 'numero' | 'banco' | 'monto' | 'vto' | 'contraparte'>) =>
  [c.tipo, c.numero, c.banco, c.monto, c.vto, c.contraparte];
export const partesCarga = (r: Pick<CargaRow, 'fecha' | 'remito' | 'patente' | 'litros' | 'tipo' | 'estacion'>) =>
  [r.fecha, r.remito, r.patente, r.litros, r.tipo, r.estacion];
export const partesSinRemito = (r: Pick<RemitoRow, 'fecha' | 'cliente' | 'razon' | 'material' | 'cantidad' | 'precio' | 'camion' | 'chofer' | 'cantera'>) =>
  [r.fecha, r.cliente, r.razon, r.material, r.cantidad, r.precio, r.camion, r.chofer, r.cantera];

/** Hash + n° de ocurrencia, para que filas idénticas legítimas (dos cargas iguales el mismo día) no se pisen. */
export function hasher() {
  const vistos = new Map<string, number>();
  return (parts: unknown[]) => {
    const base = sha(parts);
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return `${base}:${n}`;
  };
}

/** Clave de un viaje sin número de remito: "SR-" + 12 caracteres del hash; las repetidas exactas suman -2, -3…
 *  La primera ocurrencia queda igual que siempre, así no se duplican los ya cargados. */
export function hasherSinRemito() {
  const vistos = new Map<string, number>();
  return (parts: unknown[]) => {
    const base = sha(parts).slice(0, 12);
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return `SR-${base}${n > 1 ? `-${n}` : ''}`;
  };
}

/** Para cargar una fila nueva desde la app: el primer hash libre (base:1, base:2…) dado lo que ya existe. */
export function siguienteLibre(base: string, existentes: string[]): string {
  const usados = new Set(existentes);
  for (let n = 1; n < 1000; n++) if (!usados.has(`${base}:${n}`)) return `${base}:${n}`;
  throw new Error('Demasiadas filas idénticas.');
}
export function siguienteLibreSR(base12: string, existentes: string[]): string {
  const usados = new Set(existentes);
  for (let n = 1; n < 1000; n++) {
    const k = `SR-${base12}${n > 1 ? `-${n}` : ''}`;
    if (!usados.has(k)) return k;
  }
  throw new Error('Demasiados viajes idénticos sin remito.');
}
