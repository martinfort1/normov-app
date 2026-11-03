/* Descarga un Excel con las mismas hojas y columnas que las planillas. Requiere sesión y permiso de lectura
   en la sección (la base filtra además por RLS: solo salen filas que ese usuario puede ver). */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAcceso, type Modulo } from '@/lib/permisos';
import { fetchAll } from '@/lib/fetch-all';
import { hoyAR } from '@/lib/periodo';
import {
  exportarViajes, exportarCargas, exportarProveedores, exportarCheques,
  type ViajeExp, type CargaExp, type MovProvExp, type ChequeExp,
} from '@/lib/sheets/exportar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MODULO: Record<string, Modulo> = { viajes: 'viajes', combustible: 'combustible', proveedores: 'proveedores', cheques: 'cheques' };

export async function GET(req: Request) {
  const acceso = await getAcceso();
  if (!acceso) return NextResponse.json({ error: 'Iniciá sesión.' }, { status: 401 });

  const url = new URL(req.url);
  const tipo = url.searchParams.get('tipo') ?? '';
  const modulo = MODULO[tipo];
  if (!modulo) return NextResponse.json({ error: 'Tipo de exportación inválido.' }, { status: 400 });
  if (!acceso.puedeVer(modulo)) return NextResponse.json({ error: 'No tenés acceso a esa sección.' }, { status: 403 });

  const d = url.searchParams.get('desde'), h = url.searchParams.get('hasta');
  if ((d && !ISO.test(d)) || (h && !ISO.test(h))) return NextResponse.json({ error: 'Fechas inválidas.' }, { status: 400 });

  const db = await createClient();
  try {
    let buffer: Buffer, hoja: string, desdeUsado: string | null = d, hastaUsado: string | null = h;

    if (tipo === 'viajes') {
      hoja = 'PRINCIPAL';
      // Viajes son miles de filas: sin fechas, se exporta el año en curso.
      desdeUsado = d ?? `${hoyAR().slice(0, 4)}-01-01`; hastaUsado = h ?? hoyAR();
      const filas = await fetchAll<ViajeExp>((from, to) =>
        db.from('remitos').select('id,numero,fecha,camion,chofer,cantera,cantidad,precio,total,neto,costo,clientes(razon_social),obras(nombre),materiales(nombre,unidad)')
          .gte('fecha', desdeUsado!).lte('fecha', hastaUsado!).order('fecha').order('numero').order('id').range(from, to),
      );
      if (acceso.puedeVer('certificados')) {
        const est = await fetchAll<{ id: string; cert_numero: number | null; cert_estado: string | null }>((from, to) =>
          db.from('v_remitos_estado').select('id,cert_numero,cert_estado').gte('fecha', desdeUsado!).lte('fecha', hastaUsado!).order('fecha').order('numero').order('id').range(from, to),
        );
        const porId = new Map(est.map((e) => [e.id, e]));
        for (const f of filas) { const e = porId.get(f.id); f.certEstado = e?.cert_estado ?? null; f.certNumero = e?.cert_numero ?? null; }
      }
      buffer = exportarViajes(filas);
    } else if (tipo === 'combustible') {
      hoja = 'Cargas';
      const filas = await fetchAll<CargaExp>((from, to) => {
        let q = db.from('cargas_combustible').select('id,fecha,remito,patente,litros,tipo,precio_litro,estacion,chofer');
        if (d) q = q.gte('fecha', d);
        if (h) q = q.lte('fecha', h);
        return q.order('fecha').order('id').range(from, to);
      });
      buffer = exportarCargas(filas);
    } else if (tipo === 'proveedores') {
      hoja = 'Cta Cte Proveedores';
      const filas = await fetchAll<MovProvExp>((from, to) => {
        let q = db.from('movimientos_proveedor').select('id,fecha,unidad_negocio,centro_costo,rubro,subrubro,detalle,nro_factura,debe,haber,forma_pago,nro_cheque,fecha_pago,observaciones,proveedores(nombre)');
        if (d) q = q.gte('fecha', d);
        if (h) q = q.lte('fecha', h);
        return q.order('fecha').order('id').range(from, to);
      });
      buffer = exportarProveedores(filas);
    } else {
      hoja = 'Cheques';
      const filas = await fetchAll<ChequeExp>((from, to) => {
        let q = db.from('cheques').select('id,emision,tipo,contraparte,numero,banco,librador,cuit,monto,vencimiento,estado,endosado_a,observaciones');
        if (d) q = q.gte('vencimiento', d);
        if (h) q = q.lte('vencimiento', h);
        return q.order('vencimiento').order('id').range(from, to);
      });
      buffer = exportarCheques(filas);
    }

    const rango = desdeUsado || hastaUsado ? `${desdeUsado ?? 'inicio'}_a_${hastaUsado ?? 'hoy'}` : 'todo';
    const nombre = `NORMOV-${hoja.replace(/\s+/g, '-')}-${rango}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo armar el Excel.';
    return NextResponse.json({ error: /schema cache|does not exist/i.test(msg) ? 'Falta correr la migración 0006_cargar.sql en Supabase.' : msg }, { status: 500 });
  }
}
