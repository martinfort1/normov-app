'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';

const SIN_PERMISO = 'No tenés permiso para cambiar precios (hace falta poder cargar Viajes).';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export type Resultado = { error: string | null };

async function permitido() {
  const a = await getAcceso();
  return a?.puedeEscribir('viajes') ? a : null;
}
const listo = (): Resultado => { revalidatePath('/precios'); revalidatePath('/cargar'); return { error: null }; };
const nombre = (s: string) => s.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
const falla = (e: { message: string; code?: string }, tabla: string, mig: string): Resultado => ({
  error: e.code === '42P01' || (/does not exist|schema cache/.test(e.message) && e.message.includes(tabla)) ? `Falta correr la migración ${mig} en Supabase.` : e.message,
});

// ───────────── precios de venta ─────────────
export interface PrecioInput { id: string | null; razon: string; material: string; tipo: 'minorista' | 'mayorista'; desde: string; m3: number; viaje6: number | null }

export async function guardarPrecio(p: PrecioInput): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  const razon = nombre(p.razon), material = nombre(p.material);
  if (!razon) return { error: 'Poné el cliente (o GENERAL para el precio de todos los que no tienen uno propio).' };
  if (!material) return { error: 'Poné el material.' };
  if (p.tipo !== 'minorista' && p.tipo !== 'mayorista') return { error: 'Elegí minorista o mayorista.' };
  if (!FECHA.test(p.desde)) return { error: 'Poné desde qué fecha rige el precio.' };
  if (!(p.m3 >= 0) || !Number.isFinite(p.m3)) return { error: 'El precio por m³ no es válido.' };
  if (p.viaje6 !== null && !(p.viaje6 >= 0)) return { error: 'El precio del viaje de 6 m³ no es válido.' };
  if (p.id && !UUID.test(p.id)) return { error: 'Precio inválido.' };
  const supabase = await createClient();
  const fila = { razon_social: razon, material, tipo: p.tipo, desde: p.desde, precio_m3: Math.round(p.m3 * 100) / 100, precio_viaje6: p.tipo === 'minorista' && p.viaje6 !== null ? Math.round(p.viaje6 * 100) / 100 : null };
  const { error } = p.id ? await supabase.from('lista_precios').update(fila).eq('id', p.id) : await supabase.from('lista_precios').insert(fila);
  if (error) return error.code === '23505' ? { error: 'Ya hay un precio de ese cliente, material y tipo con esa fecha de vigencia. Editá ese o elegí otra fecha.' } : falla(error, 'lista_precios', '0010_lista_precios.sql');
  return listo();
}

export async function eliminarPrecio(id: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Precio inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('lista_precios').delete().eq('id', id);
  return error ? falla(error, 'lista_precios', '0010_lista_precios.sql') : listo();
}

// ───────────── costos por cantera ─────────────
export interface CostoInput { id: string | null; cantera: string; material: string; desde: string; m3: number }

export async function guardarCosto(c: CostoInput): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  const cantera = nombre(c.cantera), material = nombre(c.material);
  if (!cantera) return { error: 'Poné la cantera.' };
  if (!material) return { error: 'Poné el material.' };
  if (!FECHA.test(c.desde)) return { error: 'Poné desde qué fecha rige el costo.' };
  if (!(c.m3 >= 0) || !Number.isFinite(c.m3)) return { error: 'El costo por m³ no es válido.' };
  if (c.id && !UUID.test(c.id)) return { error: 'Costo inválido.' };
  const supabase = await createClient();
  const fila = { cantera, material, desde: c.desde, costo_m3: Math.round(c.m3 * 100) / 100 };
  const { error } = c.id ? await supabase.from('lista_costos').update(fila).eq('id', c.id) : await supabase.from('lista_costos').insert(fila);
  if (error) return error.code === '23505' ? { error: 'Ya hay un costo de esa cantera y material con esa fecha de vigencia. Editá ese o elegí otra fecha.' } : falla(error, 'lista_costos', '0018_segmentos_costos.sql');
  return listo();
}

export async function eliminarCosto(id: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Costo inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('lista_costos').delete().eq('id', id);
  return error ? falla(error, 'lista_costos', '0018_segmentos_costos.sql') : listo();
}
