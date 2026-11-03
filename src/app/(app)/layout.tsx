import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAcceso, rutasVisibles, etiquetaRol } from '@/lib/permisos';
import { ShellClient } from '@/components/shell-client';
import { MenuButton } from '@/components/menu-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const acceso = await getAcceso();
  if (!acceso) redirect('/login');

  let pendientesCert = 0;
  if (acceso.activo && acceso.puedeVer('certificados')) {
    const supabase = await createClient();
    const { count } = await supabase.from('certificados').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    pendientesCert = count ?? 0;
  }

  return (
    <>
      <header className="top">
        <div className="in">
          <div className="wordmark">NOR <b>MOV</b></div>
          <div className="user">
            <span>{acceso.nombre || acceso.email} · {etiquetaRol(acceso)}</span>
            <form action="/auth/signout" method="post"><button type="submit">Salir</button></form>
          </div>
          {acceso.activo && <MenuButton />}
        </div>
      </header>
      {!acceso.activo ? (
        <main className="wrap">
          <div className="banner">Tu cuenta ({acceso.email}) todavía no tiene acceso. Pedile a un administrador que te habilite.</div>
        </main>
      ) : (
        <ShellClient pendientesCert={pendientesCert} visibles={rutasVisibles(acceso)}>{children}</ShellClient>
      )}
    </>
  );
}
