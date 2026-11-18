'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { fecha as fmtFecha, num2 } from '@/lib/format';
import { colorMaterial } from '@/lib/colores';
import { Modal } from '@/components/modal';
import { SegmentoTabs, useVista, type Vista } from '@/components/segmento-tabs';
import {
  guardarPedido, moverPedido, cerrarPedido, registrarEntregado, sugerirViajes, viajesDelPedido, vincularViajes, desvincularViaje,
  type Prioridad, type ViajeLista, type Columna,
} from './actions';

export interface PedidoCard {
  id: string; numero: number; clienteId: string; cliente: string; obraId: string | null; obra: string | null;
  prioridad: Prioridad; fechaEntrega: string | null; estado: Columna;
  /** entregado = lo mayor entre lo anotado a mano y lo que suman los viajes vinculados (conRemito) */
  items: { itemId: string; materialId: string; material: string; unidad: string; pedido: number; entregado: number; conRemito: number }[];
  viajes: number; pct: number;
  segmento: 'minorista' | 'mayorista';
  /** Próximo día con viajes planificados todavía sin hacer (Planeación), o null si no hay */
  plan: { fecha: string; m3: number; viajes: number; camiones: string[] } | null;
}
export interface Catalogos {
  clientes: { id: string; nombre: string }[];
  obras: { id: string; nombre: string; clienteId: string | null }[];
  materiales: { id: string; nombre: string; unidad: string }[];
}

const PRIORIDADES: { key: Prioridad; label: string; clase: string }[] = [
  { key: 'urgente', label: 'Urgente', clase: 'bad' },
  { key: 'alta', label: 'Alta', clase: 'warn' },
  { key: 'normal', label: 'Normal', clase: 'info' },
  { key: 'baja', label: 'Baja', clase: '' },
];

/** Cuánto falta para la fecha de entrega, con color: rojo vencido o de hoy, naranja 1-3 días, dorado hasta una semana, verde más lejos. */
function plazo(fecha: string | null, hoy: string, vigente: boolean): { texto: string; clase: string } {
  if (!fecha) return { texto: 'Sin fecha', clase: '' };
  const f = fmtFecha(fecha);
  if (!vigente) return { texto: `Entrega ${f}`, clase: '' };
  const d = Math.round((Date.parse(fecha) - Date.parse(hoy)) / 86_400_000);
  if (d < 0) return { texto: `Vencido hace ${-d} ${-d === 1 ? 'día' : 'días'} · ${f}`, clase: 'bad' };
  if (d === 0) return { texto: `Entrega hoy · ${f}`, clase: 'bad' };
  if (d === 1) return { texto: `Entrega mañana · ${f}`, clase: 'warn' };
  if (d <= 3) return { texto: `En ${d} días · ${f}`, clase: 'warn' };
  if (d <= 7) return { texto: `En ${d} días · ${f}`, clase: 'bronze' };
  return { texto: `En ${d} días · ${f}`, clase: 'good' };
}

/** Link a "Cargar viaje" con razón social, obra y material del pedido ya completados. */
const hrefViaje = (p: PedidoCard, material?: string) =>
  `/cargar?tipo=viaje&razon=${encodeURIComponent(p.cliente)}&cliente=${encodeURIComponent(p.obra ?? '')}&material=${encodeURIComponent(material ?? '')}`;
/** El material al que más le falta entregar (el que probablemente se carga ahora). */
const materialPendiente = (p: PedidoCard) => [...p.items].sort((a, b) => (b.pedido - b.entregado) - (a.pedido - a.entregado))[0]?.material;

const faltan = (p: PedidoCard) => p.items.reduce((s, i) => s + Math.max(0, i.pedido - i.entregado), 0);

const unidadTxt = (u: string) => (u === 'm3' ? 'm³' : u);

