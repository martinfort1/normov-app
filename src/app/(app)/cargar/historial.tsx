'use client';
import { useState, useTransition } from 'react';
import type { ItemHistorial } from './datos';
import { anularCarga } from './actions';
import { VerAdjunto } from '@/components/ver-adjunto';

export function Historial({ tipo, items }: { tipo: 'viaje' | 'combustible' | 'proveedor' | 'cheque'; items: ItemHistorial[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();

  function anular(id: string) {
    if (!window.confirm('¿Anular esta carga? Se borra del sistema (y su adjunto).')) return;
    setMsg(null);
    start(async () => {
      const r = await anularCarga(tipo, id);
      setMsg({ ok: !r.error, texto: r.error ?? r.mensaje ?? 'Listo.' });
    });
  }

  if (!items.length) return <p className="muted">Todavía no cargaste nada desde la app en esta sección.</p>;
  return (
    <>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.texto}</div>}
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Registro</th><th>Detalle</th><th>Cargó</th><th /></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{it.titulo}</strong></td>
                <td>{it.detalle}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{it.autor ?? '—'} · {it.cuando}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    {it.fotoPath && <VerAdjunto path={it.fotoPath} etiqueta="Adjunto" />}
                    <button type="button" className="btn sm danger" onClick={() => anular(it.id)} disabled={pending}>Anular</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
