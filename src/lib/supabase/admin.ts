import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Cliente con la service role key: se salta RLS y puede administrar usuarios. Solo para código de servidor,
 *  y siempre después de comprobar que quien lo pide es administrador. */
export function crearClienteAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('El servidor no tiene configurada la conexión administrativa a Supabase.');
  return createClient(url, key, { auth: { persistSession: false } });
}
