/* Costo del material por cantera (tabla lista_costos, hoja PRECIOS COSTO de la planilla). Sin dependencias: se usa en el navegador. */
import { clave } from './precios';

export interface ListaCosto { cantera: string; material: string; desde: string; m3: number }
export interface CostoSugerido { costo: number; desde: string; cantera: string }

/** Costo por m³ vigente a la fecha del viaje para esa cantera y material: el de la fecha de vigencia más reciente que ya empezó. */
export function costoDeLista(lista: ListaCosto[], q: { cantera: string; material: string; fecha: string }): CostoSugerido | null {
  const cantera = clave(q.cantera), material = clave(q.material);
  if (!cantera || !material) return null;
  let hit: ListaCosto | null = null;
  for (const f of lista) {
    if (clave(f.cantera) !== cantera || clave(f.material) !== material) continue;
    if (q.fecha && f.desde > q.fecha) continue;
    if (!hit || f.desde > hit.desde) hit = f;
  }
  return hit ? { costo: hit.m3, desde: hit.desde, cantera: hit.cantera } : null;
}
