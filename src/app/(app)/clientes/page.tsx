import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';
import { getAcceso } from '@/lib/permisos';
import { SinAcceso } from '@/components/sin-acceso';
import { CuentaCorriente, type CuentaFila, type CertPend, type CobranzaFila } from './cuenta';

export const dynamic = 'force-dynamic';

interface Saldo { nombre: string; ventas: number; cobranzas: number; saldo: number }

async function tabla(fuente: string, q?: string) {
  const supabase = await createClient();
  let query = supabase.from('saldos_clientes_planilla').select('nombre,ventas,cobranzas,saldo').eq('fuente', fuente).order('saldo', { ascending: false }).limit(1000);
  if (q) query = query.ilike('nombre', `%${q.replace(/[%,()]/g, ' ')}%`);
  const { data, error } = await query;
  return { rows: (data ?? []) as Saldo[], error: error?.message ?? null };
}

function Cuenta({ titulo, rows, error }: { titulo: string; rows: Saldo[]; error: string | null }) {
  const saldo = rows.reduce((a, r) => a + r.saldo, 0);
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{titulo}</h2>
      {error && <div className="banner err">{error}</div>}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi accent"><div className="l">Saldo</div><div className="v">{money(saldo)}</div></div>
      </div>
      <table>
        <thead><tr><th>Cliente</th><th className="r">Facturado</th><th className="r">Cobrado</th><th className="r">Saldo</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.nombre}>
              <td>{r.nombre}</td><td className="r">{money(r.ventas)}</td><td className="r">{money(r.cobranzas)}</td>
              <td className="r"><strong>{money(r.saldo)}</strong></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="muted">Sin datos. ¿Ya se importó esta planilla?</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const num = (v: unknown) => Number(v ?? 0);

async function cuentaCorriente() {
  const supabase = await createClient();
  const [cc, cert, cob, cli, ctaP, diegoP] = await Promise.all([
    supabase.from('v_cuenta_cliente').select('cliente_id,razon_social,saldo_inicial,al,facturado,cobrado').order('razon_social').limit(2000),
    supabase.from('v_cert_cobro').select('certificado_id,numero,cliente_id,emision,total,pendiente').gt('pendiente', 0.004).limit(3000),
    supabase.from('cobranzas').select('id,numero,fecha,monto,anulada,observaciones,clientes(razon_social),cobranza_items(monto)').order('numero', { ascending: false }).limit(40),
    supabase.from('clientes').select('id,razon_social').eq('activo', true).order('razon_social').limit(2000),
    supabase.from('saldos_clientes_planilla').select('nombre,saldo').eq('fuente', 'cta_clientes').limit(2000),
    supabase.from('saldos_clientes_planilla').select('nombre,saldo').eq('fuente', 'clientes_diego').limit(2000),
  ]);
  if (cc.error) return { listo: false as const, error: cc.error.message };

  const cuentas: CuentaFila[] = (cc.data ?? [])
    .map((r) => ({ clienteId: r.cliente_id as string, nombre: r.razon_social as string, saldoInicial: num(r.saldo_inicial), al: (r.al as string | null) ?? null, facturado: num(r.facturado), cobrado: num(r.cobrado) }))
    .filter((c) => c.saldoInicial !== 0 || c.facturado !== 0 || c.cobrado !== 0 || c.al);
  const certs: CertPend[] = (cert.data ?? []).map((r) => ({ id: r.certificado_id as string, clienteId: r.cliente_id as string, numero: r.numero as number, emision: r.emision as string, total: num(r.total), pendiente: num(r.pendiente) }));
  const cobranzas: CobranzaFila[] = (cob.data ?? []).map((r) => {
    const cl = r.clientes as unknown as { razon_social: string } | { razon_social: string }[] | null;
    const items = (r.cobranza_items ?? []) as { monto: number }[];
    return { id: r.id as string, numero: Number(r.numero), fecha: r.fecha as string, cliente: (Array.isArray(cl) ? cl[0]?.razon_social : cl?.razon_social) ?? '—', monto: num(r.monto), imputado: items.reduce((a, i) => a + num(i.monto), 0), anulada: !!r.anulada, observaciones: (r.observaciones as string | null) ?? null };
  });
  const planilla = (d: { nombre: string; saldo: number }[] | null) => (d ?? []).map((x) => ({ nombre: x.nombre, saldo: num(x.saldo) }));
  return {
    listo: true as const, cuentas, certs, cobranzas,
    clientes: (cli.data ?? []).map((c) => ({ id: c.id as string, nombre: c.razon_social as string })),
    planillas: { cta: planilla(ctaP.data), diego: planilla(diegoP.data) },
  };
}

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; vista?: string }> }) {
  const acceso = await getAcceso();
  if (!acceso?.puedeVer('clientes')) return <SinAcceso seccion="Saldos de clientes" />;
  const { q, vista } = await searchParams;
  const planilla = vista === 'planilla';

  const datos = planilla ? null : await cuentaCorriente();
  const verPlanillas = planilla || (datos && !datos.listo);
  const [cta, diego] = verPlanillas ? await Promise.all([tabla('cta_clientes', q), tabla('clientes_diego', q)]) : [null, null];

  return (
    <>
      <h1>Saldos de clientes</h1>
      <div className="seg" style={{ marginBottom: 14 }}>
        <Link href="/clientes" aria-pressed={!planilla}>Cuenta corriente</Link>
        <Link href="/clientes?vista=planilla" aria-pressed={planilla}>Planillas (puente)</Link>
      </div>

      {datos && !datos.listo && (
        <div className="banner err">
          Falta correr las migraciones <strong>0015_modulo_caja.sql</strong> y <strong>0016_cobranzas_caja.sql</strong> en Supabase para usar la cuenta corriente. Mientras tanto se muestran las planillas. ({datos.error})
        </div>
      )}

      {datos?.listo && (
        <>
          <p className="lede">Deuda de cada cliente = saldo inicial + certificados aprobados − cobranzas. Cada cobranza en efectivo entra sola en la caja diaria.</p>
          <CuentaCorriente cuentas={datos.cuentas} certs={datos.certs} cobranzas={datos.cobranzas} clientes={datos.clientes} planillas={datos.planillas}
            puedeEscribir={acceso.puedeEscribir('clientes')} hoy={hoyAR()} />
        </>
      )}

      {cta && diego && (
        <>
          <p className="lede">
            Dos cuentas distintas, tal como las calculan hoy las planillas: no se suman entre sí. Sirven como referencia y para tomar los saldos iniciales.
          </p>
          <form className="filters" method="get">
            <input type="hidden" name="vista" value="planilla" />
            <input type="search" name="q" defaultValue={q ?? ''} placeholder="Buscar cliente" aria-label="Buscar cliente" />
            <button type="submit">Buscar</button>
          </form>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,460px),1fr))', gap: 16 }}>
            <Cuenta titulo="Cta Clientes (Planilla NORMOV)" rows={cta.rows} error={cta.error} />
            <Cuenta titulo="Clientes (NORMOV Diego)" rows={diego.rows} error={diego.error} />
          </div>
        </>
      )}
    </>
  );
}
