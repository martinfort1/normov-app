/* Recibe el contenido de una planilla, mandado por el Apps Script instalado en Google Sheets
   (ver apps-script/), y lo sube a la base con la misma lógica que el importador manual.
   No usa la sesión del usuario: valida un secreto compartido y usa la service role key. */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { importarPlanilla, importarDiego, importarCombustible } from '@/lib/sheets/importar';
import type { Libro } from '@/lib/sheets/parsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMPORTADORES = { planilla: importarPlanilla, diego: importarDiego, comb: importarCombustible } as const;
type Archivo = keyof typeof IMPORTADORES;

function autorizado(req: Request): boolean {
  const secreto = process.env.SYNC_SECRET;
  if (!secreto) return false; // sin secreto configurado, el endpoint queda cerrado
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secreto}`;
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  let body: { archivo?: string; sheets?: Libro };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido: se esperaba JSON.' }, { status: 400 });
  }

  const archivo = body.archivo as Archivo;
  if (!archivo || !(archivo in IMPORTADORES)) {
    return NextResponse.json({ ok: false, error: `"archivo" debe ser uno de: ${Object.keys(IMPORTADORES).join(', ')}.` }, { status: 400 });
  }
  if (!body.sheets || typeof body.sheets !== 'object' || !Object.keys(body.sheets).length) {
    return NextResponse.json({ ok: false, error: 'Faltan las hojas ("sheets") a importar.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: 'El servidor no tiene configurada la conexión a Supabase.' }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false } });

  try {
    const resumen = await IMPORTADORES[archivo](body.sheets, db);
    return NextResponse.json({ ok: true, archivo, resumen });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sync:${archivo}]`, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