export function Tablero({ pedidos: todos, cat, hoy, planListo, puedeCargar, puedeVincular, puedeCargarViaje, entregadoListo }: { pedidos: PedidoCard[]; cat: Catalogos; hoy: string; planListo: boolean; puedeCargar: boolean; puedeVincular: boolean; puedeCargarViaje: boolean; entregadoListo: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<PedidoCard | 'nuevo' | null>(null);
  const [vinculando, setVinculando] = useState<PedidoCard | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Columna | null>(null);

  // Vista: Todos / Minorista / Mayorista (se recuerda en este navegador)
  const [vista, elegirVista] = useVista('normov.pedidos.vista');
  const pedidos = todos.filter((p) => vista === 'todos' || p.segmento === vista);
  const contar = (v: Vista) => {
    const n = todos.filter((p) => (v === 'todos' || p.segmento === v) && p.estado !== 'remitado').length;
    return `${n} ${n === 1 ? 'abierto' : 'abiertos'}`;
  };

  const pendientes = pedidos.filter((p) => p.estado === 'pendiente');
  const realizados = pedidos.filter((p) => p.estado === 'realizado');
  const remitados = pedidos.filter((p) => p.estado === 'remitado');

  /** Pedido que se está moviendo / cerrando: su tarjeta se atenúa y muestra una rueda hasta que el servidor responde. */
  const [moviendo, setMoviendo] = useState<string | null>(null);
  function correr(id: string, fn: () => Promise<{ error: string | null }>) {
    setMsg(null);
    setMoviendo(id);
    start(async () => {
      try { const r = await fn(); if (r.error) setMsg(r.error); }
      finally { setMoviendo(null); }
    });
  }
  function completar(p: PedidoCard) {
    const f = faltan(p);
    if (f > 0 && !confirm(`Al pedido #${p.numero} le faltan ${num2(f)} por entregar. ¿Completarlo igual? Se archiva y deja de verse acá.`)) return;
    correr(p.id, () => cerrarPedido(p.id, 'completado'));
  }
  function cancelar(p: PedidoCard) {
    if (!confirm(`¿Cancelar el pedido #${p.numero} de ${p.cliente}? Se archiva y deja de verse acá.`)) return;
    correr(p.id, () => cerrarPedido(p.id, 'cancelado'));
  }
  function soltar(estado: Columna) {
    const id = arrastrando;
    setArrastrando(null); setSobre(null);
    const p = pedidos.find((x) => x.id === id);
    if (!p || p.estado === estado || !puedeCargar) return;
    correr(p.id, () => moverPedido(p.id, estado));
  }

  const tarjeta = (p: PedidoCard) => (
    <Tarjeta key={p.id} p={p} hoy={hoy} planListo={planListo} puedeCargar={puedeCargar} puedeVincular={puedeVincular} puedeCargarViaje={puedeCargarViaje} entregadoListo={entregadoListo} alError={setMsg} pending={pending} ocupado={moviendo === p.id}
      onDragStart={() => setArrastrando(p.id)} onDragEnd={() => { setArrastrando(null); setSobre(null); }}
      onEditar={() => setEditando(p)} onVincular={() => setVinculando(p)} onCompletar={() => completar(p)} onCancelar={() => cancelar(p)}
      onMover={(e) => correr(p.id, () => moverPedido(p.id, e))} />
  );
  const columna = (estado: Columna, titulo: string, lista: PedidoCard[], vacio: string) => (
    <section className={`kcol${sobre === estado && arrastrando ? ' over' : ''}`} aria-label={titulo}
      onDragOver={(e) => { if (arrastrando && puedeCargar) { e.preventDefault(); setSobre(estado); } }}
      onDragLeave={() => setSobre((s) => (s === estado ? null : s))} onDrop={(e) => { e.preventDefault(); soltar(estado); }}>
      <header className="kcol-h"><h2>{titulo}</h2><span className="pill">{lista.length}</span></header>
      {lista.map(tarjeta)}
      {!lista.length && <p className="muted" style={{ margin: 8 }}>{vacio}</p>}
    </section>
  );

  // Lo que falta entregar en total (pendientes y entregados en parte), por unidad: m³, t, h
  const porUnidad = new Map<string, number>();
  for (const p of [...pendientes, ...realizados]) {
    for (const i of p.items) porUnidad.set(i.unidad, (porUnidad.get(i.unidad) ?? 0) + Math.max(0, i.pedido - i.entregado));
  }
  const totalFalta = [...porUnidad].filter(([, v]) => v > 0.001).map(([u, v]) => `${num2(v)} ${unidadTxt(u)}`).join(' + ') || `0 m³`;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        {puedeCargar && <button className="btn primary" type="button" onClick={() => setEditando('nuevo')}>Nuevo pedido</button>}
        <span className="note" style={{ margin: 0 }}>
          {pendientes.length} {pendientes.length === 1 ? 'pedido pendiente' : 'pedidos pendientes'}
          {realizados.length > 0 && <> · {realizados.length} {realizados.length === 1 ? 'pedido realizado en parte' : 'pedidos realizados en parte'}</>}
          {' '}· faltan entregar {totalFalta} en total
        </span>
        {!puedeCargar && <span className="note" style={{ margin: 0 }}>Solo lectura: no tenés permiso para cargar pedidos.</span>}
      </div>
      <SegmentoTabs valor={vista} onChange={elegirVista} contar={contar} />
      {!entregadoListo && <div className="banner">Para anotar los metros entregados y usar la columna final falta correr <b>0011_pedidos_entregado.sql</b> en Supabase.</div>}
      {msg && <div className="banner err">{msg}</div>}
      <div className="kanban" aria-busy={pending}>
        {columna('pendiente', 'Pendientes', pendientes, 'No hay pedidos pendientes.')}
        {columna('realizado', 'Realizado en parte', realizados, 'Arrastrá acá lo que se entregó solo en parte. Anotá los metros entregados y cargá los remitos cuando lleguen.')}
        {columna('remitado', 'Realizado', remitados, 'Pedidos con todo entregado, listos para completar.')}
      </div>

      {editando && <Formulario pedido={editando === 'nuevo' ? null : editando} cat={cat} segmentoInicial={vista === 'todos' ? undefined : vista} onCerrar={() => setEditando(null)} />}
      {vinculando && <Vincular pedido={vinculando} puedeVincular={puedeVincular} puedeCargarViaje={puedeCargarViaje} onCerrar={() => setVinculando(null)} />}
    </>
  );
}

