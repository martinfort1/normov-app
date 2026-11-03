'use client';
import { useRef, useState } from 'react';

export interface TipoExcel { id: 'viajes' | 'combustible' | 'proveedores' | 'cheques'; titulo: string; hoja: string; rango: boolean }

interface Resumen { filas: number; conId: number; desde: string | null; hasta: string | null; muestra: string[] }

const AYUDA: Record<TipoExcel['id'], string> = {
  viajes: 'Hoja PRINCIPAL de la Planilla NORMOV. Si el archivo viene de una exportación de la app (columna ID VIAJE), las filas se actualizan en lugar de duplicarse, aunque cambies el remito o la fecha.',
  combustible: 'Hoja Cargas de la Planilla Combustible.',
  proveedores: 'Hoja Cta Cte Proveedores de NORMOV Diego.',
  cheques: 'Hoja Cheques de NORMOV Diego.',
};

export function ExcelPanel({ exportables, importables, hoy }: { exportables: TipoExcel[]; importables: TipoExcel[]; hoy: string }) {
  const [rangos, setRangos] = useState<Record<string, { desde: string; hasta: string }>>(
    Object.fromEntries(exportables.map((t) => [t.id, { desde: t.id === 'viajes' ? `${hoy.slice(0, 4)}-01-01` : '', hasta: t.id === 'viajes' ? hoy : '' }])),
  );
  const [tipo, setTipo] = useState<TipoExcel['id']>(importables[0]?.id ?? 'viajes');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const href = (t: TipoExcel) => {
    const r = rangos[t.id];
    const p = new URLSearchParams({ tipo: t.id });
    if (r?.desde) p.set('desde', r.desde);
    if (r?.hasta) p.set('hasta', r.hasta);
    return `/api/exportar?${p.toString()}`;
  };

  async function enviar(modo: 'simular' | 'aplicar') {
    if (!archivo) { setMsg({ ok: false, texto: 'Elegí primero el archivo de Excel.' }); return; }
    setOcupado(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set('tipo', tipo); fd.set('modo', modo); fd.set('file', archivo);
      const res = await fetch('/api/importar', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({ error: 'La respuesta del servidor no se pudo leer.' }));
      if (!res.ok || json.error) { setMsg({ ok: false, texto: json.error ?? 'No se pudo importar.' }); if (modo === 'simular') setResumen(null); return; }
      if (modo === 'simular') setResumen(json as Resumen);
      else {
        setMsg({ ok: true, texto: json.mensaje as string });
        setResumen(null); setArchivo(null);
        if (entrada.current) entrada.current.value = '';
      }
    } catch {
      setMsg({ ok: false, texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel">
        <h2 style={{ marginBottom: 6 }}>Exportar a Excel</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          Mismas hojas y columnas que tus planillas, para trabajar en Excel o Google Sheets. La última columna (ID) la usa la importación
          para reconocer cada fila: no la borres si vas a volver a importar el archivo.
        </p>
        {!exportables.length && <p className="muted">Tu usuario no tiene acceso de lectura a ninguna sección exportable.</p>}
        <div style={{ display: 'grid', gap: 10 }}>
          {exportables.map((t) => (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div><strong>{t.titulo}</strong><div className="muted" style={{ fontSize: 12.5 }}>Hoja {t.hoja}</div></div>
              <div className="row">
                {t.rango && (
                  <>
                    <input type="date" aria-label={`Desde (${t.titulo})`} value={rangos[t.id]?.desde ?? ''} onChange={(e) => setRangos({ ...rangos, [t.id]: { ...rangos[t.id], desde: e.target.value } })} />
                    <span className="muted">a</span>
                    <input type="date" aria-label={`Hasta (${t.titulo})`} value={rangos[t.id]?.hasta ?? ''} onChange={(e) => setRangos({ ...rangos, [t.id]: { ...rangos[t.id], hasta: e.target.value } })} />
                  </>
                )}
                <a className="btn" href={href(t)}>Descargar Excel</a>
              </div>
            </div>
          ))}
        </div>
        {exportables.some((t) => t.rango) && <p className="note" style={{ marginTop: 8 }}>Si dejás las fechas vacías se exporta todo (en Viajes, el año en curso).</p>}
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 6 }}>Importar desde Excel</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          Subí un archivo con el mismo formato de tus planillas (una descarga de Google Sheets en .xlsx o una exportación de la app). Primero se revisa
          sin tocar nada; recién después de confirmar se importa. Las filas que ya existen se actualizan, no se duplican.
        </p>
        {!importables.length ? <p className="muted">Tu usuario no puede cargar datos en ninguna sección.</p> : (
          <>
            <div className="row">
              <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoExcel['id']); setResumen(null); setMsg(null); }} aria-label="Qué se importa">
                {importables.map((t) => <option key={t.id} value={t.id}>{t.titulo} (hoja {t.hoja})</option>)}
              </select>
              <input ref={entrada} type="file" accept=".xlsx,.xls,.csv" aria-label="Archivo de Excel"
                onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResumen(null); setMsg(null); }} />
              <button type="button" onClick={() => enviar('simular')} disabled={ocupado || !archivo}>{ocupado && !resumen ? 'Revisando…' : 'Revisar archivo'}</button>
            </div>
            <p className="note" style={{ marginTop: 6 }}>{AYUDA[tipo]}</p>
          </>
        )}
        {resumen && (
          <div className="banner" style={{ marginTop: 12 }}>
            <strong>{resumen.filas.toLocaleString('es-AR')} filas</strong> listas para importar
            {resumen.desde && <> · del {resumen.desde} al {resumen.hasta}</>}
            {resumen.conId > 0 && <> · {resumen.conId.toLocaleString('es-AR')} se reconocen por ID y se actualizan en su lugar</>}.
            {resumen.muestra.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{resumen.muestra.map((m, i) => <li key={i}>{m}</li>)}<li className="muted">…</li></ul>}
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="primary" onClick={() => enviar('aplicar')} disabled={ocupado}>{ocupado ? 'Importando…' : 'Importar ahora'}</button>
              <button type="button" onClick={() => { setResumen(null); setMsg(null); }} disabled={ocupado}>Cancelar</button>
            </div>
          </div>
        )}
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'err'}`} role="status" style={{ marginTop: 12 }}>{msg.texto}</div>}
      </div>
    </div>
  );
}
