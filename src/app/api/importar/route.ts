/* Recibe un Excel con el formato de las planillas y lo importa. Con modo=simular solo lo revisa (no toca nada);
   con modo=aplicar lo importa. Usa la sesión del usuario: rige su permiso de escritura en la sección (RLS). */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso, type Modulo } from '@/lib/permisos';
import { libroDeBuffer } from '@/lib/sheets/libro';
import { parsePrincipal, parseProveedores, parseCheques, parseCombustible, type Libro } from '@/lib/sheets/parsers';
import { importarRemitos, importarMovProveedores, importarCheques, importarCargas, type ResultadoImport } from '@/lib/sheets/importar';
import { fecha as fmtFecha, money, remito as fmtRemito } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Resumen { filas: number; conId: number; fechas: (string | null)[]; muestra: string[] }
interface Tipo { modulo: Modulo; hoja: string; resumir: (l: Libro) => Resumen; importar: (l: Libro, db: SupabaseClient) => Promise<ResultadoImport> }

const TIPOS: Record<string, Tipo> = {
  viajes: {
    modulo: 'viajes', hoja: 'PRINCIPAL', importar: importarRemitos,
    resumir: (l) => {
      const f = parsePrincipal(l);
      return { filas: f.length, conId: f.filter((r) => r.id).length, fechas: f.map((r) => r.fecha),
        muestra: f.slice(0, 3).map((r) => `${fmtFecha(r.fecha)} · remito ${fmtRemito(r.numero)} · ${r.razon ?? r.cliente ?? '—'} · ${r.material ?? '—'} · ${r.cantidad}`) };
    },
  },
  combustible: {
    modulo: 'combustible', hoja: 'Cargas', importar: importarCargas,
    resumir: (l) => {
      const f = parseCombustible(l);
      return { filas: f.length, conId: f.filter((r) => r.id).length, fechas: f.map((r) => r.fecha),
        muestra: f.slice(0, 3).map((r) => `${fmtFecha(r.fecha)} · ${r.patente} · ${r.litros} litros`) };
    },
  },
  proveedores: {
    modulo: 'proveedores', hoja: 'Cta Cte Proveedores', importar: importarMovProveedores,
    resumir: (l) => {
      const f = parseProveedores(l);
      return { filas: f.length, conId: f.filter((r) => r.id).length, fechas: f.map((r) => r.fecha),
        muestra: f.slice(0, 3).map((r) => `${fmtFecha(r.fecha)} · ${r.proveedor} · ${r.debe > 0 ? `Debe ${money(r.debe)}` : `Haber ${money(r.haber)}`}`) };
    },
  },
  cheques: {
    modulo: 'cheques', hoja: 'Cheques', importar: importarCheques,
    resumir: (l) => {
      const f = parseCheques(l);
      return { filas: f.length, conId: f.filter((r) => r.id).length, fechas: f.map((r) => r.vto),
        muestra: f.slice(0, 3).map((r) => `Cheque ${r.numero} · ${r.tipo} · ${money(r.monto)} · vence ${fmtFecha(r.vto)}`) };
    },
  },
};

const MAX_BYTES = 4 * 1024 * 1024; // el límite de pedido de Vercel es 4,5 MB

export async function POST(req: Request) {
  const acceso = await getAcceso();
  if (!acceso) return NextResponse.json({ error: 'Iniciá sesión.' }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'El pedido no se pudo leer.' }, { status: 400 }); }
  const tipo = TIPOS[String(form.get('tipo') ?? '')];
  const modo = form.get('modo') === 'aplicar' ? 'aplicar' : 'simular';
  const archivo = form.get('file');
  if (!tipo) return NextResponse.json({ error: 'Tipo de importación inválido.' }, { status: 400 });
  if (!acceso.puedeEscribir(tipo.modulo)) return NextResponse.json({ error: 'No tenés permiso para cargar datos en esa sección.' }, { status: 403 });
  if (!(archivo instanceof File) || !archivo.size) return NextResponse.json({ error: 'Elegí un archivo de Excel.' }, { status: 400 });
  if (archivo.size > MAX_BYTES) return NextResponse.json({ error: 'El archivo es muy grande (máximo 4 MB). Probá con un rango de fechas más corto.' }, { status: 413 });

  let libro: Libro;
  try { libro = libroDeBuffer(Buffer.from(await archivo.arrayBuffer()), [tipo.hoja]); }
  catch { return NextResponse.json({ error: 'No se pudo leer el archivo. ¿Es un Excel (.xlsx)?' }, { status: 400 }); }

  try {
    const r = tipo.resumir(libro);
    if (!r.filas) return NextResponse.json({ error: `No encontré filas para importar en la hoja ${tipo.hoja}.` }, { status: 400 });
    if (modo === 'simular') {
      const fechas = r.fechas.filter((x): x is string => !!x).sort();
      return NextResponse.json({ filas: r.filas, conId: r.conId, desde: fechas[0] ? fmtFecha(fechas[0]) : null, hasta: fechas.length ? fmtFecha(fechas[fechas.length - 1]) : null, muestra: r.muestra });
    }
    const resultado = await tipo.importar(libro, await createClient());
    for (const ruta of ['/operaciones', '/combustible', '/proveedores', '/cheques', '/cargar']) revalidatePath(ruta);
    return NextResponse.json({ mensaje: `Importación lista. ${resultado.mensaje}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo importar.';
    const traducido = /row-level security/i.test(msg) ? 'No tenés permiso para cargar estos datos.' : /schema cache|does not exist/i.test(msg) && !/hoja/.test(msg) ? 'Falta correr la migración 0006_cargar.sql en Supabase.' : msg;
    return NextResponse.json({ error: traducido }, { status: 400 });
  }
}
