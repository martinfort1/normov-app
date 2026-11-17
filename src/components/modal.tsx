'use client';
import { useEffect } from 'react';

/** Ventana sobre la pantalla; se cierra con Escape o tocando afuera. */
export function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="modal-h"><h2>{titulo}</h2><button type="button" className="btn sm ghost" onClick={onCerrar} aria-label="Cerrar">✕</button></header>
        {children}
      </div>
    </div>
  );
}
