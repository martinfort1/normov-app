import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { MODULOS, type Modulo, type Nivel, type Rol } from '@/lib/modulos';

export { MODULOS, NIVELES } from '@/lib/modulos';
export type { Modulo, Nivel, Rol } from '@/lib/modulos';

export interface Acceso {
  userId: string;
  email: string;
  nombre: string;
  rol: Rol;
  esAdmin: boolean;
  nivel: Record<Modulo, Nivel>;
  /** false si todavía no se corrió la migración 0005: se usa el esquema viejo (lector / operador). */
  permisosListos: boolean;
  /** ¿Tiene acceso a algo? (admin, o algún módulo distinto de "sin acceso") */
  activo: boolean;
  puedeVer(m: Modulo): boolean;
  puedeEscribir(m: Modulo): boolean;
  /** Puede cargar algo en al menos un módulo. */
  algunaEscritura: boolean;
}

const todos = (n: Nivel): Record<Modulo, Nivel> => Object.fromEntries(MODULOS.map((m) => [m.key, n])) as Record<Modulo, Nivel>;

/** Quién es el usuario y qué puede hacer. Una sola consulta por pedido, aunque la pidan el layout y la página. */
export const getAcceso = cache(async (): Promise<Acceso | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [perfilRes, permisosRes] = await Promise.all([
    supabase.from('profiles').select('nombre, rol').eq('id', user.id).maybeSingle(),
    supabase.from('permisos').select('modulo, nivel').eq('user_id', user.id),
  ]);
  const rol = (perfilRes.data?.rol ?? 'sin_acceso') as Rol;
  const permisosListos = !permisosRes.error;

  let nivel: Record<Modulo, Nivel>;
  if (rol === 'admin') nivel = todos('escritura');
  else if (rol === 'sin_acceso') nivel = todos('ninguno');
  else if (!permisosListos) nivel = todos(rol === 'operador' ? 'escritura' : 'lectura'); // esquema viejo
  else {
    nivel = todos('ninguno');
    for (const p of permisosRes.data ?? []) if (p.modulo in nivel) nivel[p.modulo as Modulo] = p.nivel as Nivel;
  }

  const ver = (m: Modulo) => nivel[m] !== 'ninguno';
  const escribir = (m: Modulo) => nivel[m] === 'escritura';
  return {
    userId: user.id,
    email: user.email ?? '',
    nombre: perfilRes.data?.nombre ?? user.email ?? '',
    rol,
    esAdmin: rol === 'admin',
    nivel,
    permisosListos,
    activo: rol === 'admin' || MODULOS.some((m) => ver(m.key)),
    puedeVer: ver,
    puedeEscribir: escribir,
    algunaEscritura: MODULOS.some((m) => escribir(m.key)),
  };
});

/** Rutas que se muestran en el menú lateral según lo que el usuario puede hacer. */
export function rutasVisibles(a: Acceso): string[] {
  const rutas: string[] = MODULOS.filter((m) => a.puedeVer(m.key)).map((m) => m.ruta);
  if (a.algunaEscritura) rutas.push('/cargar');
  if (a.esAdmin) rutas.push('/caja', '/cashflow', '/usuarios');
  return rutas;
}

/** Texto corto para mostrar el tipo de cuenta en el encabezado. */
export function etiquetaRol(a: Acceso): string {
  if (a.esAdmin) return 'Administrador';
  return a.activo ? 'Usuario' : 'Sin acceso';
}
