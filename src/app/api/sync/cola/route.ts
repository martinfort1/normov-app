/* Cola app → planillas. El Apps Script de la Planilla NORMOV 2026 pregunta (GET) qué cargas hechas en la app faltan
   copiar a las hojas y, cuando las escribe, avisa (POST) cuáles salieron bien y cuáles fallaron.
   Se autoriza con SYNC_SECRET, igual que /api/sync. */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOTE = 25;
const MAX_INTENTOS = 5;

function autorizado(req: Request): boolean {
  const secreto = process.env.SYNC_SECRET;
  return !!secreto && (req.headers.get('authorization') ?? '') === `Bearer ${secreto}`;
}
function conexion() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** Las cargas pendientes, de la más vieja a la más nueva (así el orden en la planilla es el de carga). */
export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  const db = conexion();
  if (!db) return NextResponse.json({ ok: false, error: 'El servidor no tiene configurada la conexión a Supabase.' }, { status: 500 });
  const { data, error } = await db.from('sheet_cola').select('id,tipo,datos').is('enviado', null).lt('intentos', MAX_INTENTOS).order('id').limit(LOTE);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, filas: data ?? [] });
}

/** { ok: [ids], errores: [{ id, error }] } → marca lo enviado y deja el motivo de lo que falló. */
export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  const db = conexion();
  if (!db) return NextResponse.json({ ok: false, error: 'El servidor no tiene configurada la conexión a Supabase.' }, { status: 500 });
  let body: { ok?: unknown; errores?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Body inválido: se esperaba JSON.' }, { status: 400 }); }

  const ids = (Array.isArray(body.ok) ? body.ok : []).filter((n): n is number => Number.isInteger(n));
  if (ids.length) {
    const { error } = await db.from('sheet_cola').update({ enviado: new Date().toISOString(), error: null }).in('id', ids).is('enviado', null);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const fallas = (Array.isArray(body.errores) ? body.errores : []) as { id?: unknown; error?: unknown }[];
  for (const f of fallas) {
    if (!Number.isInteger(f.id)) continue;
    const { data } = await db.from('sheet_cola').select('intentos').eq('id', f.id as number).maybeSingle();
    await db.from('sheet_cola').update({ intentos: ((data?.intentos as number | undefined) ?? 0) + 1, error: String(f.error ?? '').slice(0, 500) }).eq('id', f.id as number);
  }
  return NextResponse.json({ ok: true, enviados: ids.length, fallaron: fallas.length });
}
