import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { periodoDe } from '@/lib/periodo';
import { fecha, money, num1 } from '@/lib/format';
import { setPrecio } from './actions';

export const dynamic = 'force-dynamic';

interface Carga { fecha: string | null; patente: string; es_camion: boolean; litros: number; tipo: string; estacion: string; chofer: string }

export default async function Combustible({ searchParams }: { searchParams: Promise<{ mes?: string; anio?: string }> }) {
  const per = periodoDe(await searchParams);
  const supabase = await createClient();

  const [cargasRes, precioRes] = await Promise.all([
    fetchAll<Carga>((from, to) =>
      supabase.from('cargas_combustible').select('fecha,patente,es_camion,litros,tipo,estacion,chofer')
        .gte('fecha', per.desde).lte('fecha', per.hasta).order('fecha', { ascending: false }).range(from, to),
    ).then((rows) => ({ rows, error: null as string | null })).catch((e) => ({ rows: [] as Carga[], error: e.message as string })),
    supabase.from('precios_combustible').select('precio').order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const rows = cargasRes.rows;
  const precio = precioRes.data?.precio ?? 0;

  const porPatente = new Map<string, { es_camion: boolean; litros: number; cargas: number }>();
  for (const r of rows) {
    const o = porPatente.get(r.patente) ?? { es_camion: r.es_camion, litros: 0, cargas: 0 };
    o.litros += r.litros; o.cargas++;
    porPatente.set(r.patente, o);
  }
  const camiones = [...porPatente.entries()].filter(([, o]) => o.es_camion).sort((a, b) => b[1].litros - a[1].litros);
  const maquinas = [...porPatente.entries()].filter(([, o]) => !o.es_camion).sort((a, b) => b[1].litros - a[1].litros);
  const litrosCamiones = camiones.reduce((a, [, o]) => a + o.litros, 0);
  const litrosMaquinas = maquinas.reduce((a, [, o]) => a + o.litros, 0);
  const totalLitros = litrosCamiones + litrosMaquinas;

  async function guardarPrecio(formData: FormData) {
    'use server';
    await setPrecio(formData);
  }

  return (
    <>
      <h1>Combustible</h1>
      <p className="lede">Cargas de {per.etiqueta}, separadas en camiones (patente) y máquinas o equipos.</p>

      <form className="filters" method="get">
        <input type="month" name="mes" defaultValue={per.mes} aria-label="Mes" />
        <button type="submit">Ver mes</button>
      </form>

      <form className="filters" action={guardarPrecio}>
        <label htmlFor="precio" className="muted" style={{ fontSize: 13 }}>Precio por litro ($)</label>
        <input type="number" id="precio" name="precio" min="0" step="0.01" defaultValue={precio || ''} placeholder="Ej.: precio del surtidor" style={{ maxWidth: 160 }} />
        <button type="submit">Guardar</button>
      </form>

      {cargasRes.error && <div className="banner err">{cargasRes.error}</div>}

      <div className="kpis">
        <div className="kpi accent"><div className="l">Litros totales</div><div className="v">{num1(totalLitros)}</div></div>
        <div className="kpi"><div className="l">Camiones</div><div className="v">{num1(litrosCamiones)}</div></div>
        <div className="kpi"><div className="l">Máquinas / equipos</div><div className="v">{num1(litrosMaquinas)}</div></div>
        <div className="kpi"><div className="l">Costo estimado</div><div className="v">{precio ? money(totalLitros * precio) : '—'}</div>
          {!precio && <div className="muted" style={{ fontSize: 12 }}>Cargá el precio por litro arriba</div>}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%,460px),1fr))', gap: 16 }}>
        {[['Camiones', camiones], ['Máquinas y equipos', maquinas]].map(([titulo, lista]) => (
          <div className="panel" key={titulo as string}>
            <h2 style={{ marginTop: 0 }}>{titulo as string}</h2>
            <table>
              <thead><tr><th>Patente</th><th className="r">Cargas</th><th className="r">Litros</th>{precio ? <th className="r">Costo</th> : null}</tr></thead>
              <tbody>
                {(lista as [string, { litros: number; cargas: number }][]).map(([pat, o]) => (
                  <tr key={pat}>
                    <td>{pat}</td><td className="r">{o.cargas}</td><td className="r">{num1(o.litros)}</td>
                    {precio ? <td className="r">{money(o.litros * precio)}</td> : null}
                  </tr>
                ))}
                {!lista.length && <tr><td colSpan={precio ? 4 : 3} className="muted">Sin cargas en el período.</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Cargas del período</h2>
        <table>
          <thead><tr><th>Fecha</th><th>Patente</th><th>Tipo</th><th>Estación</th><th>Chofer</th><th className="r">Litros</th></tr></thead>
          <tbody>
            {rows.slice(0, 500).map((r, i) => (
              <tr key={i}><td>{fecha(r.fecha)}</td><td>{r.patente}</td><td>{r.tipo}</td><td>{r.estacion}</td><td>{r.chofer}</td><td className="r">{num1(r.litros)}</td></tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 && <p className="muted">Se muestran las primeras 500 de {rows.length}.</p>}
      </div>
    </>
  );
}
