'use client';
import { useEffect, useState } from 'react';

export type Vista = 'todos' | 'minorista' | 'mayorista';
export const VISTAS: { key: Vista; label: string }[] = [
  { key: 'todos', label: 'Todos' }, { key: 'minorista', label: 'Minorista' }, { key: 'mayorista', label: 'Mayorista' },
];

/** Vista elegida (Todos / Minorista / Mayorista), recordada en este navegador bajo `clave`. */
export function useVista(clave: string): [Vista, (v: Vista) => void] {
  const [vista, setVista] = useState<Vista>('todos');
  useEffect(() => {
    try { const s = localStorage.getItem(clave); if (s === 'todos' || s === 'minorista' || s === 'mayorista') setVista(s); } catch { /* sin almacenamiento */ }
  }, [clave]);
  return [vista, (v) => { setVista(v); try { localStorage.setItem(clave, v); } catch { /* no pasa nada */ } }];
}

/** Interruptor Todos / Minorista / Mayorista, con un contador en cada opción. */
export function SegmentoTabs({ valor, onChange, contar }: { valor: Vista; onChange: (v: Vista) => void; contar: (v: Vista) => string }) {
  return (
    <div className="seg seg-tabs" role="tablist" aria-label="Tipo de pedido" style={{ marginBottom: 12 }}>
      {VISTAS.map((s) => (
        <button key={s.key} type="button" role="tab" aria-selected={valor === s.key} aria-pressed={valor === s.key} onClick={() => onChange(s.key)}>
          {s.label} <span className="seg-n">{contar(s.key)}</span>
        </button>
      ))}
    </div>
  );
}
