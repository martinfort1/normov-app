'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface RemitoDisponible {
  remito_id: string; numero: string; fecha: string; cantidad: number; precio: number;
}

export async function buscarRemitos(clienteId: string, desde: string, hasta: string): Promise<{ rows: RemitoDisponible[]; error: string | null }> {
  if (!clienteId || !desde || !hasta) return { rows: [], error: 'Elegí cliente y fechas.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_remitos_estado')
    .select('id,numero,fecha,cantidad,precio')
    .eq('cliente_id', clienteId).gte('fecha', desde).lte('fecha', hasta).is('cert_numero', null)
    .order('fecha', { ascending: true }).limit(2000);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []).map((r) => ({ remito_id: r.id, numero: r.numero, fecha: r.fecha, cantidad: r.cantidad, precio: r.precio })), error: null };
}

export interface ItemPayload {
  remito_id: string | null; remito_numero: string; fecha: string; cantidad: number; precio: number; total: number; origen: 'planilla' | 'manual';
}
export interface CrearCertificadoPayload {
  clienteId: string; desde: string; hasta: string; unidad: 'm3' | 't' | 'h'; emision: string; items: ItemPayload[];
}

export async function guardarCertificado(p: CrearCertificadoPayload): Promise<{ error: string | null; numero: number | null }> {
  if (!p.clienteId || !p.desde || !p.hasta || !p.emision) return { error: 'Faltan datos del certificado.', numero: null };
  if (!p.items.length) return { error: 'Agregá al menos un remito.', numero: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('crear_certificado', {
    p_cliente_id: p.clienteId, p_desde: p.desde, p_hasta: p.hasta, p_unidad: p.unidad, p_emision: p.emision, p_items: p.items,
  });

  if (error) {
    if (error.code === '23505') {
      const m = error.message.match(/\(remito_numero\)=\(([^)]+)\)/);
      return { error: `El remito ${m?.[1] ?? ''} ya está en otro certificado vigente. Quitalo y guardá de nuevo.`, numero: null };
    }
    return { error: error.message, numero: null };
  }
  revalidatePath('/certificados');
  return { error: null, numero: (data as { numero: number } | null)?.numero ?? null };
}

export async function setEstado(id: string, estado: 'pendiente' | 'aprobado' | 'anulado') {
  const supabase = await createClient();
  const { error } = await supabase.from('certificados').update({ estado }).eq('id', id);
  revalidatePath('/certificados');
  if (error) return { error: error.message };
  return { error: null };
}
