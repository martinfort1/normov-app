'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Modo, Periodo } from '@/lib/periodo';

const MODOS: { v: Modo; t: string }[] = [
  { v: 'dia', t: 'Día' }, { v: 'mes', t: 'Mes' }, { v: 'anio', t: 'Año' }, { v: 'rango', t: 'Rango' },
];

export function PeriodoSwitcher({ per }: { per: Periodo }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function ir(cambios: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const k of ['modo', 'dia', 'mes', 'anio', 'desde', 'hasta']) next.delete(k);
    for (const [k, v] of Object.entries(cambios)) next.set(k, v);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="periodo" role="group" aria-label="Período">
      <div className="seg">
        {MODOS.map((m) => (
          <button key={m.v} type="button" aria-pressed={per.modo === m.v} onClick={() => ir({ modo: m.v, dia: per.dia, mes: per.mes, anio: per.anio, desde: per.r1, hasta: per.r2 })}>
            {m.t}
          </button>
        ))}
      </div>
      {per.modo === 'dia' && (
        <input type="date" defaultValue={per.dia} aria-label="Día" onChange={(e) => e.target.value && ir({ modo: 'dia', dia: e.target.value })} />
      )}
      {per.modo === 'mes' && (
        <input type="month" defaultValue={per.mes} aria-label="Mes" onChange={(e) => e.target.value && ir({ modo: 'mes', mes: e.target.value })} />
      )}
      {per.modo === 'anio' && (
        <input type="number" min="2000" max="2100" defaultValue={per.anio} aria-label="Año" style={{ width: 90 }}
          onKeyDown={(e) => e.key === 'Enter' && ir({ modo: 'anio', anio: (e.target as HTMLInputElement).value })}
          onBlur={(e) => e.target.value && ir({ modo: 'anio', anio: e.target.value })} />
      )}
      {per.modo === 'rango' && (
        <span className="row">
          <input type="date" defaultValue={per.r1} aria-label="Desde" onChange={(e) => e.target.value && ir({ modo: 'rango', desde: e.target.value, hasta: per.r2 })} />
          <span className="muted">a</span>
          <input type="date" defaultValue={per.r2} aria-label="Hasta" onChange={(e) => e.target.value && ir({ modo: 'rango', desde: per.r1, hasta: e.target.value })} />
        </span>
      )}
    </div>
  );
}
