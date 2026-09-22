import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { certNo, fecha, money, num2, UNIDAD } from '@/lib/format';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

interface Item { id: string; remito_numero: string; fecha: string; cantidad: number; precio: number; total: number; origen: string }
interface Cert {
  numero: number; desde: string; hasta: string; emision: string; unidad: string; estado: string;
  clientes: { razon_social: string } | null; certificado_items: Item[];
}

export default async function VerCertificado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('certificados')
    .select('numero,desde,hasta,emision,unidad,estado,clientes(razon_social),certificado_items(id,remito_numero,fecha,cantidad,precio,total,origen)')
    .eq('id', id).maybeSingle();
  if (!data) return notFound();
  const c = data as unknown as Cert;
  const items = [...c.certificado_items].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.remito_numero.localeCompare(b.remito_numero, undefined, { numeric: true }));
  const cant = items.reduce((a, i) => a + i.cantidad, 0);
  const total = items.reduce((a, i) => a + i.total, 0);

  return (
    <div className="wrap">
      <div className="no-print" style={{ margin: '16px 0' }}>
        <Link href="/certificados">← Volver a certificados</Link>
      </div>
      <div className="panel" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid var(--bronze)', paddingBottom: 14, flexWrap: 'wrap', gap: 16 }}>
          <div className="wordmark">NOR <b>MOV</b></div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>CERTIFICADO DE VIAJES</div>
            <div style={{ color: 'var(--bronze-ink)', fontSize: 17 }}>N° {certNo(c.numero)}</div>
            <span className={`pill no-print ${c.estado === 'aprobado' ? 'good' : c.estado === 'anulado' ? 'bad' : 'warn'}`}>{c.estado}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 18px', padding: '14px 0' }}>
          <div><span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Cliente</span><br /><strong>{c.clientes?.razon_social ?? '—'}</strong></div>
          <div><span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Emisión</span><br /><strong>{fecha(c.emision)}</strong></div>
          <div><span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Período</span><br /><strong>{fecha(c.desde)} al {fecha(c.hasta)}</strong></div>
          <div><span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Unidad</span><br /><strong>{UNIDAD[c.unidad]}</strong></div>
        </div>
        <table>
          <thead><tr><th>Fecha</th><th>N° remito</th><th className="r">Cantidad</th><th className="r">Precio unitario</th><th className="r">Total</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}><td>{fecha(i.fecha)}</td><td>{i.remito_numero}</td><td className="r">{num2(i.cantidad)}</td><td className="r">{money(i.precio)}</td><td className="r">{money(i.total)}</td></tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--ink)' }}><td colSpan={2}>{items.length} remitos</td><td className="r">{num2(cant)}</td><td /><td className="r">{money(total)}</td></tr>
          </tbody>
        </table>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 40 }}>
          <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 6, textAlign: 'center', fontSize: 12 }} className="muted">Conformidad del cliente</div>
          <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 6, textAlign: 'center', fontSize: 12 }} className="muted">Nor Movimiento SAS</div>
        </div>
        <p className="no-print" style={{ marginTop: 20 }}><PrintButton /></p>
      </div>
    </div>
  );
}
