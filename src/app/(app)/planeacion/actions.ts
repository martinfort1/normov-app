'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';

const SIN_PERMISO = 'No tenés permiso para cargar en Pedidos y Planeación.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export type Resultado = { error: string | null };

async function permitido() {
  const a = await getAcceso();
  return a?.puedeEscribir('pedidos') ? a : null;
}
/** Mensaje de error; si la tabla no existe todavía, avisa que falta la migración. */
const falla = (e: { message: string; code?: string }): Resultado => ({
  error: /cantera/.test(e.message) && /schema cache|does not exist/.test(e.message)
    ? 'Falta correr la migración 0013_plan_cantera.sql en Supabase.'
    : e.code === '42P01' || (/does not exist|schema cache/.test(e.message) && /camiones|plan_viajes|plan_choferes/.test(e.message))
    ? 'Falta correr la migración 0012_planeacion.sql en Supabase.' : e.message,
});
const listo = (): Resultado => { revalidatePath('/planeacion'); revalidatePath('/pedidos'); return { error: null }; };

// ───────────── camiones ─────────────
export interface CamionInput { id: string | null; patente: string; chofer: string; capacidad: number; disponible: boolean; /** camión grande: no hace viajes minoristas */ soloMayorista?: boolean }

export async function guardarCamion(c: CamionInput): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  const patente = c.patente.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!patente) return { error: 'Poné la patente.' };
  if (!(c.capacidad > 0) || c.capacidad > 100) return { error: 'La capacidad tiene que ser mayor a cero (en m³).' };
  if (c.id && !UUID.test(c.id)) return { error: 'Camión inválido.' };
  const supabase = await createClient();
  const datos = { patente, chofer: c.chofer.trim() || null, capacidad: c.capacidad, disponible: c.disponible };
  const guardar = (d: Record<string, unknown>) => (c.id ? supabase.from('camiones').update(d).eq('id', c.id) : supabase.from('camiones').insert(d));
  let { error } = await guardar({ ...datos, solo_mayorista: !!c.soloMayorista });
  // Antes de la migración 0018 no existe "solo mayorista": se guarda lo demás, y solo se avisa si se pidió esa restricción
  if (error && /solo_mayorista/.test(error.message)) {
    ({ error } = await guardar(datos));
    if (!error && c.soloMayorista) { revalidatePath('/planeacion'); return { error: 'El camión se guardó, pero sin la restricción "solo mayorista": falta correr la migración 0018_segmentos_costos.sql en Supabase.' }; }
  }
  if (error) return error.code === '23505' ? { error: `Ya existe un camión con la patente ${patente}.` } : falla(error);
  return listo();
}

export async function setDisponible(id: string, disponible: boolean): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Camión inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('camiones').update({ disponible }).eq('id', id);
  return error ? falla(error) : listo();
}

export async function eliminarCamion(id: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Camión inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('camiones').delete().eq('id', id);
  return error ? falla(error) : listo(); // sus itinerarios se borran con él: para conservarlos, mejor marcarlo como no disponible
}

// ───────────── chofer del día ─────────────
export async function setChoferDelDia(fecha: string, camionId: string, chofer: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!FECHA.test(fecha) || !UUID.test(camionId)) return { error: 'Datos inválidos.' };
  const supabase = await createClient();
  const nombre = chofer.trim();
  const { error } = nombre
    ? await supabase.from('plan_choferes').upsert({ fecha, camion_id: camionId, chofer: nombre }, { onConflict: 'fecha,camion_id' })
    : await supabase.from('plan_choferes').delete().eq('fecha', fecha).eq('camion_id', camionId); // vacío = vuelve al habitual
  return error ? falla(error) : listo();
}

// ───────────── itinerario ─────────────
export interface ViajeInput { fecha: string; camionId: string; pedidoId: string; materialId: string; cantidad: number; cantera: string; /** cuántos viajes iguales crear (1 si no se indica) */ repetir?: number }
const MAX_REPETIR = 30; // en un archivo 'use server' solo se exportan funciones

