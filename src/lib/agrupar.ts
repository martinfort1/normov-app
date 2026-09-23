export interface RemitoAgg { cantidad: number; unidad: string; neto: number; costo: number }
export interface Grupo { k: string; n: number; m3: number; t: number; h: number; neto: number; costo: number }

/** Agrupa remitos por una clave (cliente, chofer, camión, cantera, material…), sumando cantidad por unidad, venta neta y costo. */
export function agrupar<T extends RemitoAgg>(rows: T[], keyFn: (r: T) => string): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const r of rows) {
    const k = keyFn(r);
    const o = m.get(k) ?? { k, n: 0, m3: 0, t: 0, h: 0, neto: 0, costo: 0 };
    o.n++;
    if (r.unidad === 't') o.t += r.cantidad; else if (r.unidad === 'h') o.h += r.cantidad; else o.m3 += r.cantidad;
    o.neto += r.neto; o.costo += r.costo;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.neto - a.neto || b.n - a.n);
}

export function qtyText(o: Grupo, num1: (n: number) => string): string {
  const p: string[] = [];
  if (o.m3) p.push(`${num1(o.m3)} m³`);
  if (o.t) p.push(`${num1(o.t)} t`);
  if (o.h) p.push(`${num1(o.h)} h`);
  return p.join(' · ') || '—';
}

export function margen(o: Grupo): { mg: number; pct: number | null; clase: '' | 'bad' | 'warn' | 'good' } {
  const mg = o.neto - o.costo;
  const pct = o.neto ? (mg / o.neto) * 100 : null;
  const clase = pct == null ? '' : pct < 0 ? 'bad' : pct < 15 ? 'warn' : 'good';
  return { mg, pct, clase };
}
