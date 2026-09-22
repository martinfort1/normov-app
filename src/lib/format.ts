const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

export const money = (v: number | null | undefined) => ars.format(Math.round(v ?? 0));
export const num1 = (v: number | null | undefined) => n1.format(v ?? 0);
export const num2 = (v: number | null | undefined) => n2.format(v ?? 0);
export const fecha = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const UNIDAD: Record<string, string> = { m3: 'm³', t: 't', h: 'h' };
export const certNo = (n: number | null | undefined) => String(n ?? 0).padStart(4, '0');
/** Los remitos sin número propio se guardan con una clave interna "SR-…" (ver lib/sheets/importar.ts). */
export const remito = (numero: string | null | undefined) => (numero?.startsWith('SR-') ? '(sin número)' : numero ?? '—');

export function haceTiempo(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
