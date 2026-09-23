import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ShellClient } from '@/components/shell-client';
import { MenuButton } from '@/components/menu-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: perfil } = await supabase.from('profiles').select('nombre, rol').eq('id', user.id).maybeSingle();
  const sinAcceso = !perfil || perfil.rol === 'sin_acceso';

  let pendientesCert = 0;
  if (!sinAcceso) {
    const { count } = await supabase.from('certificados').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    pendientesCert = count ?? 0;
  }

  return (
    <>
      <header className="top">
        <div className="in">
          <div className="wordmark">NOR <b>MOV</b></div>
          <div className="user">
            <span>{perfil?.nombre ?? user.email} · {perfil?.rol ?? 'sin_acceso'}</span>
            <form action="/auth/signout" method="post"><button type="submit">Salir</button></form>
          </div>
          {!sinAcceso && <MenuButton />}
        </div>
      </header>
      {sinAcceso ? (
        <main className="wrap">
          <div className="banner">Tu cuenta ({user.email}) todavía no tiene acceso. Pedile a un administrador que te habilite.</div>
        </main>
      ) : (
        <ShellClient pendientesCert={pendientesCert}>{children}</ShellClient>
      )}
    </>
  );
}
