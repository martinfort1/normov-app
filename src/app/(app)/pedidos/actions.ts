'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';
import { addDays, hoyAR } from '@/lib/periodo';

const SIN_PERMISO = 'No tenés permiso para cargar en Pedidos.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORIDADES = ['urgente', 'alta', 'normal', 'baja'] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
export type Resultado = { error: string | null };

async function autor() {
  const a = await getAcceso();
  return a?.puedeEscribir('pedidos') ? a : null;
}

export interface PedidoInput {
  id: string | null; clienteId: string; obraId: string | null; prioridad: Prioridad; fechaEntrega: string | null;
  items: { materialId: string; cantidad: number }[];
}

export async function guardarPedido(p: PedidoInput): Promise<Resultado> {
  const a = await autor();
  if (!a) return { error: SIN_PERMISO };
  if (!UUID.test(p.clienteId)) return { error: 'Elegí el cliente.' };
  if (p.obraId && !UUID.test(p.obraId)) return { error: 'Obra inválida.' };
  if (p.id && !UUID.test(p.id)) return { error: 'Pedido inválido.' };
  if (!PRIORIDADES.includes(p.prioridad)) return { error: 'Prioridad inválida.' };
  if (p.fechaEntrega && !/^\d{4}-\d{2}-\d{2}$/.test(p.fechaEntrega)) return { error: 'Fecha inválida.' };
  const items = p.items.filter((i) => i.materialId);
  if (!items.length) return { error: 'Agregá al menos un material.' };
  if (items.some((i) => !UUID.test(i.materialId) || !(i.cantidad > 0))) return { error: 'Cada material necesita una cantidad mayor a cero.' };
  if (new Set(items.map((i) => i.materialId)).size !== items.length) return { error: 'Hay un material repetido.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('guardar_pedido', {
    p_id: p.id, p_cliente: p.clienteId, p_obra: p.obraId || null, p_prioridad: p.prioridad, p_fecha: p.fechaEntrega || null,
    p_items: items.map((i) => ({ material_id: i.materialId, cantidad: i.cantidad })), p_autor: a.nombre || a.email,
  });
  if (error) return { error: error.message };
  revalidatePath('/pedidos');
  return { error: null };
}

