'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

/* Pantalla a la que llega el link del mail de recuperación: la sesión ya está abierta (la creó /auth/callback). */
export default function NuevaClave() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const clave = String(f.get('clave')), repetir = String(f.get('repetir'));
    if (clave.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (clave !== repetir) { setError('Las contraseñas no coinciden.'); return; }
    setCargando(true);
    const { error } = await createClient().auth.updateUser({ password: clave });
    if (error) { setError(error.message); setCargando(false); return; }
    window.location.href = '/operaciones';
  }

  return (
    <main className="center">
      <div className="card">
        <div className="wordmark">NOR <b>MOV</b></div>
        <p className="muted">Elegí tu nueva contraseña</p>
        <form onSubmit={guardar} style={{ display: 'grid', gap: 10, textAlign: 'left' }}>
          <input type="password" name="clave" placeholder="Nueva contraseña" autoComplete="new-password" required />
          <input type="password" name="repetir" placeholder="Repetir contraseña" autoComplete="new-password" required />
          <button className="primary" type="submit" disabled={cargando}>{cargando ? 'Guardando…' : 'Guardar contraseña'}</button>
          {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        </form>
      </div>
    </main>
  );
}
