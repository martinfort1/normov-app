/* Precio de venta sugerido a partir de la lista de precios (tabla lista_precios). Sin dependencias: se usa en el navegador. */

export interface ListaPrecio { razon: string; material: string; tipo: 'mayorista' | 'minorista'; desde: string; viaje6: number | null; m3: number }
export interface PrecioSugerido { precio: number; tipo: 'mayorista' | 'minorista'; desde: string; de: string; general: boolean }

/** Compara nombres sin importar mayúsculas, tildes ni espacios de más. */
export const clave = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Hasta 12 m³ el viaje es minorista (6 y 12); más de 12 es mayorista (15, 18, 20, 22). */
export function tipoPorCantidad(cantidad: number): 'minorista' | 'mayorista' | null {
  if (!(cantidad > 0)) return null;
  return cantidad <= 12 ? 'minorista' : 'mayorista';
}

/** Precio por m³ de una fila: si el precio del viaje de 6 m³ coincide con el por m³ (salvo redondeo), se usa el exacto. */
function precioUnitario(f: ListaPrecio): number {
  if (f.viaje6 && f.viaje6 > 0 && Math.abs(f.viaje6 / 6 - f.m3) < 1) return Math.round((f.viaje6 / 6) * 100) / 100;
  return f.m3;
}

/** Busca el precio vigente a la fecha del viaje. Primero la lista propia del cliente (por razón social u obra);
 *  si no tiene, la GENERAL. Dentro de cada una, la más reciente que ya esté vigente. */
export function precioDeLista(lista: ListaPrecio[], q: { nombres: (string | null | undefined)[]; material: string; cantidad: number; fecha: string }): PrecioSugerido | null {
  const tipo = tipoPorCantidad(q.cantidad);
  const material = clave(q.material);
  if (!tipo || !material) return null;
  const nombres = new Set(q.nombres.map(clave).filter(Boolean));
  const vigentes = lista.filter((f) => f.tipo === tipo && clave(f.material) === material && (!q.fecha || f.desde <= q.fecha));
  const masReciente = (fs: ListaPrecio[]) => fs.reduce<ListaPrecio | null>((a, f) => (!a || f.desde > a.desde ? f : a), null);
  const propio = masReciente(vigentes.filter((f) => nombres.has(clave(f.razon))));
  const hit = propio ?? masReciente(vigentes.filter((f) => clave(f.razon) === 'GENERAL'));
  return hit ? { precio: precioUnitario(hit), tipo, desde: hit.desde, de: hit.razon, general: !propio } : null;
}
