import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { money, fecha as fmtFecha } from '@/lib/format';
import { getAcceso } from '@/lib/permisos';
import { SinAcceso } from '@/components/sin-acceso';
import { FormMovimiento, Lista, type Mov } from './movimientos';

export const dynamic = 'force-dynamic';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
/** Suma días a una fecha "AAAA-MM-DD" sin depender de la zona horaria. */
function mover(f: string, dias: number) {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export default async function Caja({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const acceso = await getAcceso();
  if (!acceso?.puedeVer('caja')) return <SinAcceso seccion="Caja diaria" />;
  const hoy = hoyAR();
  const { fecha: f } = await searchParams;
  const fecha = f && FECHA.test(f) ? f : hoy;

  const supabase = await createClient();
  const [movsRes, apRes] = await Promise.all([
    supabase.from('caja_movimientos').select('id,tipo,concepto,monto,autor,anulado,cobranza_id').eq('fecha', fecha).order('creado'),
    supabase.rpc('caja_apertura', { p_fecha: fecha }),
  ]);
  const error = movsRes.error?.message ?? apRes.error?.message ?? null;
  const faltaMigracion = !!error && /caja_movimientos|caja_apertura|schema cache|does not exist/.test(error);

  const movs: Mov[] = (movsRes.data ?? []).map((m) => ({
    id: m.id as string, tipo: m.tipo as 'ingreso' | 'egreso', concepto: m.concepto as string, monto: Number(m.monto), autor: (m.autor as string | null) ?? null,
    anulado: !!m.anulado, deCobranza: !!m.cobranza_id,
  }));
  const vigentes = movs.filter((m) => !m.anulado);
  const ingresos = vigentes.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + m.monto, 0);
  const egresos = vigentes.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + m.monto, 0);
  const apertura = Number(apRes.data ?? 0);
  const cierre = apertura + ingresos - egresos;

  return (
    <>
      <h1>Caja diaria</h1>
      <p className="lede">Efectivo del día: las cobranzas entran solas; los gastos y otros ingresos se cargan acá. El saldo de cada día arranca con el cierre del anterior.</p>

      {faltaMigracion && <div className="banner err">Falta correr las migraciones <strong>0015_modulo_caja.sql</strong> y <strong>0016_cobranzas_caja.sql</strong> en Supabase. ({error})</div>}
      {!faltaMigracion && error && <div className="banner err">{error}</div>}

      <div className="filters" style={{ alignItems: 'center' }}>
        <Link className="btn" href={`/caja?fecha=${mover(fecha, -1)}`} aria-label="Día anterior">‹</Link>
        <form method="get" style={{ display: 'flex', gap: 6 }}>
          <input type="date" name="fecha" defaultValue={fecha} max={hoy} aria-label="Fecha" />
          <button type="submit">Ir</button>
        </form>
        <Link className="btn" href={`/caja?fecha=${mover(fecha, 1)}`} aria-label="Día siguiente" aria-disabled={fecha >= hoy}>›</Link>
        {fecha !== hoy && <Link className="btn" href="/caja">Hoy</Link>}
        <strong style={{ marginLeft: 8 }}>{fmtFecha(fecha)}</strong>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">Apertura</div><div className="v">{money(apertura)}</div></div>
        <div className="kpi"><div className="l">Ingresos</div><div className="v" style={{ color: 'var(--good)' }}>{money(ingresos)}</div></div>
        <div className="kpi"><div className="l">Egresos</div><div className="v" style={{ color: 'var(--bad)' }}>{money(egresos)}</div></div>
        <div className="kpi accent"><div className="l">Cierre del día</div><div className="v">{money(cierre)}</div></div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <Lista movs={movs} puedeEscribir={acceso.puedeEscribir('caja')} />
        {acceso.puedeEscribir('caja') && !faltaMigracion && <FormMovimiento fecha={fecha} />}
      </div>
    </>
  );
}
