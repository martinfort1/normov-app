'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

// El botón de Google aparece solo si NEXT_PUBLIC_GOOGLE_LOGIN=1 (cuando ya esté configurado en Supabase).
const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_LOGIN === '1';

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    // Supabase informa los errores del link en el hash (#error=...) o en nuestro ?error=enlace.
    if (new URLSearchParams(location.search).get('error') === 'enlace' || /error_code=otp_expired|error=access_denied/.test(location.hash)) setError('El link venció o se abrió en otro navegador. Pedí uno nuevo con "Olvidé mi contraseña".');
  }, []);

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

  async function recuperar(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    const email = String(new FormData(form!).get('email') ?? '').trim();
    setAviso(null);
    if (!email) { setError('Escribí tu email arriba y volvé a tocar "Olvidé mi contraseña".'); return; }
    setError(null);
    await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/nueva-clave` });
    // Mismo mensaje exista o no el email, para no revelar qué cuentas hay.
    setAviso('Si el email tiene una cuenta, te enviamos un link para elegir una nueva contraseña. Abrilo en este mismo navegador.');
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
          <button type="button" onClick={recuperar} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, justifySelf: 'start' }}>Olvidé mi contraseña</button>
          {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
          {aviso && <div className="banner" style={{ margin: 0 }}>{aviso}</div>}
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
