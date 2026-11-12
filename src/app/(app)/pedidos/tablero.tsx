'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { fecha as fmtFecha, num2 } from '@/lib/format';
import {
  guardarPedido, moverPedido, cerrarPedido, sugerirViajes, viajesDelPedido, vincularViajes, desvincularViaje,
  type Prioridad, type ViajeLista,
} from './actions';

export interface PedidoCard {
  id: string; numero: number; clienteId: string; cliente: string; obraId: string | null; obra: string | null;
  prioridad: Prioridad; fechaEntrega: string | null; estado: 'pendiente' | 'realizado';
  items: { materialId: string; material: string; unidad: string; pedido: number; entregado: number }[];
  viajes: number; pct: number;
}
export interface Catalogos {
  clientes: { id: string; nombre: string }[];
  obras: { id: string; nombre: string; clienteId: string | null }[];
  materiales: { id: string; nombre: string; unidad: string }[];
}

const PRIORIDADES: { key: Prioridad; label: string; clase: string }[] = [
  { key: 'urgente', label: 'Urgente', clase: 'bad' },
  { key: 'alta', label: 'Alta', clase: 'warn' },
  { key: 'normal', label: 'Normal', clase: '' },
  { key: 'baja', label: 'Baja', clase: 'muted' },
];

const faltan = (p: PedidoCard) => p.items.reduce((s, i) => s + Math.max(0, i.pedido - i.entregado), 0);

export function Tablero({ pedidos, cat, hoy, puedeCargar, puedeVincular }: { pedidos: PedidoCard[]; cat: Catalogos; hoy: string; puedeCargar: boolean; puedeVincular: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<PedidoCard | 'nuevo' | null>(null);
  const [vinculando, setVinculando] = useState<PedidoCard | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<'pendiente' | 'realizado' | null>(null);

  const pendientes = pedidos.filter((p) => p.estado === 'pendiente');
  const realizados = pedidos.filter((p) => p.estado === 'realizado');

  function correr(fn: () => Promise<{ error: string | null }>) {
    setMsg(null);
    start(async () => { const r = await fn(); if (r.error) setMsg(r.error); });
  }
  function completar(p: PedidoCard) {
    const f = faltan(p);
    if (f > 0 && !confirm(`Al pedido #${p.numero} le faltan ${num2(f)} por entregar. ¿Completarlo igual? Se archiva y deja de verse acá.`)) return;
    correr(() => cerrarPedido(p.id, 'completado'));
  }
  function cancelar(p: PedidoCard) {
    if (!confirm(`¿Cancelar el pedido #${p.numero} de ${p.cliente}? Se archiva y deja de verse acá.`)) return;
    correr(() => cerrarPedido(p.id, 'cancelado'));
  }
  function soltar(estado: 'pendiente' | 'realizado') {
    const id = arrastrando;
    setArrastrando(null); setSobre(null);
    const p = pedidos.find((x) => x.id === id);
    if (!p || p.estado === estado || !puedeCargar) return;
    correr(() => moverPedido(p.id, estado));
  }

  const tarjeta = (p: PedidoCard) => (
    <Tarjeta key={p.id} p={p} hoy={hoy} puedeCargar={puedeCargar} puedeVincular={puedeVincular} pending={pending}
      onDragStart={() => setArrastrando(p.id)} onDragEnd={() => { setArrastrando(null); setSobre(null); }}
      onEditar={() => setEditando(p)} onVincular={() => setVinculando(p)} onCompletar={() => completar(p)} onCancelar={() => cancelar(p)}
      onMover={(e) => correr(() => moverPedido(p.id, e))} />
  );
  const columna = (estado: 'pendiente' | 'realizado', titulo: string, lista: PedidoCard[], vacio: string) => (
    <section className={`kcol${sobre === estado && arrastrando ? ' over' : ''}`} aria-label={titulo}
      onDragOver={(e) => { if (arrastrando && puedeCargar) { e.preventDefault(); setSobre(estado); } }}
      onDragLeave={() => setSobre((s) => (s === estado ? null : s))} onDrop={(e) => { e.preventDefault(); soltar(estado); }}>
      <header className="kcol-h"><h2>{titulo}</h2><span className="pill">{lista.length}</span></header>
      {lista.map(tarjeta)}
      {!lista.length && <p className="muted" style={{ margin: 8 }}>{vacio}</p>}
    </section>
  );

  const totalFalta = pendientes.reduce((s, p) => s + faltan(p), 0);
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        {puedeCargar && <button className="btn primary" type="button" onClick={() => setEditando('nuevo')}>Nuevo pedido</button>}
        <span className="note" style={{ margin: 0 }}>{pendientes.length} pendientes · faltan entregar {num2(totalFalta)} en total</span>
        {!puedeCargar && <span className="note" style={{ margin: 0 }}>Solo lectura: no tenés permiso para cargar pedidos.</span>}
      </div>
      {msg && <div className="banner err">{msg}</div>}
      <div className="kanban" aria-busy={pending}>
        {columna('pendiente', 'Pendientes', pendientes, 'No hay pedidos pendientes.')}
        {columna('realizado', 'Realizado', realizados, 'Arrastrá acá los pedidos que ya se entregaron.')}
      </div>

      {editando && <Formulario pedido={editando === 'nuevo' ? null : editando} cat={cat} onCerrar={() => setEditando(null)} />}
      {vinculando && <Vincular pedido={vinculando} puedeVincular={puedeVincular} onCerrar={() => setVinculando(null)} />}
    </>
  );
}

