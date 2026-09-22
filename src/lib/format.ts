const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

export const money = (v: number | null | undefined) => ars.format(Math.round(v ?? 0));
export const num1 = (v: number | null | undefined) => n1.format(v ?? 0);
export const num2 = (v: number | null | undefined) => n2.format(v ?? 0);
export const fecha = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const UNIDAD: Record<string, string> = { m3: 'm³', t: 't', h: 'h' };
export const certNo = (n: number | null | undefined) => String(n ?? 0).padStart(4, '0');
