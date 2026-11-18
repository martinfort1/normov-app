import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Con sesión iniciada entra al sistema; sin sesión, a la página pública. */
export default async function Inicio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? '/operaciones' : '/home');
}
