'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { hoyAR } from '@/lib/periodo';

export async function setPrecio(formData: FormData) {
  const precio = Number(formData.get('precio'));
  if (!Number.isFinite(precio) || precio < 0) return { error: 'Precio inválido' };
  const supabase = await createClient();
  // Una fila por día de vigencia: si ya se cargó un precio hoy, lo reemplaza.
  const { error } = await supabase.from('precios_combustible').upsert({ vigente_desde: hoyAR(), precio }, { onConflict: 'vigente_desde' });
  if (error) return { error: error.message };
  revalidatePath('/combustible');
  return { error: null };
}
