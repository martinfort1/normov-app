/* Cola de envío app → planillas (tabla sheet_cola, migración 0019). Solo servidor.
   Nunca hace fallar una carga: si la tabla todavía no existe, la carga queda en la app y listo. */
import type { SupabaseClient } from '@supabase/supabase-js';

export type TipoCola = 'viaje' | 'combustible' | 'proveedor' | 'cheque';

/** Deja una carga en la cola para que el Apps Script la copie a la planilla. Devuelve un aviso si no se pudo. */
export async function encolar(db: Pick<SupabaseClient, 'from'>, tipo: TipoCola, datos: Record<string, unknown>): Promise<string | null> {
  try {
    const { error } = await db.from('sheet_cola').insert({ tipo, datos });
    if (!error) return null;
    return /sheet_cola|schema cache|does not exist/i.test(error.message)
      ? 'Falta correr la migración 0019_sheet_cola.sql para que se copie a la planilla.'
      : `No se pudo dejar en la cola de la planilla (${error.message}).`;
  } catch (e) {
    return `No se pudo dejar en la cola de la planilla (${e instanceof Error ? e.message : 'error'}).`;
  }
}
