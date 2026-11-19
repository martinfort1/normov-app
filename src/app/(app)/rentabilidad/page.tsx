import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';
import { fetchAll } from '@/lib/fetch-all';
import { periodoDe, type PeriodoParams } from '@/lib/periodo';
import { fecha, money, num1 } from '@/lib/format';
import { PeriodoSwitcher } from '@/components/periodo-switcher';
import { SinAcceso } from '@/components/sin-acceso';
import { calcularRentabilidad, GAS_DEFECTO, type Camion, type Carga, type Fila, type GastoProv, type PorTipo, type PrecioGas, type TipoViaje, type Viaje } from '@/lib/rentabilidad';
import type { ListaCosto } from '@/lib/costos';

export const dynamic = 'force-dynamic';

type Params = PeriodoParams & { seg?: string; ing?: string; prorr?: string; horas?: string; gas?: string; camion?: string };
const pct = (v: number | null) => (v == null || !isFinite(v) ? '—' : `${num1(Math.round(v * 1000) / 10)}%`);
const Mg = ({ v }: { v: number | null }) => (v == null ? <span className="muted">—</span> : <span className={`pill ${v < 0 ? 'bad' : v < 0.1 ? 'warn' : 'good'}`}>{pct(v)}</span>);

export default async function Rentabilidad({ searchParams }: { searchParams: Promise<Params> }) {
  const acceso = await getAcceso();
  // Muestra márgenes y costos: solo administradores y quien tenga Caja diaria
  if (!acceso || !(acceso.esAdmin || acceso.puedeVer('caja'))) return <SinAcceso seccion="Rentabilidad" />;
  const sp = await searchParams;
  const per = periodoDe(sp);
  const seg = sp.seg === 'Minorista' || sp.seg === 'Mayorista' ? sp.seg : 'todos';
  const incluirIngenio = sp.ing !== '0', repartir = sp.prorr === '1';
  const horas = Number(sp.horas) > 0 ? Number(sp.horas) : 8;
  const precioGas = Number(sp.gas) > 0 ? Number(sp.gas) : null;
  const supabase = await createClient();

  let error: string | null = null;
  const seguro = async <T,>(f: () => Promise<T[]>): Promise<T[]> => { try { return await f(); } catch (e) { error ??= (e as Error).message; return []; } };

  const [camionesDb, remitos, cargas, preciosGas, costosDb, gastosDb] = await Promise.all([
    seguro(async () => ((await supabase.from('camiones').select('*')).data ?? []) as { patente: string; capacidad: number; solo_mayorista?: boolean }[]),
    seguro(() => fetchAll<{ numero: string; fecha: string; camion: string | null; chofer: string | null; cantera: string | null; cantidad: number; total: number; neto: number; costo: number; clientes: { razon_social: string } | null; materiales: { nombre: string } | null }>((a, b) =>
      supabase.from('remitos').select('numero,fecha,camion,chofer,cantera,cantidad,total,neto,costo,clientes(razon_social),materiales(nombre)').gte('fecha', per.desde).lte('fecha', per.hasta).order('fecha').order('id').range(a, b))),
    seguro(() => fetchAll<{ fecha: string; patente: string; litros: number }>((a, b) =>
      supabase.from('cargas_combustible').select('fecha,patente,litros').eq('es_camion', true).gte('fecha', per.desde).lte('fecha', per.hasta).order('fecha').order('id').range(a, b))),
    seguro(async () => ((await supabase.from('precios_combustible').select('vigente_desde,precio')).data ?? []) as { vigente_desde: string; precio: number }[]),
    seguro(async () => ((await supabase.from('lista_costos').select('cantera,material,desde,costo_m3')).data ?? []) as { cantera: string; material: string; desde: string; costo_m3: number }[]),
    seguro(() => fetchAll<{ fecha: string; centro_costo: string | null; rubro: string | null; subrubro: string | null; detalle: string | null; nro_factura: string | null; observaciones: string | null; debe: number; proveedores: { nombre: string } | null }>((a, b) =>
      supabase.from('movimientos_proveedor').select('fecha,centro_costo,rubro,subrubro,detalle,nro_factura,observaciones,debe,proveedores(nombre)').gt('debe', 0).gte('fecha', per.desde).lte('fecha', per.hasta).order('fecha').order('id').range(a, b))),
  ]);

  const camiones: Camion[] = camionesDb.map((c) => ({ patente: c.patente, rubro: c.solo_mayorista || Number(c.capacidad) > 12 ? 'Mayorista' : 'Minorista' }));
  const viajes: Viaje[] = remitos.map((r) => ({
    fecha: r.fecha, camion: r.camion, chofer: r.chofer, material: r.materiales?.nombre ?? '(sin dato)', cantera: r.cantera, m3: Number(r.cantidad),
    venta: Number(r.neto) || Number(r.total) || 0, costo: Number(r.costo), remito: r.numero, cliente: r.clientes?.razon_social ?? '—',
  }));
  const cargasC: Carga[] = cargas.map((c) => ({ fecha: c.fecha, patente: c.patente, litros: Number(c.litros) }));
  const pg: PrecioGas[] = preciosGas.map((p) => ({ desde: p.vigente_desde, precio: Number(p.precio) }));
  const costos: ListaCosto[] = costosDb.map((c) => ({ cantera: c.cantera, material: c.material, desde: c.desde, m3: Number(c.costo_m3) }));
  const gastos: GastoProv[] = gastosDb.map((m) => ({ fecha: m.fecha, proveedor: m.proveedores?.nombre ?? '', rubro: m.rubro ?? '', subrubro: m.subrubro ?? '', centro: m.centro_costo ?? '', detalle: m.detalle ?? '', obs: m.observaciones ?? '', factura: m.nro_factura ?? '', debe: Number(m.debe) }));

  const X = calcularRentabilidad({ camiones, viajes, cargas: cargasC, preciosGas: pg, costos, gastos, hasta: per.hasta }, { incluirIngenio, repartir, horas, precioGas });
  const vis = X.list.filter((o) => (seg === 'todos' || o.rubro === seg) && (o.viajes || o.litros || o.mecT))
    .sort((a, b) => (a.rubro === b.rubro ? 0 : a.rubro === 'Minorista' ? -1 : 1) || b.res - a.res);
  const suma = (a: Fila[], k: 'ventas' | 'mat' | 'gas' | 'chofer' | 'mecT' | 'viajes' | 'm3' | 'litros') => a.reduce((s, o) => s + o[k], 0);
  const tot = (a: Fila[]) => { const t = { ventas: suma(a, 'ventas'), mat: suma(a, 'mat'), gas: suma(a, 'gas'), chofer: suma(a, 'chofer'), mecT: suma(a, 'mecT'), viajes: suma(a, 'viajes'), m3: suma(a, 'm3'), litros: suma(a, 'litros'), res: 0, mg: null as number | null };
    t.res = t.ventas - t.mat - t.gas - t.chofer - t.mecT; t.mg = t.ventas ? t.res / t.ventas : null; return t; };
  const T = tot(vis);

  const qs = (c: Partial<Params>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...c })) if (v != null && v !== '') p.set(k, String(v));
    return `/rentabilidad?${p.toString()}`;
  };
  const RB: Partial<Record<TipoViaje, PorTipo>> = {};
  for (const o of vis) for (const [n, R] of Object.entries(o.rub) as [TipoViaje, PorTipo][]) {
    const a = RB[n] ?? (RB[n] = { viajes: 0, m3: 0, ventas: 0, mat: 0, chofer: 0, gas: 0, mec: 0, res: 0 });
    for (const k of Object.keys(a) as (keyof PorTipo)[]) a[k] += R[k];
  }
  const tipos = (['Minorista', 'Mayorista', 'Ingenio'] as const).filter((n) => RB[n]?.viajes);
  const sel = X.list.find((o) => o.k === sp.camion);

  const faltan = new Map<string, number>(), estim = new Map<string, number>();
  for (const o of vis) {
    for (const r of o.sinC) { const k = `${o.rubro} · ${r.cantera ?? '—'} · ${r.material}`; faltan.set(k, (faltan.get(k) ?? 0) + 1); }
    for (const g of o.porMat.values()) for (const s of g.src) if (!['lista de costos', 'ingenio', 'sin costo'].includes(s)) { const k = `${g.cantera} · ${g.material} → ${s}`; estim.set(k, (estim.get(k) ?? 0) + g.viajes); }
  }
  const gasDef = suma(vis, 'litros') ? vis.reduce((s, o) => s + o.gasDef, 0) : 0;

  const fila = (o: Fila) => {
    const chs = [...o.ch].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]).join(', ');
    return (
      <tr key={o.k}>
        <td><Link href={qs({ camion: sp.camion === o.k ? '' : o.k })} prefetch={false}><strong>{o.k}</strong></Link>
          {o.sinC.length > 0 && <> <span className="pill warn" title="Viajes sin costo de material">{o.sinC.length} sin costo</span></>}
          <br /><span className="muted" style={{ fontSize: 12 }}>{chs || '—'}</span></td>
        <td className="r">{o.viajes}</td><td className="r">{num1(o.m3)}</td><td className="r">{money(o.ventas)}</td><td className="r">{money(o.mat)}</td>
        <td className="r">{money(o.gas)}<br /><span className="muted" style={{ fontSize: 12 }}>{num1(o.litros)} L</span></td>
        <td className="r">{money(o.chofer)}</td>
        <td className="r">{money(o.mecT)}{o.mecPror > 0 && <><br /><span className="muted" style={{ fontSize: 12 }}>{money(o.mecPror)} repartido</span></>}</td>
        <td className="r"><strong style={o.res < 0 ? { color: 'var(--bad)' } : undefined}>{money(o.res)}</strong></td>
        <td className="r"><Mg v={o.mg} /></td><td className="r">{o.viajes ? money(o.res / o.viajes) : '—'}</td>
      </tr>
    );
  };
  const sub = (n: string, a: Fila[]) => { const t = tot(a); return (
    <tr className="total" key={n}><td>{n}</td><td className="r">{t.viajes}</td><td className="r">{num1(t.m3)}</td><td className="r">{money(t.ventas)}</td><td className="r">{money(t.mat)}</td>
      <td className="r">{money(t.gas)}</td><td className="r">{money(t.chofer)}</td><td className="r">{money(t.mecT)}</td><td className="r">{money(t.res)}</td><td className="r"><Mg v={t.mg} /></td><td className="r">{t.viajes ? money(t.res / t.viajes) : '—'}</td></tr>
  ); };
  const grupos: ('Minorista' | 'Mayorista')[] = seg === 'todos' ? ['Minorista', 'Mayorista'] : [seg];

  // Lectura del período
  const act = vis.filter((o) => o.viajes >= 3 && o.ventas > 0);
  const lect: string[] = [];
  if (act.length > 1) {
    const by = [...act].sort((a, b) => (b.mg ?? 0) - (a.mg ?? 0)), best = by[0], worst = by[by.length - 1];
    lect.push(`${best.k} es el que más deja: ${pct(best.mg)} de margen (${money(best.res)}, ${money(best.res / best.viajes)} por viaje). El que menos deja es ${worst.k} con ${pct(worst.mg)}.`);
  }
  const neg = act.filter((o) => o.res < 0);
  if (neg.length) lect.push(`${neg.length === 1 ? 'Un camión pierde' : neg.length + ' camiones pierden'} plata en el período: ${neg.map((o) => `${o.k} (${money(o.res)})`).join(', ')}. Mirá en su detalle si es por arreglos puntuales o porque el material cuesta casi lo mismo que se vende.`);
  const mec = act.filter((o) => o.mecT / o.ventas > 0.15);
  if (mec.length) lect.push(`Arreglos altos: ${mec.map((o) => `${o.k} gastó en taller el ${pct(o.mecT / o.ventas)} de lo que vendió`).join('; ')}.`);
  for (const rb of ['Minorista', 'Mayorista'] as const) {
    const g = act.filter((o) => o.rubro === rb && o.litros > 0);
    if (g.length < 2) continue;
    const prom = g.reduce((a, o) => a + o.litros, 0) / g.reduce((a, o) => a + o.viajes, 0);
    const alto = g.filter((o) => o.litros / o.viajes > prom * 1.25);
    if (alto.length) lect.push(`Gasoil por viaje en ${rb.toLowerCase()}s: promedio ${num1(prom)} L. ${alto.map((o) => `${o.k} usa ${num1(o.litros / o.viajes)} L`).join(', ')}: más de 25% arriba.`);
  }
  const sinTot = vis.reduce((a, o) => a + o.sinC.length, 0);
  if (sinTot) lect.push(`Hay ${sinTot} viajes sin costo de material: el resultado de esos camiones está inflado. Abajo, en “Datos a revisar”, figura qué cantera y material falta cargar en Precios.`);

  const COMP: [string, keyof Fila, string][] = [['Material', 'mat', 'var(--c1)'], ['Gasoil', 'gas', 'var(--c2)'], ['Chofer', 'chofer', 'var(--c3)'], ['Arreglos', 'mecT', 'var(--c5)']];
  const barra = (o: Fila) => {
    const total = Math.max(o.ventas, o.costo + o.mecT);
    if (!total) return <p className="muted">sin movimientos</p>;
    const segs = COMP.map(([l, k, c]) => ({ l, v: o[k] as number, c })).concat(o.res > 0 ? [{ l: 'Resultado', v: o.res, c: 'var(--good)' }] : []).filter((s) => s.v > 0);
    return <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--surface-2)' }}>{segs.map((s) => <span key={s.l} title={`${s.l}: ${money(s.v)}`} style={{ width: `${(s.v / total) * 100}%`, background: s.c }} />)}</div>;
  };
  const periodoHidden = (['modo', 'dia', 'mes', 'anio', 'desde', 'hasta', 'seg'] as const).filter((k) => sp[k]);

  return (
    <>
      <h1>Rentabilidad por camión</h1>
      <p className="lede">Ventas de {per.etiqueta} menos material, gasoil, chofer y arreglos de cada camión propio. Montos sin IVA.</p>
      <PeriodoSwitcher per={per} />
      {error && <div className="banner err">No se pudo leer parte de los datos: {error}</div>}

      <div className="seg" style={{ margin: '12px 0' }}>
        {(['todos', 'Minorista', 'Mayorista'] as const).map((s) => <Link key={s} href={qs({ seg: s === 'todos' ? '' : s, camion: '' })} prefetch={false} aria-pressed={seg === s} className="btn">{s === 'todos' ? 'Todos' : s}</Link>)}
      </div>
      <form method="get" className="panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'end', marginBottom: 16 }}>
        {periodoHidden.map((k) => <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <label>Gasoil sin precio ($/litro)<br /><input name="gas" type="number" min="0" step="1" defaultValue={precioGas ?? ''} placeholder={String(GAS_DEFECTO)} style={{ width: 120 }} /></label>
        <label>Horas por jornada (Ingenio)<br /><input name="horas" type="number" min="1" max="24" defaultValue={horas} style={{ width: 90 }} /></label>
        <label><input type="hidden" name="ing" value="0" /><input type="checkbox" name="ing" value="1" defaultChecked={incluirIngenio} /> Incluir ceniza / Ingenio</label>
        <label><input type="checkbox" name="prorr" value="1" defaultChecked={repartir} /> Repartir taller sin patente entre camiones</label>
        <button className="btn" type="submit">Aplicar</button>
      </form>

      <div className="kpis">
        <div className="kpi"><div className="l">Ventas</div><div className="v">{money(T.ventas)}</div><div className="s">{T.viajes} viajes · {num1(T.m3)} m³</div></div>
        <div className="kpi"><div className="l">Material + gasoil + chofer</div><div className="v">{money(T.mat + T.gas + T.chofer)}</div><div className="s">{pct(T.ventas ? (T.mat + T.gas + T.chofer) / T.ventas : null)} de las ventas</div></div>
        <div className="kpi"><div className="l">Arreglos</div><div className="v">{money(T.mecT)}</div><div className="s">{pct(T.ventas ? T.mecT / T.ventas : null)} de las ventas</div></div>
        <div className="kpi accent"><div className="l">Resultado de la flota</div><div className="v" style={T.res < 0 ? { color: 'var(--bad)' } : undefined}>{money(T.res)}</div><div className="s">{pct(T.mg)} de margen{T.viajes ? ` · ${money(T.res / T.viajes)} por viaje` : ''}</div></div>
      </div>

      {lect.length > 0 && <div className="panel" style={{ marginBottom: 16 }}><h2>Lectura del período</h2><ul>{lect.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Rentabilidad por camión</h2>
        <p className="note">Tocá una patente para ver qué llevó, sus arreglos y los viajes sin costo. El chofer se calcula con una tarifa por viaje (mayorista $15.000, minorista $10.000, +50% sábado y +100% domingo y feriado); el gasoil, con el precio por litro cargado en Combustible.</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Camión</th><th className="r">Viajes</th><th className="r">m³</th><th className="r">Ventas</th><th className="r">Material</th><th className="r">Gasoil</th><th className="r">Chofer</th><th className="r">Arreglos</th><th className="r">Resultado</th><th className="r">Margen</th><th className="r">Por viaje</th></tr></thead>
          <tbody>
            {vis.length === 0 && <tr><td colSpan={11} className="muted">Sin viajes de camiones propios en el período.</td></tr>}
            {grupos.map((g) => { const a = vis.filter((o) => o.rubro === g); return a.length ? [...a.map(fila), grupos.length > 1 ? sub('Subtotal ' + g.toLowerCase(), a) : null] : null; })}
            {vis.length > 0 && sub('Total flota', vis)}
          </tbody>
        </table></div>
      </div>

      {sel && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>{sel.k} · {sel.rubro.toLowerCase()} <Link className="btn" href={qs({ camion: '' })} prefetch={false} style={{ marginLeft: 8 }}>Cerrar</Link></h2>
          <div className="kpis">
            <div className="kpi"><div className="l">Resultado</div><div className="v" style={sel.res < 0 ? { color: 'var(--bad)' } : undefined}>{money(sel.res)}</div><div className="s">{pct(sel.mg)}{sel.viajes ? ` · ${money(sel.res / sel.viajes)} por viaje` : ''}</div></div>
            <div className="kpi"><div className="l">Gasoil</div><div className="v">{num1(sel.litros)} L</div><div className="s">{sel.cargas} cargas{sel.viajes ? ` · ${num1(sel.litros / sel.viajes)} L por viaje` : ''}</div></div>
            <div className="kpi"><div className="l">Viajes en fin de semana o feriado</div><div className="v">{sel.fines}</div><div className="s">se pagan con recargo al chofer</div></div>
            {sel.diasIng > 0 && <div className="kpi"><div className="l">Jornadas en el Ingenio</div><div className="v">{sel.diasIng}</div><div className="s">{horas} h por jornada × valor hora</div></div>}
          </div>
          {barra(sel)}
          <p className="note">{COMP.map(([l, k, c]) => <span key={l} style={{ marginRight: 12 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: 2 }} /> {l}</span>)}<span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--good)', borderRadius: 2 }} /> Resultado</span></p>
          <h3>Qué llevó y cuánto dejó el material</h3>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Material</th><th>Cantera</th><th className="r">Viajes</th><th className="r">m³</th><th className="r">Venta por m³</th><th className="r">Costo por m³</th><th className="r">Ventas</th><th className="r">Costo material</th><th className="r">Margen material</th><th>Costo tomado de</th></tr></thead>
            <tbody>
              {[...sel.porMat.values()].sort((a, b) => b.ventas - a.ventas).map((g, i) => (
                <tr key={i}><td>{g.material}</td><td>{g.cantera}</td><td className="r">{g.viajes}</td><td className="r">{num1(g.m3)}</td><td className="r">{g.m3 ? money(g.ventas / g.m3) : '—'}</td><td className="r">{g.m3 && g.costo ? money(g.costo / g.m3) : '—'}</td>
                  <td className="r">{money(g.ventas)}</td><td className="r">{money(g.costo)}</td><td className="r">{g.src.has('ingenio') ? <span className="muted">—</span> : <Mg v={g.ventas ? (g.ventas - g.costo) / g.ventas : null} />}</td><td className="muted" style={{ fontSize: 12 }}>{[...g.src].join(', ')}</td></tr>
              ))}
              {sel.porMat.size === 0 && <tr><td colSpan={10} className="muted">Sin viajes en el período.</td></tr>}
            </tbody>
          </table></div>
          <h3>Arreglos y repuestos · {money(sel.mec)}</h3>
          {sel.mecL.length ? (
            <div className="tbl-wrap"><table>
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Rubro</th><th>Detalle</th><th>Factura</th><th className="r">Debe</th><th className="r">Neto sin IVA</th></tr></thead>
              <tbody>{[...sel.mecL].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((m, i) => <tr key={i}><td>{fecha(m.fecha)}</td><td>{m.proveedor}</td><td className="muted">{m.subrubro || m.rubro}</td><td>{m.detalle}{m.obs ? ` · ${m.obs}` : ''}</td><td>{m.factura}</td><td className="r">{money(m.debe)}</td><td className="r">{money(m.neto)}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="note">No hay gastos de proveedores con la patente {sel.k} en el período.</p>}
          {sel.mecPror > 0 && <p className="note">Además se le cargan {money(sel.mecPror)} de gastos de taller sin patente, repartidos por viajes.</p>}
          {sel.sinC.length > 0 && <>
            <h3>Viajes sin costo de material · {sel.sinC.length}</h3>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Fecha</th><th>Remito</th><th>Cliente</th><th>Cantera</th><th>Material</th><th className="r">m³</th><th className="r">Venta</th></tr></thead>
              <tbody>{sel.sinC.map((r, i) => <tr key={i}><td>{fecha(r.fecha)}</td><td>{r.remito}</td><td>{r.cliente}</td><td>{r.cantera}</td><td>{r.material}</td><td className="r">{num1(r.m3)}</td><td className="r">{money(r.venta)}</td></tr>)}</tbody>
            </table></div></>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,460px),1fr))', gap: 16, marginBottom: 16 }}>
        <div className="panel">
          <h2>A dónde va cada peso que vende</h2>
          <p className="note">{COMP.map(([l, , c]) => <span key={l} style={{ marginRight: 12 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: 2 }} /> {l}</span>)}<span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--good)', borderRadius: 2 }} /> Resultado</span></p>
          <div style={{ display: 'grid', gap: 10 }}>
            {vis.map((o) => (
              <Link key={o.k} href={qs({ camion: o.k })} prefetch={false} style={{ display: 'grid', gap: 4, color: 'inherit', textDecoration: 'none' }}>
                <span><strong>{o.k}</strong> <Mg v={o.mg} /></span>{barra(o)}
              </Link>
            ))}
            {vis.length === 0 && <p className="muted">Sin datos.</p>}
          </div>
        </div>
        <div className="panel">
          <h2>Minorista, mayorista e Ingenio</h2>
          <p className="note">El gasoil y los arreglos de cada camión se reparten entre sus tipos de viaje según la cantidad de viajes.</p>
          <div className="tbl-wrap"><table>
            <thead><tr><th></th>{tipos.map((n) => <th key={n} className="r">{n}</th>)}</tr></thead>
            <tbody>
              {([
                ['Viajes', (R) => R.viajes, (v) => num1(v)], ['m³ / toneladas', (R) => R.m3, (v) => num1(v)], ['Ventas', (R) => R.ventas, money],
                ['Material', (R) => R.mat, money], ['Chofer', (R) => R.chofer, money], ['Gasoil', (R) => R.gas, money], ['Arreglos', (R) => R.mec, money], ['Resultado', (R) => R.res, money],
                ['Margen', (R) => (R.ventas ? R.res / R.ventas : null), pct],
                ['Venta por m³', (R) => (R.m3 ? R.ventas / R.m3 : null), (v) => (v == null ? '—' : money(v))],
                ['Resultado por m³', (R) => (R.m3 ? R.res / R.m3 : null), (v) => (v == null ? '—' : money(v))],
                ['Resultado por viaje', (R) => (R.viajes ? R.res / R.viajes : null), (v) => (v == null ? '—' : money(v))],
              ] as [string, (R: PorTipo) => number | null, (v: number | null) => string][]).map(([l, f, fm]) => (
                <tr key={l} className={l === 'Resultado' ? 'total' : undefined}><td>{l}</td>
                  {tipos.map((n) => { const v = f(RB[n]!); return <td key={n} className="r" style={l === 'Resultado' && (v ?? 0) < 0 ? { color: 'var(--bad)' } : undefined}>{fm(v)}</td>; })}</tr>
              ))}
              {tipos.length === 0 && <tr><td className="muted">Sin datos.</td></tr>}
            </tbody>
          </table></div>
          {RB.Ingenio && <p className="note">Ingenio: el chofer se calcula por jornada ({horas} h × valor hora) y no lleva costo de material.</p>}
        </div>
      </div>

      <div className="panel">
        <h2>Datos a revisar</h2>
        <ul>
          {faltan.size > 0 && <li><b>Sin costo de material</b> (cargalo en <Link href="/precios">Precios</Link>): {[...faltan].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(' · ')}</li>}
          {estim.size > 0 && <li><b>Costo estimado</b> (no está en la lista de costos): {[...estim].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n} viajes)`).join(' · ')}</li>}
          {X.sinPat > 0 && <li><b>{X.sinPat} viajes sin patente</b>: no se cuentan en ningún camión.</li>}
          {X.fuera.size > 0 && <li><b>Otros camiones</b> (terceros o fuera de la lista de Planeación): {[...X.fuera].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(' · ')}</li>}
          {gasDef > 0 && <li><b>{gasDef} cargas de gasoil sin precio</b> vigente en Combustible: se valuaron a {money(X.precioGas)} por litro.</li>}
          {X.sinAsig.length > 0 && <li><b>Gastos de taller sin patente</b> en Proveedores: {money(X.totSA)} en {X.sinAsig.length} movimientos{repartir ? ' (repartidos entre los camiones según sus viajes)' : ' (no se cargan a ningún camión; tildá “Repartir” o escribí la patente en el detalle del gasto)'}.</li>}
          {!faltan.size && !estim.size && !X.sinPat && !X.fuera.size && !gasDef && !X.sinAsig.length && <li className="muted">Nada para revisar.</li>}
        </ul>
        <p className="note">Qué camión es minorista o mayorista surge de Planeación (capacidad mayor a 12 m³ o “solo mayorista”). Los arreglos son gastos de Proveedores que nombran la patente, sin combustible, material ni compra de maquinaria.</p>
      </div>
    </>
  );
}