export async function agregarViaje(v: ViajeInput): Promise<Resultado> {
  const a = await permitido();
  if (!a) return { error: SIN_PERMISO };
  if (!FECHA.test(v.fecha) || !UUID.test(v.camionId) || !UUID.test(v.pedidoId) || !UUID.test(v.materialId)) return { error: 'Datos inválidos.' };
  if (!(v.cantidad > 0)) return { error: 'La cantidad del viaje tiene que ser mayor a cero.' };
  const veces = v.repetir ?? 1;
  if (!Number.isInteger(veces) || veces < 1 || veces > MAX_REPETIR) return { error: `La cantidad de viajes tiene que ser un número entero de 1 a ${MAX_REPETIR}.` };
  const supabase = await createClient();
  const { data: cam, error: e1 } = await supabase.from('camiones').select('*').eq('id', v.camionId).maybeSingle();
  if (e1) return falla(e1);
  if (!cam) return { error: 'No se encontró el camión.' };
  if (!cam.disponible) return { error: `El camión ${cam.patente} no está disponible.` };
  if (v.cantidad > Number(cam.capacidad) + 0.001) return { error: `El camión ${cam.patente} carga como máximo ${cam.capacidad} m³ por viaje.` };
  // Un camión grande ("solo mayorista") no hace viajes de pedidos minoristas; los chicos hacen de los dos tipos
  // (si la columna todavía no existe, no se controla)
  if (cam.solo_mayorista) {
    const { data: ped } = await supabase.from('pedidos').select('segmento').eq('id', v.pedidoId).maybeSingle();
    if (ped?.segmento === 'minorista') return { error: `El camión ${cam.patente} es solo para viajes mayoristas y este pedido es minorista.` };
  }

  const { data: ult, error: e2 } = await supabase.from('plan_viajes').select('orden').eq('fecha', v.fecha).eq('camion_id', v.camionId).order('orden', { ascending: false }).limit(1);
  if (e2) return falla(e2);
  const primero = (ult?.[0]?.orden ?? 0) + 1;
  // Todos los viajes se crean juntos, uno detrás de otro en el itinerario del camión
  const filas = Array.from({ length: veces }, (_, k) => ({
    fecha: v.fecha, camion_id: v.camionId, orden: primero + k, pedido_id: v.pedidoId, material_id: v.materialId, cantidad: Math.round(v.cantidad * 100) / 100, autor: a.nombre || a.email,
    ...(v.cantera.trim() ? { cantera: v.cantera.trim().toUpperCase() } : {}), // sin cantera no se manda la columna: anda aun antes de la migración 0013
  }));
  const { error } = await supabase.from('plan_viajes').insert(filas);
  return error ? falla(error) : listo();
}

/** Cambia el punto de retiro (cantera) de un viaje del itinerario. Vacío = sin definir. */
export async function setCantera(id: string, cantera: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Viaje inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('plan_viajes').update({ cantera: cantera.trim().toUpperCase() || null }).eq('id', id);
  return error ? falla(error) : listo();
}

export async function quitarViaje(id: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Viaje inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('plan_viajes').delete().eq('id', id);
  return error ? falla(error) : listo();
}

export async function marcarHecho(id: string, hecho: boolean): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Viaje inválido.' };
  const supabase = await createClient();
  // La función de la base marca el viaje, suma (o resta) sus metros a lo entregado del pedido y lo mueve de columna
  const { error } = await supabase.rpc('marcar_viaje_hecho', { p_id: id, p_hecho: hecho });
  if (error && (error.code === 'PGRST202' || error.code === '42883' || /marcar_viaje_hecho/.test(error.message))) {
    // Antes de la migración 0014: se marca el viaje, pero sus metros no llegan al pedido
    const { error: e2 } = await supabase.from('plan_viajes').update({ hecho }).eq('id', id);
    revalidatePath('/planeacion');
    return e2 ? falla(e2) : { error: 'El viaje quedó marcado, pero sus metros NO suman al pedido: falta correr la migración 0014_viaje_hecho.sql en Supabase.' };
  }
  return error ? falla(error) : listo();
}

/** Intercambia de lugar dos viajes del mismo camión y día (los que se ven uno al lado del otro en la pestaña activa). */
export async function intercambiarViajes(a: string, b: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(a) || !UUID.test(b) || a === b) return { error: 'Viaje inválido.' };
  const supabase = await createClient();
  const { data, error: e1 } = await supabase.from('plan_viajes').select('id,orden,fecha,camion_id').in('id', [a, b]);
  if (e1) return falla(e1);
  const [x, y] = [data?.find((r) => r.id === a), data?.find((r) => r.id === b)];
  if (!x || !y) return { error: 'El viaje ya no existe.' };
  if (x.fecha !== y.fecha || x.camion_id !== y.camion_id) return { error: 'Los viajes no son del mismo camión y día.' };
  const e2 = (await supabase.from('plan_viajes').update({ orden: y.orden }).eq('id', a)).error;
  if (e2) return falla(e2);
  const e3 = (await supabase.from('plan_viajes').update({ orden: x.orden }).eq('id', b)).error;
  return e3 ? falla(e3) : listo();
}

/** Sube o baja un viaje en el itinerario de su camión (intercambia el orden con el vecino). */
export async function moverViaje(id: string, sentido: 'arriba' | 'abajo'): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id) || (sentido !== 'arriba' && sentido !== 'abajo')) return { error: 'Viaje inválido.' };
  const supabase = await createClient();
  const { data: yo, error: e1 } = await supabase.from('plan_viajes').select('id,fecha,camion_id').eq('id', id).maybeSingle();
  if (e1) return falla(e1);
  if (!yo) return { error: 'El viaje ya no existe.' };
  const { data: todos, error: e2 } = await supabase.from('plan_viajes').select('id,orden').eq('fecha', yo.fecha).eq('camion_id', yo.camion_id).order('orden').order('creado');
  if (e2) return falla(e2);
  const lista = (todos ?? []) as { id: string; orden: number }[];
  const i = lista.findIndex((x) => x.id === id);
  const j = sentido === 'arriba' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= lista.length) return { error: null };
  // Se renumera toda la lista (1..n) con los dos vecinos intercambiados: evita órdenes repetidos
  [lista[i], lista[j]] = [lista[j], lista[i]];
  for (let k = 0; k < lista.length; k++) {
    if (lista[k].orden === k + 1) continue;
    const { error } = await supabase.from('plan_viajes').update({ orden: k + 1 }).eq('id', lista[k].id);
    if (error) return falla(error);
  }
  return listo();
}
