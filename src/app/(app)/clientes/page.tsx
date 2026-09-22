import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';

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

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const [cta, diego] = await Promise.all([tabla('cta_clientes', q), tabla('clientes_diego', q)]);

  return (
    <>
      <h1>Saldos de clientes</h1>
      <p className="lede">
        Dos cuentas distintas, tal como las calculan hoy las planillas: no se suman entre sí. Esta pantalla es un puente
        hasta que la facturación y las cobranzas se carguen directo en la app.
      </p>

      <form className="filters" method="get">
        <input type="search" name="q" defaultValue={q ?? ''} placeholder="Buscar cliente" aria-label="Buscar cliente" />
        <button type="submit">Buscar</button>
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,460px),1fr))', gap: 16 }}>
        <Cuenta titulo="Cta Clientes (Planilla NORMOV)" rows={cta.rows} error={cta.error} />
        <Cuenta titulo="Clientes (NORMOV Diego)" rows={diego.rows} error={diego.error} />
      </div>
    </>
  );
}
