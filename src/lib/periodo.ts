const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export interface Periodo { desde: string; hasta: string; etiqueta: string; mes: string; anio: string }

/** Fecha de hoy en Tucumán (YYYY-MM-DD). */
export function hoyAR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Tucuman' });
}

/** ?mes=2026-09 (mes) o ?anio=2026 (año). Sin parámetros: el mes actual. */
export function periodoDe(sp: { mes?: string; anio?: string }): Periodo {
  const hoy = hoyAR();
  if (sp.anio && /^\d{4}$/.test(sp.anio)) {
    return { desde: `${sp.anio}-01-01`, hasta: `${sp.anio}-12-31`, etiqueta: `año ${sp.anio}`, mes: hoy.slice(0, 7), anio: sp.anio };
  }
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : hoy.slice(0, 7);
  const y = +mes.slice(0, 4), m = +mes.slice(5, 7);
  const ultimo = new Date(y, m, 0).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}`, etiqueta: `${MESES[m - 1]} ${y}`, mes, anio: String(y) };
}
