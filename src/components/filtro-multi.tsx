'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Filtro de selección múltiple: guarda los valores elegidos en la URL (?name=a,b,c). */
export function FiltroMulti({ name, label, opciones }: { name: string; label: string; opciones: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const actuales = new Set((sp.get(name) || '').split(',').filter(Boolean));

  function aplicar(next: Set<string>) {
    const params = new URLSearchParams(sp.toString());
    if (next.size) params.set(name, [...next].join(',')); else params.delete(name);
    router.push(`${pathname}?${params.toString()}`);
  }
  function toggle(v: string) {
    const next = new Set(actuales);
    next.has(v) ? next.delete(v) : next.add(v);
    aplicar(next);
  }

  return (
    <details className="ms">
      <summary className={actuales.size ? 'on' : ''}>{label}{actuales.size ? ` (${actuales.size})` : ''}</summary>
      <div className="ms-pop">
        <div className="ms-list">
          {opciones.map((o) => (
            <label key={o}><input type="checkbox" checked={actuales.has(o)} onChange={() => toggle(o)} /><span>{o}</span></label>
          ))}
          {!opciones.length && <span className="muted" style={{ fontSize: 12, padding: '4px 6px' }}>Sin opciones para este período</span>}
        </div>
        {actuales.size > 0 && <button type="button" onClick={() => aplicar(new Set())}>Limpiar</button>}
      </div>
    </details>
  );
}
