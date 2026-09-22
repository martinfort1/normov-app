'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

// El botón de Google aparece solo si NEXT_PUBLIC_GOOGLE_LOGIN=1 (cuando ya esté configurado en Supabase).
const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_LOGIN === '1';

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrarConEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const f = new FormData(e.currentTarget);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(f.get('email')),
      password: String(f.get('password')),
    });
    if (error) {
      setError('Email o contraseña incorrectos.');
      setCargando(false);
      return;
    }
    window.location.href = '/operaciones';
  }

  async function entrarConGoogle() {
    await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <main className="center">
      <div className="card">
        <div className="wordmark">NOR <b>MOV</b></div>
        <p className="muted">Nor Movimiento · Áridos, suelo y logística · Tucumán</p>
        <form onSubmit={entrarConEmail} style={{ display: 'grid', gap: 10, textAlign: 'left' }}>
          <input type="email" name="email" placeholder="Email" autoComplete="username" required />
          <input type="password" name="password" placeholder="Contraseña" autoComplete="current-password" required />
          <button className="primary" type="submit" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
          {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        </form>
        {GOOGLE && (
          <p style={{ marginBottom: 0 }}>
            <button type="button" onClick={entrarConGoogle}>Ingresar con Google</button>
          </p>
        )}
      </div>
    </main>
  );
}
