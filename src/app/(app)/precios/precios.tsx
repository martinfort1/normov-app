'use client';
import { useMemo, useState, useTransition } from 'react';
import { Modal } from '@/components/modal';
import { money, fecha as fmtFecha } from '@/lib/format';
import { clave } from '@/lib/precios';
import { guardarPrecio, eliminarPrecio, guardarCosto, eliminarCosto } from './actions';

export interface FilaVenta { id: string; razon: string; material: string; tipo: 'minorista' | 'mayorista'; desde: string; viaje6: number | null; m3: number }
export interface FilaCosto { id: string; cantera: string; material: string; desde: string; m3: number }
type Estado = 'vigente' | 'programado' | 'anterior';

/** Acepta "18500", "18500,5" y también "18.500" / "18.500,50" (punto de miles, como en la planilla). */
const aNum = (s: string) => {
  const t = s.trim().replace(/[$\s]/g, '');
  const miles = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t);
  const n = Number(miles ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.'));
  return t && Number.isFinite(n) ? n : NaN;
};
const redondeo = (n: number) => Math.round(n * 100) / 100;

/** Para cada precio de un mismo grupo, dice si es el que rige hoy, si empieza más adelante o si ya quedó viejo. */
function estados<T extends { id: string; desde: string }>(filas: T[], grupo: (f: T) => string, hoy: string): Map<string, Estado> {
  const porGrupo = new Map<string, T[]>();
  for (const f of filas) porGrupo.set(grupo(f), [...(porGrupo.get(grupo(f)) ?? []), f]);
  const out = new Map<string, Estado>();
  for (const fs of porGrupo.values()) {
    const vigente = fs.filter((f) => f.desde <= hoy).sort((a, b) => b.desde.localeCompare(a.desde))[0];
    for (const f of fs) out.set(f.id, f.desde > hoy ? 'programado' : f.id === vigente?.id ? 'vigente' : 'anterior');
  }
  return out;
}
const pillEstado = (e: Estado) => (e === 'vigente' ? <span className="pill good">Vigente</span> : e === 'programado' ? <span className="pill info">Desde esa fecha</span> : <span className="pill">Anterior</span>);

export function Precios({ venta, costo, costoListo, clientes, materiales, canteras, puedeEditar, hoy }: {
  venta: FilaVenta[]; costo: FilaCosto[]; costoListo: boolean; clientes: string[]; materiales: string[]; canteras: string[]; puedeEditar: boolean; hoy: string;
}) {
  const [tab, setTab] = useState<'venta' | 'costo'>('venta');
  return (
    <>
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={tab === 'venta'} aria-pressed={tab === 'venta'} onClick={() => setTab('venta')}>Precios de venta <span className="pill" style={{ marginLeft: 6 }}>{venta.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'costo'} aria-pressed={tab === 'costo'} onClick={() => setTab('costo')}>Costos por cantera <span className="pill" style={{ marginLeft: 6 }}>{costo.length}</span></button>
      </div>
      {tab === 'venta'
        ? <Venta filas={venta} clientes={clientes} materiales={materiales} puedeEditar={puedeEditar} hoy={hoy} />
        : <Costo filas={costo} costoListo={costoListo} canteras={canteras} materiales={materiales} puedeEditar={puedeEditar} hoy={hoy} />}
    </>
  );
}

