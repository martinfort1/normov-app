'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';

const SIN_PERMISO = 'No tenés permiso para cargar en Saldos de clientes.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export type Resultado = { error: string | null };

async function permitido() {
  const a = await getAcceso();
  return a?.puedeEscribir('clientes') ? a : null;
}
const falla = (e: { message: string; code?: string }): Resultado => ({
  error: e.code === '42883' || e.code === 'PGRST202' || e.code === '42P01' || /registrar_cobranza|anular_cobranza|saldos_iniciales|schema cache/.test(e.message) && /does not exist|schema cache|Could not find/.test(e.message)
    ? 'Falta correr las migraciones 0015_modulo_caja.sql y 0016_cobranzas_caja.sql en Supabase.' : e.message,
});
const listo = (): Resultado => { revalidatePath('/clientes'); revalidatePath('/caja'); revalidatePath('/certificados'); return { error: null }; };

export interface CobranzaInput {
  clienteId: string;
  fecha: string;
  monto: number;
  observaciones: string;
  imputaciones: { certificadoId: string; monto: number }[];
}

export async function registrarCobranza(c: CobranzaInput): Promise<Resultado> {
  const a = await permitido();
  if (!a) return { error: SIN_PERMISO };
  if (!UUID.test(c.clienteId) || !FECHA.test(c.fecha)) return { error: 'Datos inválidos.' };
  if (!(c.monto > 0)) return { error: 'El monto cobrado tiene que ser mayor a cero.' };
  if (c.imputaciones.some((i) => !UUID.test(i.certificadoId) || !(i.monto > 0))) return { error: 'Hay una imputación inválida.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('registrar_cobranza', {
    p_cliente: c.clienteId, p_fecha: c.fecha, p_monto: Math.round(c.monto * 100) / 100, p_medio: 'efectivo', p_obs: c.observaciones,
    p_imputaciones: c.imputaciones.map((i) => ({ certificado_id: i.certificadoId, monto: Math.round(i.monto * 100) / 100 })),
    p_autor: a.nombre || a.email,
  });
  return error ? falla(error) : listo();
}

export async function anularCobranza(id: string): Promise<Resultado> {
  if (!(await permitido())) return { error: SIN_PERMISO };
  if (!UUID.test(id)) return { error: 'Cobranza inválida.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('anular_cobranza', { p_id: id });
  return error ? falla(error) : listo();
}

/** Fija el saldo con el que cada cliente arranca en la app, a una fecha. Los certificados emitidos después de esa fecha se suman solos. */
export async function guardarSaldosIniciales(al: string, filas: { clienteId: string; monto: number }[]): Promise<Resultado> {
  const a = await permitido();
  if (!a) return { error: SIN_PERMISO };
  if (!FECHA.test(al)) return { error: 'Elegí la fecha de arranque.' };
  if (!filas.length) return { error: 'No hay saldos para guardar.' };
  if (filas.some((f) => !UUID.test(f.clienteId) || !Number.isFinite(f.monto))) return { error: 'Hay un saldo inválido.' };
  const supabase = await createClient();
  const { error } = await supabase.from('saldos_iniciales').upsert(
    filas.map((f) => ({ cliente_id: f.clienteId, monto: Math.round(f.monto * 100) / 100, al, autor: a.nombre || a.email })),
    { onConflict: 'cliente_id' },
  );
  return error ? falla(error) : listo();
}
