import type { Buckets } from '@/lib/chart-buckets';

export interface Serie<T> { nombre: string; color: string; valor: (row: T) => number }

function nicePaso(max: number): number {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Gráfico de barras en SVG puro (sin JS de cliente), igual al del tablero de FRAN. */
export function BarChart<T>({ buckets: B, series, rows, clave, fmt, aria, width = 1100, height = 300 }: {
  buckets: Buckets; series: Serie<T>[]; rows: T[]; clave: (row: T) => string; fmt: (n: number) => string;
  aria: string; width?: number; height?: number;
}) {
  const idx = new Map(B.keys.map((k, i) => [k, i]));
  const vals = series.map(() => Array(B.keys.length).fill(0));
  for (const r of rows) {
    const i = idx.get(clave(r));
    if (i == null) continue;
    series.forEach((s, j) => { vals[j][i] += s.valor(r); });
  }

  const W = width, H = height, pl = 50, pb = 22, pt = 10;
  const n = Math.max(1, B.keys.length);
  const max = Math.max(1, ...vals.flat());
  const paso = nicePaso(max), top = Math.ceil(max / paso) * paso;
  const bw = (W - pl - 8) / n, gw = (bw * 0.74) / Math.max(1, series.length), every = Math.ceil(n / 12);

  const lineas: React.ReactNode[] = [];
  for (let v = 0; v <= top + 1e-9; v += paso) {
    const y = pt + (H - pt - pb) * (1 - v / top);
    lineas.push(
      <g key={v}>
        <line className="g" x1={pl} x2={W - 4} y1={y} y2={y} />
        <text x={pl - 6} y={y + 3} textAnchor="end">{fmt(v)}</text>
      </g>,
    );
  }

  const barras: React.ReactNode[] = [];
  B.keys.forEach((k, i) => {
    const destacado = B.hoy === k;
    if (destacado) barras.push(<rect key={`hl-${k}`} className="hl" x={pl + i * bw} y={pt} width={bw} height={H - pt - pb} />);
    series.forEach((s, j) => {
      const v = vals[j][i];
      if (v <= 0) return;
      const h = (H - pt - pb) * (v / top);
      barras.push(
        <rect key={`${k}-${j}`} x={pl + i * bw + bw * 0.13 + j * gw} y={H - pb - h} width={Math.max(1, gw - 1)} height={h} rx={1.5} fill={s.color}>
          <title>{`${B.labels[i]} · ${s.nombre}: ${fmt(v)}`}</title>
        </rect>,
      );
    });
    if (i % every === 0 || destacado) {
      barras.push(
        <text key={`t-${k}`} x={pl + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontWeight={destacado ? 600 : 400} fill={destacado ? 'var(--ink)' : undefined}>
          {B.labels[i]}
        </text>,
      );
    }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} className="chart-svg">
      <style>{'.chart-svg .g{stroke:var(--line-2)} .chart-svg text{fill:var(--muted);font-size:10px;font-family:var(--body)} .chart-svg .hl{fill:var(--bronze-soft)}'}</style>
      {lineas}{barras}
    </svg>
  );
}
