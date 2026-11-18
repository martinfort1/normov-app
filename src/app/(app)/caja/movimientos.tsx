'use client';
import { useState, useTransition } from 'react';
import { money } from '@/lib/format';
import { guardarMovimiento, anularMovimiento } from './actions';

export interface Mov { id: string; tipo: 'ingreso' | 'egreso'; concepto: string; monto: number; autor: string | null; anulado: boolean; deCobranza: boolean }

export function FormMovimiento({ fecha }: { fecha: string }) {
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('egreso');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await guardarMovimiento({ fecha, tipo, concepto, monto: Number(monto.replace(',', '.')) });
      if (r.error) setError(r.error); else { setConcepto(''); setMonto(''); }
    });
  }
  return (
    <form className="panel" onSubmit={guardar} style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0 }}>Cargar movimiento</h2>
      <div className="seg" style={{ width: 'fit-content' }}>
        <button type="button" aria-pressed={tipo === 'egreso'} onClick={() => setTipo('egreso')}>Egreso (sale plata)</button>
        <button type="button" aria-pressed={tipo === 'ingreso'} onClick={() => setTipo('ingreso')}>Ingreso (entra plata)</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 10 }}>
        <label className="fld">Concepto
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === 'egreso' ? 'Ej: gasoil, peaje, viático' : 'Ej: venta de chatarra'} />
        </label>
        <label className="fld">Monto
          <input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" />
        </label>
      </div>
      {error && <div className="banner err">{error}</div>}
      <div><button type="submit" className="primary" disabled={pending}>{pending ? 'Guardando…' : 'Agregar a la caja'}</button></div>
    </form>
  );
}

export function Anular({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn sm danger" disabled={pending} title={error ?? undefined}
        onClick={() => { if (confirm('¿Anular este movimiento?')) start(async () => { const r = await anularMovimiento(id); setError(r.error); }); }}>
        Anular
      </button>
      {error && <div className="muted" style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</div>}
    </>
  );
}

export function Lista({ movs, puedeEscribir }: { movs: Mov[]; puedeEscribir: boolean }) {
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Concepto</th><th>Cargó</th><th className="r">Ingreso</th><th className="r">Egreso</th><th /></tr></thead>
        <tbody>
          {movs.map((m) => (
            <tr key={m.id} style={m.anulado ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
              <td>{m.concepto}{m.deCobranza && <span className="pill info" style={{ marginLeft: 6 }}>cobranza</span>}</td>
              <td className="muted">{m.autor ?? ''}</td>
              <td className="r">{m.tipo === 'ingreso' ? money(m.monto) : ''}</td>
              <td className="r">{m.tipo === 'egreso' ? money(m.monto) : ''}</td>
              <td className="r">{puedeEscribir && !m.anulado && !m.deCobranza && <Anular id={m.id} />}</td>
            </tr>
          ))}
          {!movs.length && <tr><td colSpan={5} className="muted">Sin movimientos este día.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
