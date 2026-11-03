import { createClient } from '@/lib/supabase/server';
import { getAcceso, MODULOS, type Modulo, type Nivel } from '@/lib/permisos';
import { SinAcceso } from '@/components/sin-acceso';
import { ListaUsuarios, NuevoUsuario, type UsuarioVista } from './editor';

export const dynamic = 'force-dynamic';

interface Perfil { id: string; email: string | null; nombre: string | null; rol: string }

export default async function Usuarios() {
  const acceso = await getAcceso();
  if (!acceso?.esAdmin) return <SinAcceso seccion="Usuarios" />;

  const supabase = await createClient();
  const [perfiles, permisos] = await Promise.all([
    supabase.from('profiles').select('id,email,nombre,rol').order('creado'),
    supabase.from('permisos').select('user_id,modulo,nivel'),
  ]);

  if (permisos.error) {
    return (
      <>
        <h1>Usuarios</h1>
        <div className="banner err">
          Falta preparar la base de datos para los permisos por sección. En Supabase → SQL Editor, pegá y ejecutá el
          archivo <strong>supabase/migrations/0005_permisos.sql</strong> del proyecto, y recargá esta página.
          Mientras tanto la app sigue funcionando con los permisos de antes (lector / operador / administrador).
        </div>
      </>
    );
  }

  const porUsuario = new Map<string, Partial<Record<Modulo, Nivel>>>();
  for (const p of permisos.data ?? []) {
    const m = porUsuario.get(p.user_id) ?? {};
    m[p.modulo as Modulo] = p.nivel as Nivel;
    porUsuario.set(p.user_id, m);
  }

  const usuarios: UsuarioVista[] = ((perfiles.data ?? []) as Perfil[]).map((p) => {
    const propios = porUsuario.get(p.id) ?? {};
    return {
      id: p.id,
      email: p.email ?? '',
      nombre: p.nombre ?? '',
      estado: p.rol === 'admin' ? 'admin' : p.rol === 'sin_acceso' ? 'sin_acceso' : 'usuario',
      niveles: Object.fromEntries(MODULOS.map((m) => [m.key, propios[m.key] ?? 'ninguno'])) as Record<Modulo, Nivel>,
      esYo: p.id === acceso.userId,
    };
  });

  return (
    <>
      <h1>Usuarios</h1>
      <p className="lede">
        Quién puede entrar y qué puede hacer en cada sección: <strong>Solo ver</strong> (consulta, sin poder cambiar nada)
        o <strong>Ver y cargar</strong>. Los administradores acceden a todo y son los únicos que aprueban certificados.
        Estos permisos los hace cumplir la base de datos, no solo la pantalla.
      </p>
      {perfiles.error && <div className="banner err">{perfiles.error.message}</div>}
      <NuevoUsuario />
      <ListaUsuarios usuarios={usuarios} />
    </>
  );
}
