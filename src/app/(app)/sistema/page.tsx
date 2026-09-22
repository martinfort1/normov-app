import { createClient } from '@/lib/supabase/server';
import { haceTiempo } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface LogRow { id: number; archivo: string; ok: boolean; resumen: string | null; error: string | null; creado: string }

const NOMBRE: Record<string, string> = { planilla: 'Planilla NORMOV 2026', diego: 'NORMOV Diego 2026', comb: 'Planilla Combustible' };
const ARCHIVOS = ['planilla', 'diego', 'comb'];
const ATRASO_MIN = 90; // el disparador corre cada 15-30 min: si pasó más que esto, algo dejó de andar

export default async function Sistema() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('sync_log').select('*').order('creado', { ascending: false }).limit(200);
  const rows = (data ?? []) as LogRow[];

  const ultimos = ARCHIVOS.map((a) => ({ archivo: a, ultimo: rows.find((r) => r.archivo === a) ?? null }));

  return (
    <>
      <h1>Sistema</h1>
      <p className="lede">Estado del sync automático desde Google Sheets. Si una planilla dejó de sincronizar, se nota acá primero.</p>

      {error && <div className="banner err">No se pudo leer el registro de sync: {error.message}. ¿Corriste la migración 0004_sync_log.sql?</div>}

      <div className="kpis">
        {ultimos.map(({ archivo, ultimo }) => {
          const minutos = ultimo ? (Date.now() - new Date(ultimo.creado).getTime()) / 60000 : Infinity;
          const estado = !ultimo ? 'bad' : !ultimo.ok ? 'bad' : minutos > ATRASO_MIN ? 'warn' : 'good';
          const texto = !ultimo ? 'Nunca sincronizó' : !ultimo.ok ? 'Último intento falló' : minutos > ATRASO_MIN ? 'Atrasado' : 'Al día';
          return (
            <div className="kpi" key={archivo}>
              <div className="l">{NOMBRE[archivo]}</div>
              <div className="v" style={{ fontSize: 18 }}><span className={`pill ${estado}`}>{texto}</span></div>
              <div className="s">{ultimo ? haceTiempo(ultimo.creado) : ''}</div>
              {ultimo && (ultimo.error || ultimo.resumen) && (
                <div className="s" style={{ marginTop: 4 }}>{ultimo.error ?? ultimo.resumen}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 12 }}>Historial reciente</h2>
        <table>
          <thead><tr><th>Cuándo</th><th>Planilla</th><th>Resultado</th><th>Detalle</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{haceTiempo(r.creado)}</td>
                <td>{NOMBRE[r.archivo] ?? r.archivo}</td>
                <td><span className={`pill ${r.ok ? 'good' : 'bad'}`}>{r.ok ? 'OK' : 'Error'}</span></td>
                <td className="muted" style={{ maxWidth: 480, whiteSpace: 'normal' }}>{r.error ?? r.resumen}</td>
              </tr>
            ))}
            {!rows.length && !error && <tr><td colSpan={4} className="muted">Todavía no hay corridas registradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
