'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export type Resultado = { error: string | null };

async function permitido() {
  const a = await getAcceso();
  return a?.puedeEscribir('caja') ? a : null;
}
const SIN_PERMISO = 'No tenés permiso para cargar en la caja.';

export async function guardarMovimiento(m: { fecha: string; tipo: 'ingreso' | 'egreso'; concepto: string; monto: number }): Promise<Resultado> {
  const a = await permitido();
  if (!a) return { error: SIN_PERMISO };
  if (!FECHA.test(m.fecha) || (m.tipo !== 'ingreso' && m.tipo !== 'egreso')) return { error: 'Datos inválidos.' };
  if (!m.concepto.trim()) return { error: 'Poné el concepto (en qué se gastó o de dónde viene).' };
  if (!(m.monto > 0)) return { error: 'El monto tiene que ser mayor a cero.' };
  const supabase = await createClient();
  const { error } = await supabase.from('caja_movimientos').insert({
    fecha: m.fecha, tipo: m.tipo, concepto: m.concepto.trim(), monto: Math.round(m.monto * 100) / 100, medio: 'efectivo', autor: a.nombre || a.email,
  });
  if (error) return { error: /caja_movimientos/.test(error.message) && /does not exist|schema cache/.test(error.message) ? 'Falta correr la migración 0016_cobranzas_caja.sql en Supabase.' : error.message };
  revalidatePath('/caja');
  return { error: null };
}

/** Anula un movimiento suelto. Los que vienen de una cobranza se anulan desde Saldos de clientes. */
export async function anularMovimiento(id: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Movimiento inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('caja_movimientos').update({ anulado: true }).eq('id', id).is('cobranza_id', null);
  if (error) return { error: error.message };
  revalidatePath('/caja');
  return { error: null };
}