// ───────────── tarjeta ─────────────
function Tarjeta({ p, hoy, puedeCargar, puedeVincular, pending, onDragStart, onDragEnd, onEditar, onVincular, onCompletar, onCancelar, onMover }: {
  p: PedidoCard; hoy: string; puedeCargar: boolean; puedeVincular: boolean; pending: boolean;
  onDragStart: () => void; onDragEnd: () => void; onEditar: () => void; onVincular: () => void; onCompletar: () => void; onCancelar: () => void;
  onMover: (e: 'pendiente' | 'realizado') => void;
}) {
  const pr = PRIORIDADES.find((x) => x.key === p.prioridad)!;
  const vencido = !!p.fechaEntrega && p.fechaEntrega < hoy && p.estado === 'pendiente';
  return (
    <article className="kcard" draggable={puedeCargar} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); onDragStart(); }} onDragEnd={onDragEnd}>
      <div className="kcard-top">
        <span className="muted">#{p.numero}</span>
        <span className={`pill ${pr.clase}`}>{pr.label}</span>
        <span className={`pill${vencido ? ' bad' : ''}`} style={{ marginLeft: 'auto' }}>{p.fechaEntrega ? `${vencido ? 'Vencido · ' : 'Entrega '}${fmtFecha(p.fechaEntrega)}` : 'Sin fecha'}</span>
      </div>
      <div className="kcard-cli">{p.cliente}</div>
      {p.obra && <div className="muted" style={{ fontSize: 13 }}>{p.obra}</div>}
      <table className="kitems">
        <thead><tr><th>Material</th><th className="r">Pedido</th><th className="r">Entregado</th><th className="r">Falta</th></tr></thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.materialId}>
              <td>{i.material}</td><td className="r">{num2(i.pedido)}</td><td className="r">{num2(i.entregado)}</td>
              <td className="r" style={{ fontWeight: 600, color: i.entregado >= i.pedido ? 'var(--good)' : undefined }}>{i.entregado >= i.pedido ? '✓' : num2(i.pedido - i.entregado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="kprog" title={`${p.pct}% completado`}>
        <div className="bar" style={{ flex: 1 }}><span style={{ width: `${Math.min(100, p.pct)}%`, background: p.pct >= 100 ? 'var(--good)' : undefined }} /></div>
        <b>{p.pct}%</b>
      </div>
      <div className="kacts">
        {puedeVincular && <button type="button" className="btn sm" onClick={onVincular} disabled={pending}>Viajes ({p.viajes})</button>}
        {!puedeVincular && p.viajes > 0 && <span className="muted" style={{ fontSize: 12 }}>{p.viajes} viajes vinculados</span>}
        {puedeCargar && (
          <>
            <button type="button" className="btn sm" onClick={onEditar} disabled={pending}>Editar</button>
            {p.estado === 'pendiente'
              ? <button type="button" className="btn sm" onClick={() => onMover('realizado')} disabled={pending}>Pasar a Realizado</button>
              : (
                <>
                  <button type="button" className="btn sm primary" onClick={onCompletar} disabled={pending}>Completar</button>
                  <button type="button" className="btn sm" onClick={() => onMover('pendiente')} disabled={pending}>Falta entregar</button>
                </>
              )}
            <button type="button" className="btn sm danger" onClick={onCancelar} disabled={pending}>Cancelar</button>
          </>
        )}
      </div>
    </article>
  );
}

