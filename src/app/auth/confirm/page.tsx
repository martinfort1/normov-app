'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

/* Destino del link del mail de recuperación. La verificación se hace al tocar el botón (y no al abrir la página)
   para que los antivirus / previsualizadores de mails que "abren" los links no gasten el código de un solo uso. */
export default function Confirmar() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function continuar() {
    const q = new URLSearchParams(location.search);
    const token_hash = q.get('token_hash');
    if (!token_hash || q.get('type') !== 'recovery') { setError('El link no es válido. Pedí uno nuevo desde el login.'); return; }
    setCargando(true);
    const { error } = await createClient().auth.verifyOtp({ type: 'recovery', token_hash });
    if (error) { setError('El link venció o ya se usó. Pedí uno nuevo desde el login.'); setCargando(false); return; }
    window.location.href = '/nueva-clave';
  }

  return (
    <main className="center">
      <div className="card">
        <div className="wordmark">NOR <b>MOV</b></div>
        <p className="muted">Recuperar contraseña</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <button className="primary" onClick={continuar} disabled={cargando}>{cargando ? 'Verificando…' : 'Continuar y elegir nueva contraseña'}</button>
          {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
          {error && <a href="/login">Volver al login</a>}
        </div>
      </div>
    </main>
  );
}
