'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';

const SIN_PERMISO = 'No tenés permiso para cargar en Certificados.';

export interface RemitoDisponible {
  remito_id: string; numero: string; fecha: string; cantidad: number; precio: number;
}

export async function buscarRemitos(clienteId: string, desde: string, hasta: string, incluirSinNumero = false): Promise<{ rows: RemitoDisponible[]; error: string | null }> {
  const acceso = await getAcceso();
  if (!acceso?.puedeEscribir('certificados')) return { rows: [], error: SIN_PERMISO };
  if (!clienteId || !desde || !hasta) return { rows: [], error: 'Elegí cliente y fechas.' };
  const supabase = await createClient();
  let query = supabase
    .from('v_remitos_estado')
    .select('id,numero,fecha,cantidad,precio')
    .eq('cliente_id', clienteId).gte('fecha', desde).lte('fecha', hasta).is('cert_numero', null);
  // Los viajes sin número propio se guardan con una clave interna "SR-…" (ver lib/sheets/importar.ts);
  // por defecto no se ofrecen para certificar, salvo que se pidan explícitamente.
  if (!incluirSinNumero) query = query.not('numero', 'like', 'SR-%');
  const { data, error } = await query.order('fecha', { ascending: true }).limit(2000);
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
  const acceso = await getAcceso();
  if (!acceso?.puedeEscribir('certificados')) return { error: SIN_PERMISO, numero: null };
  if (!p.clienteId || !p.desde || !p.hasta || !p.emision) return { error: 'Faltan datos del certificado.', numero: null };
  if (!p.items.length) return { error: 'Agregá al menos un remito.', numero: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('crear_certificado', {
    p_cliente_id: p.clienteId, p_desde: p.desde, p_hasta: p.hasta, p_unidad: p.unidad, p_emision: p.emision, p_items: p.items,
  });

  if (error) {
    if (error.code === '23505') {
      // Postgres informa la clave en `details` (a veces en `message`). Los viajes de la planilla se identifican por
      // remito_id; los agregados a mano, por (remito_numero, fecha).
      const texto = `${error.message} ${error.details ?? ''}`;
      const porId = texto.match(/\(remito_id\)=\(([0-9a-f-]{36})\)/i);
      const porNum = texto.match(/\(remito_numero, fecha\)=\(([^,]+), ([^)]+)\)/);
      const item = porId ? p.items.find((i) => i.remito_id === porId[1]) : null;
      const detalle = item ? `El remito ${item.remito_numero} del ${item.fecha}` : porNum ? `El remito ${porNum[1]} del ${porNum[2]}` : 'Uno de estos remitos';
      return { error: `${detalle} ya está en otro certificado vigente. Quitalo y guardá de nuevo.`, numero: null };
    }
    return { error: error.message, numero: null };
  }
  revalidatePath('/certificados');
  return { error: null, numero: (data as { numero: number } | null)?.numero ?? null };
}

export async function setEstado(id: string, estado: 'pendiente' | 'aprobado' | 'anulado') {
  const acceso = await getAcceso();
  if (!acceso?.puedeEscribir('certificados')) return { error: SIN_PERMISO };
  if (estado === 'aprobado' && !acceso.esAdmin) return { error: 'Solo un administrador puede aprobar certificados.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('certificados').update({ estado }).eq('id', id).select('id');
  revalidatePath('/certificados');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'No se pudo modificar el certificado (¿ya no existe o no tenés permiso?).' };
  return { error: null };
}