// ───────────── ventana ─────────────
function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="modal-h"><h2>{titulo}</h2><button type="button" className="btn sm ghost" onClick={onCerrar} aria-label="Cerrar">✕</button></header>
        {children}
      </div>
    </div>
  );
}

// ───────────── crear / editar ─────────────
function Formulario({ pedido, cat, onCerrar }: { pedido: PedidoCard | null; cat: Catalogos; onCerrar: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clienteId, setClienteId] = useState(pedido?.clienteId ?? '');
  const [obraId, setObraId] = useState(pedido?.obraId ?? '');
  const [prioridad, setPrioridad] = useState<Prioridad>(pedido?.prioridad ?? 'normal');
  const [fechaEntrega, setFechaEntrega] = useState(pedido?.fechaEntrega ?? '');
  const [items, setItems] = useState<{ materialId: string; cantidad: string }[]>(
    pedido?.items.map((i) => ({ materialId: i.materialId, cantidad: String(i.pedido) })) ?? [{ materialId: '', cantidad: '' }],
  );
  const obras = cat.obras.filter((o) => o.clienteId === clienteId);
  const unidad = (id: string) => cat.materiales.find((m) => m.id === id)?.unidad ?? '';

  function guardar() {
    setError(null);
    const lista = items.filter((i) => i.materialId || i.cantidad).map((i) => ({ materialId: i.materialId, cantidad: parseFloat(i.cantidad.replace(',', '.')) }));
    start(async () => {
      const r = await guardarPedido({ id: pedido?.id ?? null, clienteId, obraId: obraId || null, prioridad, fechaEntrega: fechaEntrega || null, items: lista });
      if (r.error) setError(r.error); else onCerrar();
    });
  }

  return (
    <Modal titulo={pedido ? `Editar pedido #${pedido.numero}` : 'Nuevo pedido'} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="fld">Cliente
          <select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setObraId(''); }}>
            <option value="">Elegí un cliente…</option>
            {cat.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="fld">Obra (opcional)
          <select value={obraId} onChange={(e) => setObraId(e.target.value)} disabled={!clienteId}>
            <option value="">Sin obra específica</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="fld">Prioridad
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)}>
              {PRIORIDADES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <label className="fld">Fecha de entrega
            <input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
          </label>
        </div>
        <div className="fld">Materiales y cantidades
          {items.map((it, n) => (
            <div key={n} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <select value={it.materialId} onChange={(e) => setItems(items.map((x, k) => (k === n ? { ...x, materialId: e.target.value } : x)))} style={{ flex: 1 }} aria-label="Material">
                <option value="">Material…</option>
                {cat.materiales.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              <input type="text" inputMode="decimal" placeholder={unidad(it.materialId) || 'Cantidad'} value={it.cantidad} style={{ width: 110 }} aria-label="Cantidad"
                onChange={(e) => setItems(items.map((x, k) => (k === n ? { ...x, cantidad: e.target.value } : x)))} />
              <button type="button" className="btn sm" onClick={() => setItems(items.length > 1 ? items.filter((_, k) => k !== n) : [{ materialId: '', cantidad: '' }])} aria-label="Quitar material">✕</button>
            </div>
          ))}
          <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setItems([...items, { materialId: '', cantidad: '' }])}>+ Agregar material</button>
        </div>
        {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary" onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Guardar pedido'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────── vincular viajes ─────────────
function Vincular({ pedido, puedeVincular, onCerrar }: { pedido: PedidoCard; puedeVincular: boolean; onCerrar: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [vinculados, setVinculados] = useState<ViajeLista[] | null>(null);
  const [sugeridos, setSugeridos] = useState<ViajeLista[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  async function cargar() {
    const [v, s] = await Promise.all([viajesDelPedido(pedido.id), sugerirViajes(pedido.id)]);
    setVinculados(v.rows); setSugeridos(s.rows);
    setError(v.error ?? s.error);
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const etiqueta = (v: ViajeLista) => `${fmtFecha(v.fecha)} · remito ${v.numero}${v.idViaje ? ` · ${v.idViaje}` : ''}`;
  const marcar = (id: string) => setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function vincular() {
    setError(null);
    start(async () => {
      const r = await vincularViajes(pedido.id, [...marcados]);
      if (r.error) { setError(r.error); return; }
      setMarcados(new Set());
      await cargar();
    });
  }
  function quitar(id: string) {
    setError(null);
    start(async () => {
      const r = await desvincularViaje(pedido.id, id);
      if (r.error) { setError(r.error); return; }
      await cargar();
    });
  }
  const suma = (xs: ViajeLista[]) => xs.reduce((s, v) => s + v.cantidad, 0);

  return (
    <Modal titulo={`Viajes del pedido #${pedido.numero} · ${pedido.cliente}`} onCerrar={onCerrar}>
      {error && <div className="banner err" style={{ margin: '0 0 10px' }}>{error}</div>}
      <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Ya vinculados {vinculados ? `(${vinculados.length} · ${num2(suma(vinculados))})` : ''}</h3>
      {vinculados === null ? <p className="muted">Cargando…</p> : !vinculados.length ? <p className="muted">Todavía no hay viajes vinculados.</p> : (
        <ul className="vlist">
          {vinculados.map((v) => (
            <li key={v.id}><span>{etiqueta(v)} · {v.material} · {num2(v.cantidad)}{v.camion ? ` · ${v.camion}` : ''}</span>
              <button type="button" className="btn sm" onClick={() => quitar(v.id)} disabled={pending}>Quitar</button></li>
          ))}
        </ul>
      )}
      <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Viajes que podrían ser de este pedido</h3>
      <p className="note">Mismo cliente{pedido.obra ? ' y obra' : ''}, de un material del pedido, de los últimos 60 días y sin pedido asignado.</p>
      {sugeridos === null ? <p className="muted">Buscando…</p> : !sugeridos.length ? <p className="muted">No hay viajes para sugerir.</p> : (
        <ul className="vlist">
          {sugeridos.map((v) => (
            <li key={v.id}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', flex: 1 }}>
                <input type="checkbox" checked={marcados.has(v.id)} onChange={() => marcar(v.id)} />
                <span>{etiqueta(v)} · {v.material} · {num2(v.cantidad)}{v.obra ? ` · ${v.obra}` : ''}{v.camion ? ` · ${v.camion}` : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <Link className="btn" href="/cargar?tipo=viaje">Cargar un viaje nuevo</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
          {puedeVincular && <button type="button" className="btn primary" onClick={vincular} disabled={pending || !marcados.size}>Vincular {marcados.size ? `(${marcados.size})` : ''}</button>}
        </div>
      </div>
    </Modal>
  );
}
