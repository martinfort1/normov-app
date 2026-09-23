import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { periodoDe, rangoGrafico, hoyAR, type PeriodoParams } from '@/lib/periodo';
import { chartBuckets } from '@/lib/chart-buckets';
import { agrupar } from '@/lib/agrupar';
import { fecha, money, num1, num2, remito } from '@/lib/format';
import { conParams } from '@/lib/query';
import { PeriodoSwitcher } from '@/components/periodo-switcher';
import { FiltroMulti } from '@/components/filtro-multi';
import { filtrar } from '@/lib/filtrar';
import { BarChart, type Serie } from '@/components/bar-chart';
import { GroupTable } from '@/components/group-table';

export const dynamic = 'force-dynamic';

interface Remito {
  id: string; numero: string; fecha: string; camion: string | null; chofer: string | null; cantera: string | null;
  cantidad: number; precio: number; total: number; costo: number; neto: number;
  clientes: { razon_social: string } | null;
  obras: { nombre: string } | null;
  materiales: { nombre: string; unidad: string } | null;
}
type Agrupacion = 'razon' | 'cliente';
type Params = PeriodoParams & { agrupar?: string; cliente?: string; material?: string; camion?: string; chofer?: string; cantera?: string };

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();

export default async function Operaciones({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const per = periodoDe(sp);
  const agrupacion: Agrupacion = sp.agrupar === 'cliente' ? 'cliente' : 'razon';
  const campoCliente = (r: Remito) => (agrupacion === 'razon' ? r.clientes?.razon_social ?? null : r.obras?.nombre ?? null);
  const rango = rangoGrafico(per);
  const supabase = await createClient();

  let outer: Remito[] = [];
  let error: string | null = null;
  try {
    outer = (await fetchAll((from, to) =>
      supabase
        .from('remitos')
        .select('id,numero,fecha,camion,chofer,cantera,cantidad,precio,total,costo,neto,clientes(razon_social),obras(nombre),materiales(nombre,unidad)')
        .gte('fecha', rango.desde).lte('fecha', rango.hasta)
        .order('fecha', { ascending: false }).order('numero', { ascending: false })
        .range(from, to),
    )) as unknown as Remito[];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error al consultar los remitos';
  }

  const enPeriodo = outer.filter((r) => r.fecha >= per.desde && r.fecha <= per.hasta);
  const filtrados = filtrar(enPeriodo, sp, {
    cliente: campoCliente, material: (r) => r.materiales?.nombre ?? null, camion: (r) => r.camion, chofer: (r) => r.chofer, cantera: (r) => r.cantera,
  });
  const paraGrafico = filtrar(outer, sp, {
    cliente: campoCliente, material: (r) => r.materiales?.nombre ?? null, camion: (r) => r.camion, chofer: (r) => r.chofer, cantera: (r) => r.cantera,
  });
  const hayFiltros = ['cliente', 'material', 'camion', 'chofer', 'cantera'].some((k) => sp[k as keyof Params]);

  // ───── tarjetas ─────
  const tot = filtrados.reduce((a, r) => {
    a.n++;
    const u = r.materiales?.unidad ?? 'm3';
    if (u === 't') a.t += r.cantidad; else if (u === 'h') a.h += r.cantidad; else a.m3 += r.cantidad;
    a.neto += r.neto; a.costo += r.costo;
    return a;
  }, { n: 0, m3: 0, t: 0, h: 0, neto: 0, costo: 0 });
  const mg = tot.neto - tot.costo, pct = tot.neto ? (mg / tot.neto) * 100 : 0;

  // ───── gráficos ─────
  const B = chartBuckets(per, hoyAR());
  const clave = (r: Remito) => (B.byMonth ? r.fecha.slice(0, 7) : r.fecha);
  const enVentana = (r: Remito) => (B.byMonth ? B.keys.includes(r.fecha.slice(0, 7)) : B.keys.includes(r.fecha));
  const hasT = paraGrafico.some((r) => r.materiales?.unidad === 't' && enVentana(r));
  const hasM = paraGrafico.some((r) => (r.materiales?.unidad ?? 'm3') === 'm3' && enVentana(r));
  const volSeries: Serie<Remito>[] = [];
  if (hasM || !hasT) volSeries.push({ nombre: 'm³', color: 'var(--bronze)', valor: (r) => ((r.materiales?.unidad ?? 'm3') === 'm3' ? r.cantidad : 0) });
  if (hasT) volSeries.push({ nombre: 'toneladas (cenizas)', color: 'var(--ink-2)', valor: (r) => (r.materiales?.unidad === 't' ? r.cantidad : 0) });
  const viajesSeries: Serie<Remito>[] = [{ nombre: 'viajes', color: 'var(--orange)', valor: () => 1 }];
  const chartSub = per.modo === 'dia' ? 'últimos 14 días, resaltado el elegido' : per.modo === 'anio' || B.byMonth ? 'por mes' : 'por día';

  // ───── tablas agrupadas ─────
  const paraAgg = filtrados.map((r) => ({ ...r, unidad: r.materiales?.unidad ?? 'm3', neto: r.neto, costo: r.costo, cantidad: r.cantidad }));
  const porMaterial = agrupar(paraAgg, (r) => r.materiales?.nombre ?? '(sin dato)');
  const porCliente = agrupar(paraAgg, (r) => campoCliente(r) ?? '(sin dato)');
  const porChofer = agrupar(paraAgg, (r) => r.chofer ?? '(sin dato)');
  const porCamion = agrupar(paraAgg, (r) => r.camion ?? '(sin dato)');
  const porCantera = agrupar(paraAgg, (r) => r.cantera ?? '(sin dato)');

  const esTipas = (sp.cantera ?? '') === 'TIPAS';

  return (
    <>
      <h1>Operaciones</h1>
      <p className="lede">Viajes de {per.etiqueta}, una fila por remito. Los filtros se aplican a los indicadores, los gráficos y las tablas.</p>
      <PeriodoSwitcher per={per} />

      <div className="row" style={{ marginBottom: 16 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Agrupar clientes por</span>
        <div className="seg">
          <a href={conParams(sp, { agrupar: null })} aria-pressed={agrupacion === 'razon'}>Razón social</a>
          <a href={conParams(sp, { agrupar: 'cliente' })} aria-pressed={agrupacion === 'cliente'}>Cliente / obra</a>
        </div>
      </div>

      <div className="filters">
        <a href={conParams(sp, { cantera: esTipas ? null : 'TIPAS' })} className="chip" aria-pressed={esTipas}>Nuestra cantera · TIPAS</a>
        <FiltroMulti name="cantera" label="Cantera" opciones={uniq(enPeriodo.map((r) => r.cantera))} />
        <FiltroMulti name="material" label="Material" opciones={uniq(enPeriodo.map((r) => r.materiales?.nombre ?? null))} />
        <FiltroMulti name="cliente" label={agrupacion === 'razon' ? 'Cliente' : 'Cliente / obra'} opciones={uniq(enPeriodo.map(campoCliente))} />
        <FiltroMulti name="camion" label="Camión" opciones={uniq(enPeriodo.map((r) => r.camion))} />
        <FiltroMulti name="chofer" label="Chofer" opciones={uniq(enPeriodo.map((r) => r.chofer))} />
        {hayFiltros && <a href="?" className="pill bad" style={{ textDecoration: 'none' }}>Quitar filtros</a>}
      </div>

      {error && <div className="banner err">{error}</div>}

      <div className="kpis">
        <div className="kpi accent"><div className="l">Viajes · {per.etiqueta}</div><div className="v">{num1(tot.n)}</div><div className="s">remitos</div></div>
        <div className="kpi"><div className="l">Metros cúbicos</div><div className="v">{num1(tot.m3)}</div><div className="s">{tot.h ? `${num1(tot.h)} horas de máquina` : 'áridos y tierra'}</div></div>
        <div className="kpi"><div className="l">Toneladas</div><div className="v">{num1(tot.t)}</div><div className="s">cenizas del ingenio</div></div>
        <div className="kpi"><div className="l">Venta neta</div><div className="v">{money(tot.neto)}</div><div className="s">sin IVA · costo material {money(tot.costo)}</div></div>
        <div className="kpi"><div className="l">Margen</div><div className="v" style={{ color: mg < 0 ? 'var(--bad)' : undefined }}>{money(mg)}</div><div className="s">{num1(pct)}% sobre venta neta</div></div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <h3>Volumen</h3>
          <div className="row" style={{ gap: 10 }}>
            {volSeries.map((s) => <span className="lg" key={s.nombre}><i style={{ background: s.color }} />{s.nombre}</span>)}
          </div>
        </div>
        <p className="note">{chartSub}</p>
        <div className="chart"><BarChart buckets={B} series={volSeries} rows={paraGrafico} clave={clave} fmt={num1} aria="Volumen transportado" /></div>
      </div>

      <div className="panel">
        <div className="panel-h"><h3>Cantidad de viajes</h3><span className="lg"><i style={{ background: 'var(--orange)' }} />viajes</span></div>
        <p className="note">{chartSub}</p>
        <div className="chart"><BarChart buckets={B} series={viajesSeries} rows={paraGrafico} clave={clave} fmt={num1} aria="Cantidad de viajes" /></div>
      </div>

      <div className="panel">
        <h3 style={{ marginBottom: 4 }}>Por material · margen</h3>
        <p className="note">Margen = venta neta − costo de material de cada remito. Cenizas en toneladas.</p>
        <GroupTable titulo="Material" rows={porMaterial} showMargin />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,460px),1fr))', gap: 16 }}>
        <div className="panel"><h3 style={{ marginBottom: 10 }}>Por {agrupacion === 'razon' ? 'razón social' : 'cliente / obra'}</h3><GroupTable titulo={agrupacion === 'razon' ? 'Razón social' : 'Cliente / obra'} rows={porCliente} /></div>
        <div className="panel"><h3 style={{ marginBottom: 10 }}>Por chofer</h3><GroupTable titulo="Chofer" rows={porChofer} /></div>
        <div className="panel"><h3 style={{ marginBottom: 10 }}>Por camión</h3><GroupTable titulo="Camión" rows={porCamion} /></div>
        <div className="panel"><h3 style={{ marginBottom: 10 }}>Por cantera</h3><GroupTable titulo="Cantera" rows={porCantera} /></div>
      </div>

      <div className="panel">
        <h3 style={{ marginBottom: 10 }}>Remitos</h3>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Remito</th><th>{agrupacion === 'razon' ? 'Razón social' : 'Cliente / obra'}</th><th>Material</th><th>Camión</th><th>Chofer</th>
              <th className="r">Cant.</th><th className="r">Precio</th><th className="r">Total</th></tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 500).map((r) => (
              <tr key={r.id}>
                <td>{fecha(r.fecha)}</td><td>{remito(r.numero)}</td><td>{campoCliente(r) ?? '—'}</td>
                <td>{r.materiales?.nombre ?? '—'}</td><td>{r.camion ?? '—'}</td><td>{r.chofer ?? '—'}</td>
                <td className="r">{num2(r.cantidad)}</td><td className="r">{money(r.precio)}</td><td className="r">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 500 && <p className="muted">Se muestran los primeros 500 de {filtrados.length}. Los totales incluyen todos.</p>}
      </div>
    </>
  );
}
