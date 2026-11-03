'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { crearClienteAdmin } from '@/lib/supabase/admin';
import { getAcceso, MODULOS, type Modulo, type Nivel } from '@/lib/permisos';

export type Estado = 'sin_acceso' | 'usuario' | 'admin';
export type Preset = 'lectura' | 'completo' | 'ninguno';
export type Resultado = { error: string | null };

const ROL_DE: Record<Estado, 'sin_acceso' | 'operador' | 'admin'> = { sin_acceso: 'sin_acceso', usuario: 'operador', admin: 'admin' };
const NIVELES_OK: Nivel[] = ['ninguno', 'lectura', 'escritura'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo un administrador puede usar estas acciones. Se comprueba acá, además de en la base (RLS). */
async function exigirAdmin() {
  const a = await getAcceso();
  if (!a?.esAdmin) throw new Error('Solo un administrador puede hacer esto.');
  return a;
}
const mensaje = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado.');

function filasPermisos(userId: string, niveles: Partial<Record<Modulo, Nivel>>) {
  return MODULOS.map((m) => {
    const n = niveles[m.key];
    return { user_id: userId, modulo: m.key, nivel: n && NIVELES_OK.includes(n) ? n : 'ninguno' };
  });
}
function nivelesDePreset(p: Preset): Record<Modulo, Nivel> {
  const n: Nivel = p === 'completo' ? 'escritura' : p === 'lectura' ? 'lectura' : 'ninguno';
  return Object.fromEntries(MODULOS.map((m) => [m.key, n])) as Record<Modulo, Nivel>;
}

export async function guardarUsuario(input: { id: string; nombre: string; estado: Estado; niveles: Record<Modulo, Nivel> }): Promise<Resultado> {
  try {
    const admin = await exigirAdmin();
    if (!UUID.test(input.id)) return { error: 'Usuario inválido.' };
    if (!(input.estado in ROL_DE)) return { error: 'Estado inválido.' };
    if (input.id === admin.userId && input.estado !== 'admin') return { error: 'No podés sacarte a vos mismo el rol de administrador.' };

    const supabase = await createClient();
    const { data, error } = await supabase.from('profiles').update({ rol: ROL_DE[input.estado], nombre: input.nombre.trim() || null }).eq('id', input.id).select('id');
    if (error) return { error: error.message };
    if (!data?.length) return { error: 'No se encontró el usuario.' };

    const { error: e2 } = await supabase.from('permisos').upsert(filasPermisos(input.id, input.niveles), { onConflict: 'user_id,modulo' });
    if (e2) return { error: e2.message };
    revalidatePath('/usuarios');
    return { error: null };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function crearUsuario(input: { nombre: string; email: string; password: string; preset: Preset }): Promise<Resultado> {
  try {
    await exigirAdmin();
    const email = input.email.trim().toLowerCase();
    const nombre = input.nombre.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'El email no es válido.' };
    if (!nombre) return { error: 'Poné el nombre de la persona.' };
    if (input.password.length < 8) return { error: 'La contraseña tiene que tener al menos 8 caracteres.' };

    const db = crearClienteAdmin();
    const { data, error } = await db.auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: { full_name: nombre } });
    if (error || !data.user) {
      return { error: /already|registered|exists/i.test(error?.message ?? '') ? 'Ya existe un usuario con ese email.' : error?.message ?? 'No se pudo crear el usuario.' };
    }
    const id = data.user.id;
    // El perfil lo crea un trigger de la base, con acceso "pendiente". Acá se activa y se le dan sus permisos.
    const activo = input.preset !== 'ninguno';
    const { error: e1 } = await db.from('profiles').update({ nombre, rol: activo ? 'operador' : 'sin_acceso' }).eq('id', id);
    if (e1) return { error: e1.message };
    const { error: e2 } = await db.from('permisos').upsert(filasPermisos(id, nivelesDePreset(input.preset)), { onConflict: 'user_id,modulo' });
    if (e2) return { error: e2.message };
    revalidatePath('/usuarios');
    return { error: null };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function cambiarPassword(id: string, password: string): Promise<Resultado> {
  try {
    await exigirAdmin();
    if (!UUID.test(id)) return { error: 'Usuario inválido.' };
    if (password.length < 8) return { error: 'La contraseña tiene que tener al menos 8 caracteres.' };
    const { error } = await crearClienteAdmin().auth.admin.updateUserById(id, { password });
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: mensaje(e) };
  }
}