// ───────────── venta ─────────────
function Venta({ filas, clientes, materiales, puedeEditar, hoy }: { filas: FilaVenta[]; clientes: string[]; materiales: string[]; puedeEditar: boolean; hoy: string }) {
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<'todos' | 'minorista' | 'mayorista'>('todos');
  const [historial, setHistorial] = useState(false);
  const [editando, setEditando] = useState<FilaVenta | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const est = useMemo(() => estados(filas, (f) => `${clave(f.razon)}|${clave(f.material)}|${f.tipo}`, hoy), [filas, hoy]);
  const visibles = useMemo(() => {
    const t = clave(q);
    return filas
      .filter((f) => (tipo === 'todos' || f.tipo === tipo) && (!t || clave(f.razon).includes(t) || clave(f.material).includes(t)) && (historial || est.get(f.id) !== 'anterior'))
      .sort((a, b) => (clave(a.razon) === 'GENERAL' ? 0 : 1) - (clave(b.razon) === 'GENERAL' ? 0 : 1) || a.razon.localeCompare(b.razon) || a.material.localeCompare(b.material) || a.tipo.localeCompare(b.tipo) || b.desde.localeCompare(a.desde));
  }, [filas, q, tipo, historial, est]);

  function borrar(f: FilaVenta) {
    if (!confirm(`¿Eliminar el precio de ${f.razon} · ${f.material} (${f.tipo}) vigente desde ${fmtFecha(f.desde)}?`)) return;
    setError(null);
    start(async () => { const r = await eliminarPrecio(f.id); if (r.error) setError(r.error); });
  }

  return (
    <>
      <div className="filters" style={{ alignItems: 'center' }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o material" aria-label="Buscar" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} aria-label="Tipo">
          <option value="todos">Minorista y mayorista</option><option value="minorista">Solo minorista</option><option value="mayorista">Solo mayorista</option>
        </select>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={historial} onChange={(e) => setHistorial(e.target.checked)} style={{ minHeight: 'auto' }} /> Ver historial</label>
        {puedeEditar && <button type="button" className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setEditando('nuevo')}>Nuevo precio</button>}
      </div>
      {error && <div className="banner err">{error}</div>}
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Cliente</th><th>Material</th><th>Tipo</th><th>Rige desde</th><th className="r">Viaje 6 m³</th><th className="r">Por m³</th><th /><th /></tr></thead>
          <tbody>
            {visibles.map((f) => {
              const e = est.get(f.id) ?? 'vigente';
              return (
                <tr key={f.id} style={e === 'anterior' ? { opacity: 0.55 } : undefined}>
                  <td>{clave(f.razon) === 'GENERAL' ? <><strong>GENERAL</strong> <span className="muted" style={{ fontSize: 12 }}>(todos los demás)</span></> : f.razon}</td>
                  <td>{f.material}</td>
                  <td>{f.tipo === 'mayorista' ? 'Mayorista' : 'Minorista'}</td>
                  <td>{fmtFecha(f.desde)}</td>
                  <td className="r">{f.viaje6 != null ? money(f.viaje6) : '—'}</td>
                  <td className="r"><strong>{money(f.m3)}</strong></td>
                  <td>{pillEstado(e)}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    {puedeEditar && <>
                      <button type="button" className="btn sm" onClick={() => setEditando(f)}>Editar</button>{' '}
                      <button type="button" className="btn sm danger" disabled={pending} onClick={() => borrar(f)}>Eliminar</button>
                    </>}
                  </td>
                </tr>
              );
            })}
            {!visibles.length && <tr><td colSpan={8} className="muted">No hay precios que coincidan.</td></tr>}
          </tbody>
        </table>
      </div>
      {editando && <FormVenta fila={editando === 'nuevo' ? null : editando} clientes={clientes} materiales={materiales} hoy={hoy} onCerrar={() => setEditando(null)} />}
    </>
  );
}

