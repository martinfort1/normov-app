'use client';
import { useActionState } from 'react';
import { setPrecio } from './actions';

export function PrecioForm({ precio }: { precio: number }) {
  const [state, formAction, pending] = useActionState(async (_prev: { error: string | null }, formData: FormData) => setPrecio(formData), { error: null });

  return (
    <form className="filters" action={formAction}>
      <label htmlFor="precio" className="muted" style={{ fontSize: 13 }}>Precio por litro ($)</label>
      <input type="number" id="precio" name="precio" min="0" step="0.01" defaultValue={precio || ''} placeholder="Ej.: precio del surtidor" style={{ maxWidth: 160 }} />
      <button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</button>
      {state.error && <span className="pill bad">{state.error}</span>}
    </form>
  );
}
