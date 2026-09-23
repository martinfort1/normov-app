import { addDays, MESES, type Periodo } from './periodo';

export interface Buckets { keys: string[]; labels: string[]; byMonth: boolean; hoy: string | null }

function dias(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Un bucket por día si el rango es corto; uno por mes si es largo. Igual que el tablero de FRAN. */
export function chartBuckets(per: Periodo, hoyAR: string): Buckets {
  if (per.modo === 'dia') {
    const keys = dias(addDays(per.dia, -13), per.dia);
    return { keys, labels: keys.map((k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`), byMonth: false, hoy: per.dia };
  }
  if (per.modo === 'mes') {
    const keys = dias(per.desde, per.hasta);
    return { keys, labels: keys.map((k) => String(+k.slice(8, 10))), byMonth: false, hoy: hoyAR };
  }
  if (per.modo === 'rango' && (Date.parse(per.hasta) - Date.parse(per.desde)) / 86400000 <= 62) {
    const keys = dias(per.desde, per.hasta);
    return { keys, labels: keys.map((k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`), byMonth: false, hoy: hoyAR };
  }
  const keys: string[] = [], labels: string[] = [];
  let y = +per.desde.slice(0, 4), m = +per.desde.slice(5, 7);
  const ey = +per.hasta.slice(0, 4), em = +per.hasta.slice(5, 7);
  while ((y < ey || (y === ey && m <= em)) && keys.length < 120) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    labels.push(MESES[m - 1].slice(0, 3) + (per.modo === 'rango' ? ` ${String(y).slice(2)}` : ''));
    m++; if (m > 12) { m = 1; y++; }
  }
  return { keys, labels, byMonth: true, hoy: null };
}