function FormVenta({ fila, clientes, materiales, hoy, onCerrar }: { fila: FilaVenta | null; clientes: string[]; materiales: string[]; hoy: string; onCerrar: () => void }) {
  const [razon, setRazon] = useState(fila?.razon ?? '');
  const [material, setMaterial] = useState(fila?.material ?? '');
  const [tipo, setTipo] = useState<'minorista' | 'mayorista'>(fila?.tipo ?? 'minorista');
  const [desde, setDesde] = useState(fila?.desde ?? hoy);
  const [m3, setM3] = useState(fila ? String(fila.m3) : '');
  const [viaje6, setViaje6] = useState(fila?.viaje6 != null ? String(fila.viaje6) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = aNum(m3);

  function guardar() {
    setError(null);
    start(async () => {
      const r = await guardarPrecio({ id: fila?.id ?? null, razon, material, tipo, desde, m3: n, viaje6: tipo === 'minorista' && viaje6.trim() ? aNum(viaje6) : null });
      if (r.error) setError(r.error); else onCerrar();
    });
  }
  return (
    <Modal titulo={fila ? 'Editar precio de venta' : 'Nuevo precio de venta'} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="fld">Cliente / razón social
          <input list="dl-cli" value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Elegí uno o escribí GENERAL" autoComplete="off" />
          <datalist id="dl-cli"><option value="GENERAL" />{clientes.map((c) => <option key={c} value={c} />)}</datalist>
          <span className="muted" style={{ fontSize: 12 }}>GENERAL es el precio de todos los clientes que no tienen uno propio.</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="fld">Material
            <input list="dl-mat" value={material} onChange={(e) => setMaterial(e.target.value)} autoComplete="off" />
            <datalist id="dl-mat">{materiales.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="fld">Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="minorista">Minorista (hasta 12 m³)</option><option value="mayorista">Mayorista (más de 12 m³)</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: tipo === 'minorista' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
          <label className="fld">Rige desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="fld">Precio por m³<input inputMode="decimal" value={m3} onChange={(e) => setM3(e.target.value)} placeholder="0" /></label>
          {tipo === 'minorista' && (
            <label className="fld">Viaje de 6 m³ (opcional)
              <input inputMode="decimal" value={viaje6} onChange={(e) => setViaje6(e.target.value)} placeholder={n > 0 ? String(redondeo(n * 6)) : ''} />
            </label>
          )}
        </div>
        {!fila && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Si ya había un precio para este cliente y material, este lo reemplaza desde la fecha elegida y el anterior queda en el historial.</p>}
        {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary" disabled={pending} onClick={guardar}>{pending ? 'Guardando…' : 'Guardar precio'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────── costo ─────────────
function Costo({ filas, costoListo, canteras, materiales, puedeEditar, hoy }: { filas: FilaCosto[]; costoListo: boolean; canteras: string[]; materiales: string[]; puedeEditar: boolean; hoy: string }) {
  const [q, setQ] = useState('');
  const [historial, setHistorial] = useState(false);
  const [editando, setEditando] = useState<FilaCosto | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const est = useMemo(() => estados(filas, (f) => `${clave(f.cantera)}|${clave(f.material)}`, hoy), [filas, hoy]);
  const visibles = useMemo(() => {
    const t = clave(q);
    return filas.filter((f) => (!t || clave(f.cantera).includes(t) || clave(f.material).includes(t)) && (historial || est.get(f.id) !== 'anterior'))
      .sort((a, b) => a.cantera.localeCompare(b.cantera) || a.material.localeCompare(b.material) || b.desde.localeCompare(a.desde));
  }, [filas, q, historial, est]);

  function borrar(f: FilaCosto) {
    if (!confirm(`¿Eliminar el costo de ${f.material} en ${f.cantera} vigente desde ${fmtFecha(f.desde)}?`)) return;
    setError(null);
    start(async () => { const r = await eliminarCosto(f.id); if (r.error) setError(r.error); });
  }

  return (
    <>
      <div className="filters" style={{ alignItems: 'center' }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cantera o material" aria-label="Buscar" />
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={historial} onChange={(e) => setHistorial(e.target.checked)} style={{ minHeight: 'auto' }} /> Ver historial</label>
        {puedeEditar && costoListo && <button type="button" className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setEditando('nuevo')}>Nuevo costo</button>}
      </div>
      {error && <div className="banner err">{error}</div>}
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Cantera</th><th>Material</th><th>Rige desde</th><th className="r">Costo por m³</th><th /><th /></tr></thead>
          <tbody>
            {visibles.map((f) => {
              const e = est.get(f.id) ?? 'vigente';
              return (
                <tr key={f.id} style={e === 'anterior' ? { opacity: 0.55 } : undefined}>
                  <td>{f.cantera}</td><td>{f.material}</td><td>{fmtFecha(f.desde)}</td><td className="r"><strong>{money(f.m3)}</strong></td><td>{pillEstado(e)}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    {puedeEditar && <>
                      <button type="button" className="btn sm" onClick={() => setEditando(f)}>Editar</button>{' '}
                      <button type="button" className="btn sm danger" disabled={pending} onClick={() => borrar(f)}>Eliminar</button>
                    </>}
                  </td>
                </tr>
              );
            })}
            {!visibles.length && <tr><td colSpan={6} className="muted">{costoListo ? 'No hay costos que coincidan.' : 'Todavía no está la tabla de costos.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {editando && <FormCosto fila={editando === 'nuevo' ? null : editando} canteras={canteras} materiales={materiales} hoy={hoy} onCerrar={() => setEditando(null)} />}
    </>
  );
}

function FormCosto({ fila, canteras, materiales, hoy, onCerrar }: { fila: FilaCosto | null; canteras: string[]; materiales: string[]; hoy: string; onCerrar: () => void }) {
  const [cantera, setCantera] = useState(fila?.cantera ?? '');
  const [material, setMaterial] = useState(fila?.material ?? '');
  const [desde, setDesde] = useState(fila?.desde ?? hoy);
  const [m3, setM3] = useState(fila ? String(fila.m3) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function guardar() {
    setError(null);
    start(async () => { const r = await guardarCosto({ id: fila?.id ?? null, cantera, material, desde, m3: aNum(m3) }); if (r.error) setError(r.error); else onCerrar(); });
  }
  return (
    <Modal titulo={fila ? 'Editar costo' : 'Nuevo costo por cantera'} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="fld">Cantera
            <input list="dl-cant" value={cantera} onChange={(e) => setCantera(e.target.value)} autoComplete="off" />
            <datalist id="dl-cant">{canteras.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="fld">Material
            <input list="dl-mat2" value={material} onChange={(e) => setMaterial(e.target.value)} autoComplete="off" />
            <datalist id="dl-mat2">{materiales.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="fld">Rige desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="fld">Costo por m³<input inputMode="decimal" value={m3} onChange={(e) => setM3(e.target.value)} placeholder="0" /></label>
        </div>
        {!fila && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Si la cantera ya tenía un costo para ese material, este lo reemplaza desde la fecha elegida y el anterior queda en el historial.</p>}
        {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary" disabled={pending} onClick={guardar}>{pending ? 'Guardando…' : 'Guardar costo'}</button>
        </div>
      </div>
    </Modal>
  );
}