/** Cambia de columna (pendiente ⇄ realizado). Un pedido archivado no se mueve. */
export async function moverPedido(id: string, estado: 'pendiente' | 'realizado'): Promise<Resultado> {
  if (!(await autor())) return { error: SIN_PERMISO };
  if (!UUID.test(id) || (estado !== 'pendiente' && estado !== 'realizado')) return { error: 'Pedido inválido.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('pedidos').update({ estado }).eq('id', id).in('estado', ['pendiente', 'realizado']).select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'No se pudo mover: el pedido ya no está en el tablero.' };
  revalidatePath('/pedidos');
  return { error: null };
}

/** Completar o cancelar: el pedido se archiva y deja de verse en el tablero. */
export async function cerrarPedido(id: string, motivo: 'completado' | 'cancelado'): Promise<Resultado> {
  if (!(await autor())) return { error: SIN_PERMISO };
  if (!UUID.test(id) || (motivo !== 'completado' && motivo !== 'cancelado')) return { error: 'Pedido inválido.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('pedidos').update({ estado: motivo, cerrado: new Date().toISOString() }).eq('id', id).in('estado', ['pendiente', 'realizado']).select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'El pedido ya estaba cerrado.' };
  revalidatePath('/pedidos');
  return { error: null };
}

// ───────────── vincular viajes ─────────────
export interface ViajeLista { id: string; idViaje: string | null; numero: string; fecha: string; material: string; cantidad: number; obra: string | null; camion: string | null }
type FilaViaje = { id: string; id_viaje?: string | null; numero: string; fecha: string; cantidad: number; camion: string | null; materiales: { nombre: string } | null; obras: { nombre: string } | null };
const aLista = (r: FilaViaje): ViajeLista => ({ id: r.id, idViaje: r.id_viaje ?? null, numero: r.numero, fecha: r.fecha, material: r.materiales?.nombre ?? '—', cantidad: r.cantidad, obra: r.obras?.nombre ?? null, camion: r.camion });

/** Viajes ya cargados que podrían ser de este pedido: mismo cliente (y obra, si el pedido la tiene), de un material
 *  pedido, de los últimos 60 días y que no estén vinculados a ningún pedido. */
export async function sugerirViajes(pedidoId: string): Promise<{ rows: ViajeLista[]; error: string | null }> {
  const a = await getAcceso();
  if (!a?.puedeEscribir('pedidos') || !a.puedeVer('viajes')) return { rows: [], error: 'Para vincular viajes necesitás cargar Pedidos y ver Viajes.' };
  if (!UUID.test(pedidoId)) return { rows: [], error: 'Pedido inválido.' };
  const supabase = await createClient();
  const { data: ped, error: e1 } = await supabase.from('pedidos').select('cliente_id,obra_id,pedido_items(material_id)').eq('id', pedidoId).maybeSingle();
  if (e1 || !ped) return { rows: [], error: e1?.message ?? 'No se encontró el pedido.' };
  const materiales = ((ped as unknown as { pedido_items: { material_id: string }[] }).pedido_items ?? []).map((i) => i.material_id);
  if (!materiales.length) return { rows: [], error: null };

  const sel = (conId: boolean): string => `id,${conId ? 'id_viaje,' : ''}numero,fecha,cantidad,camion,materiales(nombre),obras(nombre)`;
  const pedir = (conId: boolean) => {
    let q = supabase.from('remitos').select(sel(conId)).eq('cliente_id', ped.cliente_id).in('material_id', materiales).gte('fecha', addDays(hoyAR(), -60));
    if (ped.obra_id) q = q.eq('obra_id', ped.obra_id);
    return q.order('fecha', { ascending: false }).order('id').limit(150);
  };
  let res = await pedir(true);
  if (res.error && /id_viaje/.test(res.error.message)) res = await pedir(false);
  if (res.error) return { rows: [], error: res.error.message };
  const filas = (res.data ?? []) as unknown as FilaViaje[];
  if (!filas.length) return { rows: [], error: null };

  const { data: usados, error: e3 } = await supabase.from('pedido_remitos').select('remito_id').in('remito_id', filas.map((f) => f.id));
  if (e3) return { rows: [], error: e3.message };
  const ocupados = new Set((usados ?? []).map((u) => u.remito_id as string));
  return { rows: filas.filter((f) => !ocupados.has(f.id)).map(aLista), error: null };
}

export async function viajesDelPedido(pedidoId: string): Promise<{ rows: ViajeLista[]; error: string | null }> {
  const a = await getAcceso();
  if (!a?.puedeVer('pedidos')) return { rows: [], error: 'Sin permiso.' };
  if (!UUID.test(pedidoId)) return { rows: [], error: 'Pedido inválido.' };
  const supabase = await createClient();
  const { data: vin, error } = await supabase.from('pedido_remitos').select('remito_id').eq('pedido_id', pedidoId);
  if (error) return { rows: [], error: error.message };
  const ids = (vin ?? []).map((v) => v.remito_id as string);
  if (!ids.length) return { rows: [], error: null };
  const pedir = (conId: boolean) => supabase.from('remitos').select(`id,${conId ? 'id_viaje,' : ''}numero,fecha,cantidad,camion,materiales(nombre),obras(nombre)`).in('id', ids).order('fecha', { ascending: false }).order('id');
  let res = await pedir(true);
  if (res.error && /id_viaje/.test(res.error.message)) res = await pedir(false);
  // Sin permiso para ver Viajes, la lista llega vacía aunque haya vinculados
  if (res.error) return { rows: [], error: res.error.message };
  return { rows: ((res.data ?? []) as unknown as FilaViaje[]).map(aLista), error: null };
}

export async function vincularViajes(pedidoId: string, remitoIds: string[]): Promise<Resultado> {
  const a = await getAcceso();
  if (!a?.puedeEscribir('pedidos') || !a.puedeVer('viajes')) return { error: 'Para vincular viajes necesitás cargar Pedidos y ver Viajes.' };
  if (!UUID.test(pedidoId) || !remitoIds.length || remitoIds.some((r) => !UUID.test(r))) return { error: 'Datos inválidos.' };
  const supabase = await createClient();
  const { error } = await supabase.from('pedido_remitos').insert(remitoIds.map((remito_id) => ({ remito_id, pedido_id: pedidoId, autor: a.nombre || a.email })));
  if (error) return { error: error.code === '23505' ? 'Alguno de esos viajes ya está vinculado a un pedido. Actualizá la lista.' : error.message };
  revalidatePath('/pedidos');
  return { error: null };
}

export async function desvincularViaje(pedidoId: string, remitoId: string): Promise<Resultado> {
  if (!(await autor())) return { error: SIN_PERMISO };
  if (!UUID.test(pedidoId) || !UUID.test(remitoId)) return { error: 'Datos inválidos.' };
  const supabase = await createClient();
  const { error } = await supabase.from('pedido_remitos').delete().eq('pedido_id', pedidoId).eq('remito_id', remitoId);
  if (error) return { error: error.message };
  revalidatePath('/pedidos');
  return { error: null };
}