// ───────────── tarjeta ─────────────
function Tarjeta({ p, hoy, planListo, puedeCargar, puedeVincular, puedeCargarViaje, entregadoListo, alError, pending, ocupado, onDragStart, onDragEnd, onEditar, onVincular, onCompletar, onCancelar, onMover }: {
  p: PedidoCard; hoy: string; planListo: boolean; puedeCargar: boolean; puedeVincular: boolean; puedeCargarViaje: boolean; entregadoListo: boolean; alError: (mensaje: string) => void; pending: boolean; ocupado: boolean;
  onDragStart: () => void; onDragEnd: () => void; onEditar: () => void; onVincular: () => void; onCompletar: () => void; onCancelar: () => void;
  onMover: (e: Columna) => void;
}) {
  const pr = PRIORIDADES.find((x) => x.key === p.prioridad)!;
  const pl = plazo(p.fechaEntrega, hoy, p.estado !== 'remitado');
  // Lo que se escribe en "Entregado" se refleja al instante en Falta, remitos y barra, aunque el guardado tarde.
  // El valor de la base (y de los viajes vinculados) manda cuando el servidor responde.
  const [borrador, setBorrador] = useState<Record<string, number>>({});
  useEffect(() => { setBorrador({}); }, [p.items]);
  const entregadoDe = (i: PedidoCard['items'][number]) => Math.max(borrador[i.itemId] ?? i.entregado, i.conRemito);
  // Metros entregados que todavía no tienen viajes (remitos) cargados
  const sinRemito = p.estado === 'pendiente' ? 0 : p.items.reduce((s, i) => s + Math.max(0, entregadoDe(i) - i.conRemito), 0);
  const total = p.items.reduce((s, i) => s + i.pedido, 0);
  const pct = total > 0 ? Math.round((p.items.reduce((s, i) => s + Math.min(entregadoDe(i), i.pedido), 0) / total) * 100) : 0;
  return (
    <article className={`kcard prio-${p.prioridad}${ocupado ? ' moving' : ''}`} aria-busy={ocupado} draggable={puedeCargar && !ocupado} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); onDragStart(); }} onDragEnd={onDragEnd}>
      {ocupado && <span className="kspin" role="status" aria-label="Actualizando pedido" />}
      <div className="kcard-top">
        <span className="muted">#{p.numero}</span>
        <span className={`pill ${pr.clase}`}>{pr.label}</span>
        {p.segmento === 'mayorista' && <span className="pill bronze" title="Pedido mayorista: viajes de más de 12 m³">Mayorista</span>}
        <span className={`pill ${pl.clase}`} style={{ marginLeft: 'auto' }}>{pl.texto}</span>
      </div>
      <div className="kcard-cli">{p.cliente}</div>
      {p.estado !== 'remitado' && (p.plan
        ? (
          <div>
            <Link href={`/planeacion?fecha=${p.plan.fecha}`} className={`pill ${p.plan.fecha === hoy ? 'good' : 'info'}`} style={{ textDecoration: 'none' }}
              title={`Camiones: ${p.plan.camiones.join(', ') || '—'}. Ver en Planeación`}>
              {p.plan.fecha === hoy ? 'Sale hoy' : `Planificado ${fmtFecha(p.plan.fecha)}`} · {num2(p.plan.m3)} m³ · {p.plan.viajes} {p.plan.viajes === 1 ? 'viaje' : 'viajes'}
            </Link>
          </div>
        )
        : planListo && faltan(p) > 0.001 && <div><Link href="/planeacion" className="pill" style={{ textDecoration: 'none' }} title="Todavía no tiene viajes en el plan. Ir a Planeación">Sin planificar</Link></div>)}
      {sinRemito > 0.001 && <div><span className="pill warn" title="Hay metros anotados como entregados que todavía no tienen sus viajes cargados">Falta remito · {num2(sinRemito)}</span></div>}
      {p.obra && <div className="muted" style={{ fontSize: 13 }}>{p.obra}</div>}
      <table className="kitems">
        <thead><tr><th>Material</th><th className="r">Pedido</th><th className="r">Entregado</th><th className="r">Falta entregar</th><th className="r">Con remito</th><th className="r">Falta remito</th></tr></thead>
        <tbody>
          {p.items.map((i) => {
            const ent = entregadoDe(i);
            const faltaEntregar = Math.max(0, i.pedido - ent);
            const faltaRemito = Math.max(0, ent - i.conRemito);
            return (
              <tr key={i.materialId}>
                <td><span className="mdot" style={{ background: colorMaterial(i.material) }} />{i.material}</td>
                <td className="r">{num2(i.pedido)}</td>
                <td className="r">
                  {p.estado !== 'pendiente' && puedeCargar && i.itemId && entregadoListo
                    ? <Entregado item={i} alEscribir={(n) => setBorrador((b) => { const s = { ...b }; if (n == null) delete s[i.itemId]; else s[i.itemId] = n; return s; })} alError={alError} />
                    : num2(ent)}
                </td>
                <td className="r" style={{ fontWeight: 600, color: faltaEntregar <= 0.001 ? 'var(--good)' : undefined }}>{faltaEntregar <= 0.001 ? '✓' : num2(faltaEntregar)}</td>
                <td className="r">{i.conRemito > 0.001 ? num2(i.conRemito) : '—'}</td>
                <td className="r" style={{ fontWeight: 600, color: faltaRemito > 0.001 ? 'var(--warn)' : 'var(--muted)' }}>{faltaRemito > 0.001 ? num2(faltaRemito) : ent > 0.001 ? '✓' : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Una sola barra dividida por material: cada tramo mide lo pedido de ese material (sobre el total) y se llena, con su color, según lo entregado. */}
      <div className="kprog" title={`${pct}% completado`}>
        <div className="kbar" role="img" aria-label={`${pct}% completado`}>
          {p.items.map((i) => {
            const c = colorMaterial(i.material);
            const llenado = i.pedido > 0 ? Math.min(100, (entregadoDe(i) / i.pedido) * 100) : 0;
            return (
              <span key={i.materialId} className="kseg" style={{ flexGrow: i.pedido, background: `color-mix(in srgb, ${c} 22%, transparent)` }}
                title={`${i.material}: ${num2(Math.min(entregadoDe(i), i.pedido))} de ${num2(i.pedido)} (${Math.round(llenado)}%)`}>
                <i style={{ width: `${llenado}%`, background: c }} />
              </span>
            );
          })}
        </div>
        <b>{pct}%</b>
      </div>
      <div className="kacts">
        {puedeCargarViaje && <Link className="btn sm" href={hrefViaje(p, materialPendiente(p))}>Cargar viaje</Link>}
        {puedeVincular && <button type="button" className="btn sm" onClick={onVincular} disabled={pending}>Viajes ({p.viajes})</button>}
        {!puedeVincular && p.viajes > 0 && <span className="muted" style={{ fontSize: 12 }}>{p.viajes} viajes vinculados</span>}
        {puedeCargar && (
          <>
            <button type="button" className="btn sm" onClick={onEditar} disabled={pending}>Editar</button>
            {p.estado === 'pendiente' && (
              <>
                <button type="button" className="btn sm" onClick={() => onMover('realizado')} disabled={pending}>Entrega parcial</button>
                <button type="button" className="btn sm" onClick={() => onMover('remitado')} disabled={pending}>Entrega completa</button>
              </>
            )}
            {p.estado === 'realizado' && (
              <>
                <button type="button" className="btn sm" onClick={() => onMover('remitado')} disabled={pending}>Entrega completa</button>
                <button type="button" className="btn sm" onClick={() => onMover('pendiente')} disabled={pending}>Falta entregar</button>
              </>
            )}
            {p.estado === 'remitado' && <button type="button" className="btn sm" onClick={() => onMover('realizado')} disabled={pending}>Falta entregar</button>}
            {p.estado !== 'pendiente' && <button type="button" className="btn sm primary" onClick={onCompletar} disabled={pending}>Completar</button>}
            <button type="button" className="btn sm danger" onClick={onCancelar} disabled={pending}>Cancelar</button>
          </>
        )}
      </div>
    </article>
  );
}

/** Metros entregados de un material, editables mientras el pedido está en "Realizado" (se guarda al salir del campo o con Enter). */
function Entregado({ item, alEscribir, alError }: { item: PedidoCard['items'][number]; alEscribir: (n: number | null) => void; alError: (mensaje: string) => void }) {
  const [valor, setValor] = useState(String(item.entregado));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setValor(String(item.entregado)); }, [item.entregado]);
  const aNumero = (s: string) => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };

  async function guardar() {
    const n = aNumero(valor);
    if (n == null || n === item.entregado) { setValor(String(item.entregado)); alEscribir(null); return; }
    setGuardando(true);
    const r = await registrarEntregado(item.itemId, n);
    setGuardando(false);
    if (r.error) { alError(r.error); setValor(String(item.entregado)); alEscribir(null); } // deshace lo mostrado y avisa
  }
  return (
    <input className="kinput" type="text" inputMode="decimal" value={valor} disabled={guardando} aria-label={`Metros entregados de ${item.material}`}
      onChange={(e) => { setValor(e.target.value); alEscribir(aNumero(e.target.value)); }} onBlur={guardar}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setValor(String(item.entregado)); alEscribir(null); e.currentTarget.blur(); } }} />
  );
}

