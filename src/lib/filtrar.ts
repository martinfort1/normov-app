/** Aplica los filtros de la URL (comma-separated) sobre una lista, leyendo un campo por fila.
 *  Sin 'use client': se llama desde componentes de servidor. */
export function filtrar<T>(rows: T[], sp: object, campos: Record<string, (r: T) => string | null>): T[] {
  const sp2 = sp as Record<string, string | undefined>;
  const activos = Object.entries(campos).filter(([name]) => sp2[name]);
  if (!activos.length) return rows;
  return rows.filter((r) => activos.every(([name, get]) => (sp2[name] || '').split(',').includes(get(r) ?? '')));
}
