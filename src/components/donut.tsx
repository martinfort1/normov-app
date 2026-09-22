const PIE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

export interface Slice { label: string; value: number }

/** Torta simple en SVG puro (sin JS de cliente). Agrupa el resto en "Otros". */
export function Donut({ slices, top = 6, fmt, centro }: { slices: Slice[]; top?: number; fmt: (n: number) => string; centro: string }) {
  const orden = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const principales = orden.slice(0, top);
  const resto = orden.slice(top);
  const data = principales.map((s, i) => ({ ...s, color: PIE[i % PIE.length] }));
  if (resto.length) data.push({ label: `Otros (${resto.length})`, value: resto.reduce((a, s) => a + s.value, 0), color: 'var(--c-other)' });

  const total = data.reduce((a, s) => a + s.value, 0);
  if (!total) return <div className="muted">Sin datos para graficar.</div>;

  const R = 92, r = 58, c = 100;
  let a0 = -Math.PI / 2;
  const pt = (ang: number, rad: number) => `${(c + rad * Math.cos(ang)).toFixed(2)} ${(c + rad * Math.sin(ang)).toFixed(2)}`;
  const paths = data.map((s) => {
    const f = s.value / total, a1 = a0 + f * 2 * Math.PI;
    const grande = f > 0.5 ? 1 : 0;
    const d = f > 0.9999
      ? undefined
      : `M${pt(a0, R)}A${R} ${R} 0 ${grande} 1 ${pt(a1, R)}L${pt(a1, r)}A${r} ${r} 0 ${grande} 0 ${pt(a0, r)}Z`;
    const el = d
      ? <path key={s.label} d={d} fill={s.color} stroke="var(--surface)" strokeWidth={1.5}><title>{`${s.label}: ${fmt(s.value)} (${(f * 100).toFixed(1)}%)`}</title></path>
      : <circle key={s.label} cx={c} cy={c} r={(R + r) / 2} fill="none" stroke={s.color} strokeWidth={R - r}><title>{s.label}</title></circle>;
    a0 = a1;
    return el;
  });

  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Torta de ${centro}`}>
        {paths}
        <text x={c} y={c + 3} textAnchor="middle" className="dc1">{fmt(total)}</text>
        <text x={c} y={c + 19} textAnchor="middle" className="dc2">{centro}</text>
      </svg>
      <ul className="dleg">
        {data.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span title={s.label}>{s.label}</span>
            <em>{((s.value / total) * 100).toFixed(1)}%</em>
            <b>{fmt(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
