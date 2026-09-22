import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { periodoDe, type PeriodoParams } from '@/lib/periodo';
import { fecha, money, num1, num2, UNIDAD } from '@/lib/format';
import { PeriodoSwitcher } from '@/components/periodo-switcher';
import { Donut } from '@/components/donut';
import { FiltroMulti } from '@/components/filtro-multi';
import { filtrar } from '@/lib/filtrar';

export const dynamic = 'force-dynamic';

interface Remito {
  numero: string; fecha: string; camion: string | null; chofer: string | null; cantera: string | null;
  cantidad: number; precio: number; total: number; costo: number;
  clientes: { razon_social: string } | null;
  obras: { nombre: string } | null;
  materiales: { nombre: string; unidad: string } | null;
}
type Params = PeriodoParams & { cliente?: string; material?: string; camion?: string; chofer?: string; cantera?: string };

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();

export default async function Operaciones({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const per = periodoDe(sp);
  const supabase = await createClient();

  let all: Remito[] = [];
  let error: string | null = null;
  try {
    all = (await fetchAll((from, to) =>
      supabase
        .from('remitos')
        .select('numero,fecha,camion,chofer,cantera,cantidad,precio,total,costo,clientes(razon_social),obras(nombre),materiales(nombre,unidad)')
        .gte('fecha', per.desde).lte('fecha', per.hasta)
        .order('fecha', { ascending: false }).order('numero', { ascending: false })
        .range(from, to),
    )) as unknown as Remito[];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error al consultar los remitos';
  }

  const rows = filtrar(all, sp, {
    cliente: (r) => r.clientes?.razon_social ?? null, material: (r) => r.materiales?.nombre ?? null,
    camion: (r) => r.camion, chofer: (r) => r.chofer, cantera: (r) => r.cantera,
  });
  const hayFiltros = ['cliente', 'material', 'camion', 'chofer', 'cantera'].some((k) => sp[k as keyof Params]);

  const total = rows.reduce((a, r) => a + r.total, 0);
  const costo = rows.reduce((a, r) => a + r.costo, 0);
  const porUnidad = new Map<string, number>();
  for (const r of rows) {
    const u = r.materiales?.unidad ?? 'm3';
    porUnidad.set(u, (porUnidad.get(u) ?? 0) + r.cantidad);
  }
  const porCliente = new Map<string, { viajes: number; cantidad: number; total: number }>();
  for (const r of rows) {
    const k = r.clientes?.razon_social ?? '(sin dato)';
    const o = porCliente.get(k) ?? { viajes: 0, cantidad: 0, total: 0 };
    o.viajes++; o.cantidad += r.cantidad; o.total += r.total;
    porCliente.set(k, o);
  }
  const clientes = [...porCliente.entries()].sort((a, b) => b[1].total - a[1].total);
  const maxTotal = clientes[0]?.[1].total || 1;

  return (
    <>
      <h1>Operaciones</h1>
      <p className="lede">Viajes de {per.etiqueta}, una fila por remito. Los filtros se aplican a los indicadores, el gráfico y la tabla.</p>
      <PeriodoSwitcher per={per} />

      <div className="filters">
        <FiltroMulti name="cliente" label="Cliente" opciones={uniq(all.map((r) => r.clientes?.razon_social ?? null))} />
        <FiltroMulti name="material" label="Material" opciones={uniq(all.map((r) => r.materiales?.nombre ?? null))} />
        <FiltroMulti name="camion" label="Camión" opciones={uniq(all.map((r) => r.camion))} />
        <FiltroMulti name="chofer" label="Chofer" opciones={uniq(all.map((r) => r.chofer))} />
        <FiltroMulti name="cantera" label="Cantera" opciones={uniq(all.map((r) => r.cantera))} />
        {hayFiltros && <a href="?" className="pill bad" style={{ textDecoration: 'none' }}>Quitar filtros</a>}
      </div>

      {error && <div className="banner err">{error}</div>}

      <div className="kpis">
        <div className="kpi accent"><div className="l">Facturado</div><div className="v">{money(total)}</div></div>
        <div className="kpi"><div className="l">Viajes</div><div className="v">{rows.length}</div></div>
        {[...porUnidad].map(([u, c]) => (
          <div className="kpi" key={u}><div className="l">Cantidad ({UNIDAD[u]})</div><div className="v">{num1(c)}</div></div>
        ))}
        <div className="kpi"><div className="l">Costo de material</div><div className="v">{money(costo)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,460px),1fr))', gap: 16, alignItems: 'start' }}>
        <div className="panel">
          <h2 style={{ marginBottom: 12 }}>Por cliente</h2>
          <Donut slices={clientes.map(([label, o]) => ({ label, value: o.total }))} fmt={money} centro="facturado" />
        </div>
        <div className="panel">
          <h2 style={{ marginBottom: 12 }}>Detalle por cliente</h2>
          <table>
            <thead><tr><th>Razón social</th><th className="r">Viajes</th><th className="r">Cantidad</th><th className="r">Total</th><th /></tr></thead>
            <tbody>
              {clientes.map(([n, o]) => (
                <tr key={n}>
                  <td>{n}</td><td className="r">{o.viajes}</td><td className="r">{num1(o.cantidad)}</td><td className="r">{money(o.total)}</td>
                  <td className="bar" style={{ minWidth: 90 }}><span style={{ width: `${(o.total / maxTotal) * 100}%` }} /></td>
                </tr>
              ))}
              {!clientes.length && <tr><td colSpan={5} className="muted">Sin remitos en el período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 12 }}>Remitos</h2>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Remito</th><th>Razón social</th><th>Obra</th><th>Material</th><th>Camión</th><th>Chofer</th>
              <th className="r">Cant.</th><th className="r">Precio</th><th className="r">Total</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((r) => (
              <tr key={r.numero}>
                <td>{fecha(r.fecha)}</td><td>{r.numero}</td><td>{r.clientes?.razon_social ?? '—'}</td><td>{r.obras?.nombre ?? '—'}</td>
                <td>{r.materiales?.nombre ?? '—'}</td><td>{r.camion ?? '—'}</td><td>{r.chofer ?? '—'}</td>
                <td className="r">{num2(r.cantidad)}</td><td className="r">{money(r.precio)}</td><td className="r">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 && <p className="muted">Se muestran los primeros 500 de {rows.length}. Los totales incluyen todos.</p>}
      </div>
    </>
  );
}
