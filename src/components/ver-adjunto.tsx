'use client';
import { useState } from 'react';
import { urlAdjunto } from '@/app/(app)/cargar/actions';

/** Botón que abre la foto o el comprobante adjunto a un registro, en una pestaña nueva. */
export function VerAdjunto({ path, etiqueta = 'Ver adjunto' }: { path: string; etiqueta?: string }) {
  const [cargando, setCargando] = useState(false);

  async function abrir() {
    setCargando(true);
    const ventana = window.open('', '_blank'); // se abre ya, para que el navegador no la bloquee
    const r = await urlAdjunto(path);
    setCargando(false);
    if (r.url && ventana) ventana.location.href = r.url;
    else { ventana?.close(); alert(r.error ?? 'No se pudo abrir el adjunto.'); }
  }
  return (
    <button type="button" className="btn sm" onClick={abrir} disabled={cargando} title="Foto o comprobante adjunto a este registro">
      📎 {cargando ? 'Abriendo…' : etiqueta}
    </button>
  );
}