// ───────────── ventana ─────────────

// ───────────── crear / editar ─────────────
function Formulario({ pedido, cat, segmentoInicial, onCerrar }: { pedido: PedidoCard | null; cat: Catalogos; segmentoInicial?: 'minorista' | 'mayorista'; onCerrar: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clienteId, setClienteId] = useState(pedido?.clienteId ?? '');
  const [obraId, setObraId] = useState(pedido?.obraId ?? '');
  const [prioridad, setPrioridad] = useState<Prioridad>(pedido?.prioridad ?? 'normal');
  const [fechaEntrega, setFechaEntrega] = useState(pedido?.fechaEntrega ?? '');
  const [items, setItems] = useState<{ materialId: string; cantidad: string }[]>(
    pedido?.items.map((i) => ({ materialId: i.materialId, cantidad: String(i.pedido) })) ?? [{ materialId: '', cantidad: '' }],
  );
  // Segmento: se sugiere por el material más grande (más de 12 m³ = mayorista) hasta que se elige a mano
  // Si se está viendo una pestaña (Minorista o Mayorista), el pedido nuevo nace de ese tipo
  const [segmento, setSegmento] = useState<'minorista' | 'mayorista'>(pedido?.segmento ?? segmentoInicial ?? 'minorista');
  const [segTocado, setSegTocado] = useState(!!pedido || !!segmentoInicial);
  function cambiarItems(nuevo: { materialId: string; cantidad: string }[]) {
    setItems(nuevo);
    if (!segTocado) setSegmento(nuevo.some((i) => parseFloat(i.cantidad.replace(',', '.')) > 12) ? 'mayorista' : 'minorista');
  }
  const obras = cat.obras.filter((o) => o.clienteId === clienteId);
  const unidad = (id: string) => cat.materiales.find((m) => m.id === id)?.unidad ?? '';

  function guardar() {
    setError(null);
    const lista = items.filter((i) => i.materialId || i.cantidad).map((i) => ({ materialId: i.materialId, cantidad: parseFloat(i.cantidad.replace(',', '.')) }));
    start(async () => {
      const r = await guardarPedido({ id: pedido?.id ?? null, clienteId, obraId: obraId || null, prioridad, fechaEntrega: fechaEntrega || null, items: lista, segmento });
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
        <label className="fld">Tipo de pedido
          <select value={segmento} onChange={(e) => { setSegmento(e.target.value as 'minorista' | 'mayorista'); setSegTocado(true); }}>
            <option value="minorista">Minorista (viajes de hasta 12 m³)</option>
            <option value="mayorista">Mayorista (viajes de más de 12 m³)</option>
          </select>
          <span className="muted" style={{ fontSize: 12 }}>Define en qué pestaña de Planeación aparece y qué camiones lo pueden hacer.</span>
        </label>
        <div className="fld">Materiales y cantidades
          {items.map((it, n) => (
            <div key={n} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <select value={it.materialId} onChange={(e) => cambiarItems(items.map((x, k) => (k === n ? { ...x, materialId: e.target.value } : x)))} style={{ flex: 1 }} aria-label="Material">
                <option value="">Material…</option>
                {cat.materiales.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              <input type="text" inputMode="decimal" placeholder={unidad(it.materialId) || 'Cantidad'} value={it.cantidad} style={{ width: 110 }} aria-label="Cantidad"
                onChange={(e) => cambiarItems(items.map((x, k) => (k === n ? { ...x, cantidad: e.target.value } : x)))} />
              <button type="button" className="btn sm" onClick={() => cambiarItems(items.length > 1 ? items.filter((_, k) => k !== n) : [{ materialId: '', cantidad: '' }])} aria-label="Quitar material">✕</button>
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
function Vincular({ pedido, puedeVincular, puedeCargarViaje, onCerrar }: { pedido: PedidoCard; puedeVincular: boolean; puedeCargarViaje: boolean; onCerrar: () => void }) {
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {puedeCargarViaje && pedido.items.map((i) => (
            <Link key={i.materialId} className="btn sm" href={hrefViaje(pedido, i.material)}>Cargar viaje de {i.material}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
          {puedeVincular && <button type="button" className="btn primary" onClick={vincular} disabled={pending || !marcados.size}>Vincular {marcados.size ? `(${marcados.size})` : ''}</button>}
        </div>
      </div>
    </Modal>
  );
}
