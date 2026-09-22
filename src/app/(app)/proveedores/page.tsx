import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Saldo { id: string; nombre: string; debe: number; haber: number; saldo: number; movimientos: number }

export default async function Proveedores({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from('v_saldo_proveedores').select('*').order('saldo', { ascending: false }).limit(1000);
  if (q) query = query.ilike('nombre', `%${q.replace(/[%,()]/g, ' ')}%`);
  const { data, error } = await query;
  const rows = (data ?? []) as Saldo[];

  const debe = rows.reduce((a, r) => a + r.debe, 0);
  const haber = rows.reduce((a, r) => a + r.haber, 0);

  return (
    <>
      <h1>Saldos de proveedores</h1>
      <p className="lede">Saldo = compras y gastos (Debe) menos pagos (Haber), acumulado de toda la cuenta corriente.</p>

      <form className="filters" method="get">
        <input type="search" name="q" defaultValue={q ?? ''} placeholder="Buscar proveedor" aria-label="Buscar proveedor" />
        <button type="submit">Buscar</button>
      </form>

      {error && <div className="banner err">{error.message}</div>}

      <div className="kpis">
        <div className="kpi accent"><div className="l">Saldo a pagar</div><div className="v">{money(debe - haber)}</div></div>
        <div className="kpi"><div className="l">Compras y gastos</div><div className="v">{money(debe)}</div></div>
        <div className="kpi"><div className="l">Pagos</div><div className="v">{money(haber)}</div></div>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Proveedor</th><th className="r">Debe</th><th className="r">Haber</th><th className="r">Saldo</th><th className="r">Mov.</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td><td className="r">{money(r.debe)}</td><td className="r">{money(r.haber)}</td>
                <td className="r"><strong>{money(r.saldo)}</strong></td><td className="r muted">{r.movimientos}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="muted">Sin resultados.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
