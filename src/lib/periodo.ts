export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export type Modo = 'dia' | 'mes' | 'anio' | 'rango';
export interface Periodo {
  modo: Modo; desde: string; hasta: string; etiqueta: string;
  dia: string; mes: string; anio: string; r1: string; r2: string;
}
export interface PeriodoParams { modo?: string; dia?: string; mes?: string; anio?: string; desde?: string; hasta?: string }

/** Fecha de hoy en Tucumán (YYYY-MM-DD). */
export function hoyAR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Tucuman' });
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Lee el período de la URL: ?modo=dia|mes|anio|rango + dia|mes|anio|desde,hasta. Sin parámetros: el mes actual. */
export function periodoDe(sp: PeriodoParams): Periodo {
  const hoy = hoyAR();
  const mesHoy = hoy.slice(0, 7), anioHoy = hoy.slice(0, 4);
  const modo: Modo = (['dia', 'mes', 'anio', 'rango'] as const).includes(sp.modo as Modo) ? (sp.modo as Modo) : 'mes';

  const dia = sp.dia && ISO.test(sp.dia) ? sp.dia : hoy;
  const mes = sp.mes && MES_RE.test(sp.mes) ? sp.mes : mesHoy;
  const anio = sp.anio && /^\d{4}$/.test(sp.anio) ? sp.anio : anioHoy;
  const rawR1 = sp.desde && ISO.test(sp.desde) ? sp.desde : mes + '-01';
  const rawR2 = sp.hasta && ISO.test(sp.hasta) ? sp.hasta : hoy;
  const [r1, r2] = rawR1 <= rawR2 ? [rawR1, rawR2] : [rawR2, rawR1];

  if (modo === 'dia') {
    const etiqueta = dia === hoy ? `hoy (${fmt(dia)})` : fmt(dia);
    return { modo, desde: dia, hasta: dia, etiqueta, dia, mes, anio, r1, r2 };
  }
  if (modo === 'anio') {
    return { modo, desde: `${anio}-01-01`, hasta: `${anio}-12-31`, etiqueta: `año ${anio}`, dia, mes, anio, r1, r2 };
  }
  if (modo === 'rango') {
    return { modo, desde: r1, hasta: r2, etiqueta: `${fmt(r1)} al ${fmt(r2)}`, dia, mes, anio, r1, r2 };
  }
  const y = +mes.slice(0, 4), m = +mes.slice(5, 7);
  const ultimo = new Date(y, m, 0).getDate();
  return { modo, desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}`, etiqueta: `${MESES[m - 1]} ${y}`, dia, mes, anio, r1, r2 };
}

function fmt(iso: string) { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; }

export function addDays(desde: string, n: number): string {
  const d = new Date(desde + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/**
 * El rango a pedirle a la base para poder dibujar los gráficos: en modo "día" se necesitan
 * los últimos 14 días aunque el período elegido sea uno solo; en el resto alcanza con el período.
 */
export function rangoGrafico(per: Periodo): { desde: string; hasta: string } {
  if (per.modo === 'dia') return { desde: addDays(per.dia, -13), hasta: per.dia };
  return { desde: per.desde, hasta: per.hasta };
}
