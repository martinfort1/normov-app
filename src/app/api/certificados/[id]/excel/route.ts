/* Genera el Excel de un certificado. Requiere sesión (misma auth que el resto de la app),
   a diferencia de /api/sync que es machine-to-machine. */
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { certNo, fecha, remito } from '@/lib/format';

interface Item { remito_numero: string; fecha: string; cantidad: number; precio: number; total: number }
interface Cert {
  numero: number; desde: string; hasta: string; emision: string; unidad: string; estado: string;
  clientes: { razon_social: string } | null; certificado_items: Item[];
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('certificados')
    .select('numero,desde,hasta,emision,unidad,estado,clientes(razon_social),certificado_items(remito_numero,fecha,cantidad,precio,total)')
    .eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Certificado no encontrado.' }, { status: 404 });

  const c = data as unknown as Cert;
  const items = [...c.certificado_items].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.remito_numero.localeCompare(b.remito_numero, undefined, { numeric: true }));
  const cant = items.reduce((a, i) => a + i.cantidad, 0);
  const total = items.reduce((a, i) => a + i.total, 0);

  const encabezado = [
    ['NOR MOV · Certificado de viajes'],
    ['N°', certNo(c.numero)],
    ['Cliente', c.clientes?.razon_social ?? ''],
    ['Período', `${fecha(c.desde)} al ${fecha(c.hasta)}`],
    ['Emisión', fecha(c.emision)],
    ['Unidad', c.unidad],
    ['Estado', c.estado],
    [],
    ['Fecha', 'N° remito', 'Cantidad', 'Precio unitario', 'Total'],
  ];
  const filas = items.map((i) => [fecha(i.fecha), remito(i.remito_numero), i.cantidad, i.precio, i.total]);
  const pie = [[`${items.length} remitos`, '', cant, '', total]];

  const ws = XLSX.utils.aoa_to_sheet([...encabezado, ...filas, ...pie]);
  ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Certificado');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="certificado-${certNo(c.numero)}.xlsx"`,
    },
  });
}
