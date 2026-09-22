'use client';
import { useActionState } from 'react';
import { setEstado } from './actions';

type Estado = 'pendiente' | 'aprobado' | 'anulado';

export function EstadoBotones({ id, estado, esAdmin }: { id: string; estado: Estado; esAdmin: boolean }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string | null }, nuevo: Estado) => setEstado(id, nuevo),
    { error: null },
  );

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {estado === 'pendiente' && esAdmin && (
        <button type="button" disabled={pending} onClick={() => formAction('aprobado')}>Aprobar</button>
      )}
      {estado === 'aprobado' && (
        <button type="button" disabled={pending} onClick={() => formAction('pendiente')}>Revertir</button>
      )}
      {estado !== 'anulado' && (
        <button type="button" disabled={pending} style={{ color: 'var(--bad)' }} onClick={() => formAction('anulado')}>Anular</button>
      )}
      {state.error && <span className="pill bad">{state.error}</span>}
    </div>
  );
}
