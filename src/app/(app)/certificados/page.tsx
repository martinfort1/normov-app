import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { certNo, fecha, money, num2, UNIDAD } from '@/lib/format';
import { ArmarCertificado } from './armar';
import { EstadoBotones } from './estado-botones';

export const dynamic = 'force-dynamic';

interface CertRow {
  id: string; numero: number; desde: string; hasta: string; emision: string; unidad: string;
  estado: 'pendiente' | 'aprobado' | 'anulado'; cantidad: number; total: number;
  clientes: { razon_social: string } | null;
}

const ESTADO_PILL: Record<string, string> = { pendiente: 'warn', aprobado: 'good', anulado: 'bad' };

export default async function Certificados() {
  const supabase = await createClient();
  const [{ data: clientes }, { data: certs, error }, { data: perfil }] = await Promise.all([
    supabase.from('clientes').select('id,razon_social').eq('activo', true).order('razon_social'),
    supabase.from('certificados').select('id,numero,desde,hasta,emision,unidad,estado,cantidad,total,clientes(razon_social)').order('numero', { ascending: false }).limit(300),
    supabase.from('profiles').select('rol').single(),
  ]);
  const esAdmin = perfil?.rol === 'admin';
  const rows = (certs ?? []) as unknown as CertRow[];

  return (
    <>
      <h1>Certificados</h1>
      <p className="lede">
        Armá el certificado y mandalo a aprobación. Los remitos de certificados pendientes o aprobados no se pueden
        volver a certificar; la base lo garantiza aunque dos personas trabajen al mismo tiempo. Los viajes sin número
        de remito propio se cuentan igual en Operaciones; para certificarlos, tildá la opción al lado de "Traer remitos".
      </p>

      <ArmarCertificado clientes={clientes ?? []} />

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Certificados guardados</h2>
        {error && <div className="banner err">{error.message}</div>}
        <table>
          <thead><tr><th>N°</th><th>Cliente</th><th>Período</th><th>Emisión</th><th className="r">Cantidad</th><th className="r">Total</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><strong>{certNo(c.numero)}</strong></td>
                <td>{c.clientes?.razon_social ?? '—'}</td>
                <td>{fecha(c.desde)} – {fecha(c.hasta)}</td>
                <td>{fecha(c.emision)}</td>
                <td className="r">{num2(c.cantidad)} {UNIDAD[c.unidad]}</td>
                <td className="r">{money(c.total)}</td>
                <td><span className={`pill ${ESTADO_PILL[c.estado]}`}>{c.estado}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Link href={`/certificados/${c.id}`}>Ver</Link>
                    <EstadoBotones id={c.id} estado={c.estado} esAdmin={esAdmin} />
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">Todavía no hay certificados guardados.</td></tr>}
          </tbody>
        </table>
        {!esAdmin && <p className="muted">Solo un administrador puede aprobar certificados.</p>}
      </div>
    </>
  );
}
