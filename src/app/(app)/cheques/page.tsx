import { createClient } from '@/lib/supabase/server';
import { fecha, money } from '@/lib/format';
import { periodoDe, type PeriodoParams } from '@/lib/periodo';
import { PeriodoSwitcher } from '@/components/periodo-switcher';
import { TogglePeriodo } from '@/components/toggle-periodo';

export const dynamic = 'force-dynamic';

interface Cheque {
  id: string; tipo: string; contraparte: string | null; numero: string | null; banco: string | null;
  monto: number; vencimiento: string | null; estado: string; dias: number | null; semaforo: string;
}

const SEM: Record<string, [string, string]> = {
  vencido: ['bad', 'Vencido'], por_vencer: ['warn', 'Por vencer'], ok: ['good', 'En fecha'], sin_fecha: ['', 'Sin fecha'],
};

export default async function Cheques({ searchParams }: { searchParams: Promise<PeriodoParams & { conPeriodo?: string }> }) {
  const sp = await searchParams;
  const conPeriodo = sp.conPeriodo === '1';
  const per = periodoDe(sp);
  const supabase = await createClient();

  let query = supabase.from('v_cheques_panel').select('*').neq('semaforo', 'cerrado');
  if (conPeriodo) query = query.gte('vencimiento', per.desde).lte('vencimiento', per.hasta);
  const { data, error } = await query.order('vencimiento', { ascending: true, nullsFirst: false }).limit(1000);
  const rows = (data ?? []) as Cheque[];
  const suma = (s: string) => rows.filter((r) => r.semaforo === s).reduce((a, r) => a + r.monto, 0);

  return (
    <>
      <h1>Cheques</h1>
      <p className="lede">Semáforo por vencimiento contra la fecha de hoy. Los debitados y endosados no aparecen acá.</p>

      <div className="filters">
        <TogglePeriodo label="Filtrar por período (vencimiento)" />
        {conPeriodo && <PeriodoSwitcher per={per} />}
      </div>

      {error && <div className="banner err">{error.message}</div>}

      <div className="kpis">
        <div className="kpi"><div className="l">Vencidos</div><div className="v">{money(suma('vencido'))}</div></div>
        <div className="kpi"><div className="l">Vencen en 7 días</div><div className="v">{money(suma('por_vencer'))}</div></div>
        <div className="kpi"><div className="l">En fecha</div><div className="v">{money(suma('ok'))}</div></div>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Vence</th><th>Días</th><th>Tipo</th><th>Cliente / proveedor</th><th>N°</th><th>Banco</th><th>Estado</th><th className="r">Monto</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const [cls, txt] = SEM[r.semaforo] ?? ['', r.semaforo];
              return (
                <tr key={r.id}>
                  <td>{fecha(r.vencimiento)}</td><td className="r">{r.dias ?? '—'}</td><td>{r.tipo}</td><td>{r.contraparte ?? '—'}</td>
                  <td>{r.numero ?? '—'}</td><td>{r.banco ?? '—'}</td><td>{r.estado}</td><td className="r">{money(r.monto)}</td>
                  <td><span className={`pill ${cls}`}>{txt}</span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="muted">No hay cheques activos{conPeriodo ? ' en el período.' : '.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
