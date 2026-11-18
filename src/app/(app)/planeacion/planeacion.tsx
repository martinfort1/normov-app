'use client';
import { useState, useTransition } from 'react';
import { SegmentoTabs, useVista, type Vista } from '@/components/segmento-tabs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fecha as fmtFecha, num2 } from '@/lib/format';
import { addDays } from '@/lib/periodo';
import { colorMaterial } from '@/lib/colores';
import { Modal } from '@/components/modal';
import { agregarViaje, eliminarCamion, guardarCamion, marcarHecho, intercambiarViajes, quitarViaje, setCantera, setChoferDelDia, setDisponible, type Resultado } from './actions';

/** Minorista: viajes de hasta 12 m³. Mayorista: más de 12 m³. */
export type Segmento = 'minorista' | 'mayorista';

export interface ViajePlan {
  segmento: Segmento;
  id: string; orden: number; pedidoId: string; materialId: string; material: string; unidad: string; cantidad: number; hecho: boolean;
  numeroPedido: number; cliente: string; obra: string | null;
  /** Punto de retiro ("Desde"); el destino ("Hasta") es el cliente / obra */
  cantera: string;
  /** Ya se cargó su remito desde "Cargar viaje" (queda vinculado al pedido) */
  cargado: boolean;
}
export interface CamionPlan {
  id: string; patente: string; chofer: string; choferDia: string | null; capacidad: number; disponible: boolean; viajes: ViajePlan[];
  /** Camión grande: no hace viajes de pedidos minoristas (los chicos hacen de los dos tipos) */
  soloMayorista: boolean;
}
export interface PedidoPlan {
  segmento: Segmento;
  id: string; numero: number; cliente: string; obra: string | null; prioridad: string; fechaEntrega: string | null;
  items: { materialId: string; material: string; unidad: string; pedido: number; entregado: number; planificado: number }[];
}

const PRIORIDAD: Record<string, { label: string; clase: string }> = {
  urgente: { label: 'Urgente', clase: 'bad' }, alta: { label: 'Alta', clase: 'warn' }, normal: { label: 'Normal', clase: 'info' }, baja: { label: 'Baja', clase: '' },
};
const u = (x: string) => (x === 'm3' ? 'm³' : x);
const choferDe = (c: CamionPlan) => c.choferDia ?? c.chofer;

/** Texto del itinerario de un camión, listo para pegar en WhatsApp. */
function textoWhatsApp(c: CamionPlan, fecha: string): string {
  const chofer = choferDe(c);
  const lineas = c.viajes.map((v, n) => `${n + 1}. ${v.cantera ? `Desde ${v.cantera} → ` : ''}Hasta ${v.cliente}${v.obra ? ` / ${v.obra}` : ''} — ${v.material} ${num2(v.cantidad)} ${u(v.unidad)}${v.hecho ? ' ✅' : ''}`);
  const total = c.viajes.reduce((s, v) => s + v.cantidad, 0);
  return [`*Itinerario ${fmtFecha(fecha)} — ${c.patente}${chofer ? ` (${chofer})` : ''}*`, ...(lineas.length ? lineas : ['Sin viajes asignados.']), ...(lineas.length ? [`Total: ${num2(total)} m³`] : [])].join('\n');
}

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch {
    try {
      const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch { return false; }
  }
}

type Ventana = { tipo: 'asignar'; camionId?: string; pedidoId?: string; materialId?: string } | { tipo: 'camion'; camion: CamionPlan | null } | null;

export function Planeacion({ fecha, hoy, camiones, pedidos: todosPedidos, canteras, segmentoListo, puedeCargar, puedeCargarViaje }: {
  fecha: string; hoy: string; camiones: CamionPlan[]; pedidos: PedidoPlan[]; canteras: string[]; segmentoListo: boolean; puedeCargar: boolean; puedeCargarViaje: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'bad' | 'good'; texto: string } | null>(null);
  const [ventana, setVentana] = useState<Ventana>(null);
  // Vista activa: Todos / Minorista / Mayorista (se recuerda en este navegador)
  const [seg, elegirSeg] = useVista('normov.plan.vista');

  function correr(fn: () => Promise<Resultado>, okTexto?: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ tipo: 'bad', texto: r.error });
      else if (okTexto) setMsg({ tipo: 'good', texto: okTexto });
    });
  }

  // Cada vista muestra sus pedidos, los camiones que pueden hacerlos y, en cada camión, solo los viajes de ese tipo.
  // Los camiones chicos hacen viajes de los dos tipos; los "solo mayorista" (grandes) no entran en Minorista. "Todos" muestra todo.
  const delTipo = (s: Segmento) => seg === 'todos' || s === seg;
  const pedidos = todosPedidos.filter((p) => delTipo(p.segmento));
  const noDisponibles = camiones.filter((c) => !c.disponible);
  const aptos = (c: CamionPlan) => seg !== 'minorista' || !c.soloMayorista;
  const disponibles = camiones.filter((c) => c.disponible && aptos(c)).map((c) => ({ ...c, viajes: c.viajes.filter((v) => delTipo(v.segmento)), todos: c.viajes }));
  const ocultos = camiones.filter((c) => c.disponible && !aptos(c)).length;
  const viajesDelDia = disponibles.reduce((s, c) => s + c.viajes.length, 0);
  const m3Dia = disponibles.reduce((s, c) => s + c.viajes.reduce((a, v) => a + v.cantidad, 0), 0);
  const contar = (s: Vista) => {
    const p = todosPedidos.filter((x) => s === 'todos' || x.segmento === s).length;
    const v = camiones.reduce((n, c) => n + c.viajes.filter((x) => s === 'todos' || x.segmento === s).length, 0);
    return `${p} ${p === 1 ? 'pedido' : 'pedidos'} · ${v} ${v === 1 ? 'viaje' : 'viajes'}`;
  };
  const href = (f: string) => `/planeacion?fecha=${f}`;

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link className="btn sm" href={href(addDays(fecha, -1))} aria-label="Día anterior">‹</Link>
        <input type="date" value={fecha} onChange={(e) => { if (e.target.value) router.push(href(e.target.value)); }} aria-label="Fecha del plan" />
        <Link className="btn sm" href={href(addDays(fecha, 1))} aria-label="Día siguiente">›</Link>
        {fecha !== hoy && <Link className="btn sm" href={href(hoy)}>Hoy</Link>}
        <strong style={{ marginLeft: 8 }}>{fmtFecha(fecha)}</strong>
        <span className="note" style={{ margin: 0 }}>
          {disponibles.length} {disponibles.length === 1 ? 'camión disponible' : 'camiones disponibles'}
          {noDisponibles.length > 0 && ` (${noDisponibles.length} no disponible${noDisponibles.length === 1 ? '' : 's'})`} · {viajesDelDia} {viajesDelDia === 1 ? 'viaje' : 'viajes'} · {num2(m3Dia)} m³ planificados
        </span>
        {puedeCargar && <button type="button" className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setVentana({ tipo: 'camion', camion: null })}>Agregar camión</button>}
      </div>
      <SegmentoTabs valor={seg} onChange={elegirSeg} contar={contar} />
      {!segmentoListo && <div className="banner">Para separar los pedidos en Minorista y Mayorista falta correr <b>0018_segmentos_costos.sql</b> en Supabase. Mientras tanto todo aparece como minorista.</div>}
      {seg === 'minorista' && ocultos > 0 && <p className="note" style={{ marginTop: 0 }}>{ocultos} {ocultos === 1 ? 'camión no se muestra porque es' : 'camiones no se muestran porque son'} solo para viajes mayoristas.</p>}
      {msg && <div className={`banner ${msg.tipo === 'bad' ? 'err' : 'ok'}`} role="status">{msg.texto}</div>}

      <div className="plan-grid" aria-busy={pending}>
        {/* ───────── pedidos pendientes ───────── */}
        <section className="plan-pedidos" aria-label="Pedidos pendientes">
          <h2 className="plan-h">Pedidos para entregar <span className="pill">{pedidos.length}</span></h2>
          {!pedidos.length && <p className="muted">No hay pedidos {seg === 'minorista' ? 'minoristas ' : seg === 'mayorista' ? 'mayoristas ' : ''}pendientes.</p>}
          {pedidos.map((p) => {
            const pr = PRIORIDAD[p.prioridad] ?? PRIORIDAD.normal;
            const pedido = p.items.reduce((s, i) => s + i.pedido, 0);
            const hecho = p.items.reduce((s, i) => s + Math.min(i.entregado, i.pedido), 0);
            const plan = p.items.reduce((s, i) => s + Math.min(i.planificado, Math.max(0, i.pedido - i.entregado)), 0);
            const ya = pedido > 0 ? Math.round((hecho / pedido) * 100) : 0;
            const luego = pedido > 0 ? Math.round(((hecho + plan) / pedido) * 100) : 0;
            return (
              <article key={p.id} className={`kcard prio-${p.prioridad}`}>
                <div className="kcard-top">
                  <span className="muted">#{p.numero}</span>
                  <span className={`pill ${pr.clase}`}>{pr.label}</span>
                  {p.fechaEntrega && <span className="pill" style={{ marginLeft: 'auto' }}>Entrega {fmtFecha(p.fechaEntrega)}</span>}
                </div>
                <div className="kcard-cli">{p.cliente}</div>
                {p.obra && <div className="muted" style={{ fontSize: 13 }}>{p.obra}</div>}
                <table className="kitems">
                  <thead><tr><th>Material</th><th className="r">Falta</th><th className="r">Plan del día</th><th className="r">Queda</th></tr></thead>
                  <tbody>
                    {p.items.map((i) => {
                      const falta = Math.max(0, i.pedido - i.entregado);
                      const queda = falta - i.planificado;
                      return (
                        <tr key={i.materialId}>
                          <td><span className="mdot" style={{ background: colorMaterial(i.material) }} />{i.material}</td>
                          <td className="r">{falta <= 0.001 ? '✓' : num2(falta)}</td>
                          <td className="r" style={{ color: i.planificado > 0 ? 'var(--bronze-ink)' : 'var(--muted)' }}>{i.planificado > 0 ? `+${num2(i.planificado)}` : '—'}</td>
                          <td className="r" style={{ fontWeight: 600, color: queda < -0.001 ? 'var(--bad)' : queda <= 0.001 ? 'var(--good)' : undefined }}
                            title={queda < -0.001 ? 'Lo planificado supera lo que falta' : undefined}>{queda <= 0.001 && queda >= -0.001 ? '✓' : num2(queda)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="kprog" title={`${ya}% entregado · ${luego}% con el plan del día`}>
                  <div className="pbar" role="img" aria-label={`${ya}% entregado, ${luego}% con el plan del día`}>
                    <span className="hecho" style={{ width: `${Math.min(100, ya)}%` }} />
                    <span className="previsto" style={{ left: `${Math.min(100, ya)}%`, width: `${Math.max(0, Math.min(100, luego) - Math.min(100, ya))}%` }} />
                  </div>
                  <b>{ya}%{luego > ya && <span className="muted"> → {luego}%</span>}</b>
                </div>
                {puedeCargar && (
                  <div className="kacts"><button type="button" className="btn sm" onClick={() => setVentana({ tipo: 'asignar', pedidoId: p.id })} disabled={!disponibles.length}>Asignar a un camión</button></div>
                )}
              </article>
            );
          })}
        </section>

        {/* ───────── camiones ───────── */}
        <section aria-label="Camiones">
          <h2 className="plan-h">Camiones del día <span className="pill">{disponibles.length}</span></h2>
          {!camiones.length && <div className="banner">Todavía no cargaste camiones. Tocá <b>Agregar camión</b> y poné su patente y cuántos m³ carga por viaje.</div>}
          <div className="plan-camiones">
            {disponibles.map((c) => {
              const total = c.viajes.reduce((s, v) => s + v.cantidad, 0);
              const hechos = c.viajes.filter((v) => v.hecho).length;
              return (
                <article key={c.id} className="panel plan-camion">
                  <header className="plan-camion-h">
                    <div>
                      <div className="plan-patente">{c.patente}{c.soloMayorista && <span className="pill" style={{ marginLeft: 8, fontSize: 11 }} title="Camión grande: no hace viajes minoristas">Solo mayorista</span>}</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>Carga {num2(c.capacidad)} m³ por viaje</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={`pill ${c.viajes.length ? 'good' : ''}`}>{c.viajes.length ? `${c.viajes.length} ${c.viajes.length === 1 ? 'viaje' : 'viajes'} · ${num2(total)} m³` : 'Libre'}</span>
                      {c.viajes.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{hechos} de {c.viajes.length} hechos</div>}
                    </div>
                  </header>
                  <ChoferDelDia camion={c} fecha={fecha} puedeCargar={puedeCargar} alError={(t) => setMsg({ tipo: 'bad', texto: t })} />
                  <ol className="plan-itin">
                    {c.viajes.map((v, n) => (
                      <li key={v.id} className={v.hecho ? 'hecho' : ''}>
                        <span className="plan-n">{n + 1}</span>
                        <div className="plan-dest">
                          <Desde viaje={v} canteras={canteras} puedeCargar={puedeCargar} alError={(t) => setMsg({ tipo: 'bad', texto: t })} />
                          <div><span className="plan-lbl">Hasta</span><strong>{v.cliente}</strong>{v.obra && <span className="muted"> · {v.obra}</span>}</div>
                          <div style={{ fontSize: 13 }}><span className="mdot" style={{ background: colorMaterial(v.material) }} />{v.material} · <strong>{num2(v.cantidad)} {u(v.unidad)}</strong> <span className="muted">· pedido #{v.numeroPedido}</span></div>
                          {v.cargado
                            ? <span className="pill good" style={{ marginTop: 4 }} title="El remito ya está cargado y vinculado al pedido">Remito cargado</span>
                            : puedeCargarViaje && (
                              <Link className="btn sm" style={{ marginTop: 4 }} href={hrefCargarViaje(v, c, fecha)}
                                title="Al guardar el viaje queda vinculado al pedido y marcado como hecho">Cargar viaje</Link>
                            )}
                        </div>
                        {puedeCargar && (
                          <div className="plan-acc">
                            <button type="button" className="btn sm" title="Subir" aria-label="Subir" disabled={pending || n === 0} onClick={() => correr(() => intercambiarViajes(v.id, c.viajes[n - 1].id))}>↑</button>
                            <button type="button" className="btn sm" title="Bajar" aria-label="Bajar" disabled={pending || n === c.viajes.length - 1} onClick={() => correr(() => intercambiarViajes(v.id, c.viajes[n + 1].id))}>↓</button>
                            <button type="button" className={`btn sm${v.hecho ? ' primary' : ''}`} title={v.hecho ? 'Marcar como no hecho' : 'Marcar como hecho'} aria-label="Hecho" disabled={pending} onClick={() => correr(() => marcarHecho(v.id, !v.hecho), v.hecho ? `Viaje desmarcado: se restaron ${num2(v.cantidad)} ${u(v.unidad)} de ${v.material} al pedido #${v.numeroPedido}.` : `Viaje hecho: ${num2(v.cantidad)} ${u(v.unidad)} de ${v.material} ya suman al pedido #${v.numeroPedido}.`)}>✓</button>
                            <button type="button" className="btn sm danger" title="Quitar del itinerario" aria-label="Quitar" disabled={pending} onClick={() => correr(() => quitarViaje(v.id))}>✕</button>
                          </div>
                        )}
                      </li>
                    ))}
                    {!c.viajes.length && <li className="vacio muted">Sin viajes asignados para este día.</li>}
                  </ol>
                  <div className="kacts">
                    {puedeCargar && <button type="button" className="btn sm" onClick={() => setVentana({ tipo: 'asignar', camionId: c.id })}>+ Agregar viaje</button>}
                    <button type="button" className="btn sm" onClick={async () => {
                      const ok = await copiar(textoWhatsApp({ ...c, viajes: c.todos }, fecha)); // el itinerario completo del día, de los dos tipos
                      setMsg({ tipo: ok ? 'good' : 'bad', texto: ok ? `Itinerario de ${c.patente} copiado: pegalo en WhatsApp.` : 'No se pudo copiar el texto.' });
                    }}>Copiar para WhatsApp</button>
                    {puedeCargar && <button type="button" className="btn sm" onClick={() => setVentana({ tipo: 'camion', camion: c })}>Editar camión</button>}
                  </div>
                </article>
              );
            })}
          </div>
          {disponibles.some((c) => c.viajes.length) && (
            <p style={{ margin: '4px 0 16px' }}>
              <button type="button" className="btn" onClick={async () => {
                const ok = await copiar(disponibles.filter((c) => c.todos.length).map((c) => textoWhatsApp({ ...c, viajes: c.todos }, fecha)).join('\n\n'));
                setMsg({ tipo: ok ? 'good' : 'bad', texto: ok ? 'Itinerarios de todos los camiones copiados: pegalos en WhatsApp.' : 'No se pudo copiar. Probá desde cada camión.' });
              }}>Copiar todos los itinerarios</button>
            </p>
          )}
          {noDisponibles.length > 0 && (
            <div className="panel">
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>No disponibles</h3>
              <ul className="vlist">
                {noDisponibles.map((c) => (
                  <li key={c.id}><span><strong>{c.patente}</strong> <span className="muted">· {num2(c.capacidad)} m³{c.chofer ? ` · ${c.chofer}` : ''}</span></span>
                    {puedeCargar && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn sm" disabled={pending} onClick={() => correr(() => setDisponible(c.id, true))}>Habilitar</button>
                        <button type="button" className="btn sm" onClick={() => setVentana({ tipo: 'camion', camion: c })}>Editar</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {ventana?.tipo === 'asignar' && (
        <Asignar fecha={fecha} camiones={disponibles} pedidos={pedidos} canteras={canteras} inicial={ventana} onCerrar={() => setVentana(null)} />
      )}
      {ventana?.tipo === 'camion' && <FormCamion camion={ventana.camion} onCerrar={() => setVentana(null)} />}
    </>
  );
}

/** Link a "Cargar viaje" con todo lo del itinerario ya completado (cliente, obra, material, camión, chofer, m³ y fecha). */
function hrefCargarViaje(v: ViajePlan, c: CamionPlan, fecha: string) {
  const q = new URLSearchParams({ tipo: 'viaje', razon: v.cliente, cliente: v.obra ?? '', material: v.material, camion: c.patente, chofer: choferDe(c), cantidad: String(v.cantidad), fecha, cantera: v.cantera, plan: v.id });
  return `/cargar?${q.toString()}`;
}

// ───────────── chofer del día ─────────────
function ChoferDelDia({ camion, fecha, puedeCargar, alError }: { camion: CamionPlan; fecha: string; puedeCargar: boolean; alError: (t: string) => void }) {
  const [valor, setValor] = useState(camion.choferDia ?? '');
  const [guardando, setGuardando] = useState(false);
  const efectivo = camion.choferDia ?? camion.chofer;
  if (!puedeCargar) return <div className="muted" style={{ fontSize: 13 }}>Chofer: {efectivo || 'sin asignar'}</div>;
  async function guardar() {
    if (valor.trim() === (camion.choferDia ?? '')) return;
    setGuardando(true);
    const r = await setChoferDelDia(fecha, camion.id, valor);
    setGuardando(false);
    if (r.error) alError(r.error);
  }
  return (
    <label className="fld" style={{ margin: '8px 0' }}>Chofer del día
      <input type="text" value={valor} disabled={guardando} placeholder={camion.chofer ? `Habitual: ${camion.chofer}` : 'Nombre del chofer'} onChange={(e) => setValor(e.target.value)} onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    </label>
  );
}

// ───────────── punto de retiro ("Desde") ─────────────
function Desde({ viaje, canteras, puedeCargar, alError }: { viaje: ViajePlan; canteras: string[]; puedeCargar: boolean; alError: (t: string) => void }) {
  const [valor, setValor] = useState(viaje.cantera);
  const [guardando, setGuardando] = useState(false);
  const id = `dl-desde-${viaje.id}`;
  if (!puedeCargar) return <div><span className="plan-lbl">Desde</span>{viaje.cantera ? <strong>{viaje.cantera}</strong> : <span className="muted">sin definir</span>}</div>;
  async function guardar() {
    if (valor.trim().toUpperCase() === viaje.cantera) return;
    setGuardando(true);
    const r = await setCantera(viaje.id, valor);
    setGuardando(false);
    if (r.error) { alError(r.error); setValor(viaje.cantera); }
  }
  return (
    <div className="plan-desde">
      <span className="plan-lbl">Desde</span>
      <input type="text" className="kinput plan-cantera" list={id} value={valor} disabled={guardando} placeholder="Cantera" aria-label="Punto de retiro (cantera)" autoComplete="off"
        onChange={(e) => setValor(e.target.value)} onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <datalist id={id}>{canteras.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

// ───────────── asignar un viaje ─────────────
function Asignar({ fecha, camiones, pedidos, canteras, inicial, onCerrar }: {
  fecha: string; camiones: CamionPlan[]; pedidos: PedidoPlan[]; canteras: string[]; inicial: { camionId?: string; pedidoId?: string; materialId?: string }; onCerrar: () => void;
}) {
  const [cantera, setCanteraTxt] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [camionId, setCamionId] = useState(inicial.camionId ?? (camiones.length === 1 ? camiones[0].id : ''));
  const [pedidoId, setPedidoId] = useState(inicial.pedidoId ?? '');
  const pedido = pedidos.find((p) => p.id === pedidoId);
  const [materialId, setMaterialId] = useState(inicial.materialId ?? '');
  const camion = camiones.find((c) => c.id === camionId);
  // A un pedido minorista no se le asignan camiones grandes ("solo mayorista")
  const camionesAptos = camiones.filter((c) => !(pedido?.segmento === 'minorista' && c.soloMayorista));
  const item = pedido?.items.find((i) => i.materialId === materialId);
  const faltaSinPlan = item ? Math.max(0, item.pedido - item.entregado - item.planificado) : 0;
  const sugerida = (c?: CamionPlan, i?: typeof item) => (c && i ? Math.min(c.capacidad, Math.max(0, i.pedido - i.entregado - i.planificado)) || c.capacidad : 0);
  const [cantidad, setCantidad] = useState('');
  const [veces, setVeces] = useState('1');

  // Al elegir pedido: si tiene un solo material, queda elegido; la cantidad se sugiere con la capacidad del camión y lo que falta
  function elegirPedido(id: string) {
    setPedidoId(id);
    const p = pedidos.find((x) => x.id === id);
    if (p?.segmento === 'minorista' && camion?.soloMayorista) setCamionId(''); // el camión elegido no puede con este pedido
    const m = p && p.items.length === 1 ? p.items[0].materialId : '';
    setMaterialId(m);
    setCantidad(m ? String(sugerida(camion, p?.items[0])) : '');
  }
  function elegirMaterial(id: string) {
    setMaterialId(id);
    setCantidad(String(sugerida(camion, pedido?.items.find((i) => i.materialId === id))));
  }
  function elegirCamion(id: string) {
    setCamionId(id);
    const c = camiones.find((x) => x.id === id);
    if (item && c) setCantidad(String(sugerida(c, item)));
  }

  function guardar() {
    setError(null);
    const n = parseFloat(cantidad.replace(',', '.'));
    if (!camionId || !pedidoId || !materialId) { setError('Elegí el pedido, el material y el camión.'); return; }
    if (!(n > 0)) { setError('Poné los m³ del viaje.'); return; }
    const k = Number(veces);
    if (!Number.isInteger(k) || k < 1 || k > 30) { setError('La cantidad de viajes tiene que ser un número entero de 1 a 30.'); return; }
    start(async () => {
      const r = await agregarViaje({ fecha, camionId, pedidoId, materialId, cantidad: n, cantera, repetir: k });
      if (r.error) setError(r.error); else onCerrar();
    });
  }

  return (
    <Modal titulo={`Asignar viaje · ${fmtFecha(fecha)}`} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="fld">Pedido
          <select value={pedidoId} onChange={(e) => elegirPedido(e.target.value)}>
            <option value="">Elegí un pedido…</option>
            {pedidos.map((p) => <option key={p.id} value={p.id}>#{p.numero} · {p.cliente}{p.obra ? ` / ${p.obra}` : ''}</option>)}
          </select>
        </label>
        <label className="fld">Material
          <select value={materialId} onChange={(e) => elegirMaterial(e.target.value)} disabled={!pedido}>
            <option value="">Elegí el material…</option>
            {pedido?.items.map((i) => <option key={i.materialId} value={i.materialId}>{i.material} (falta {num2(Math.max(0, i.pedido - i.entregado))} {u(i.unidad)})</option>)}
          </select>
        </label>
        <label className="fld">Camión
          <select value={camionId} onChange={(e) => elegirCamion(e.target.value)}>
            <option value="">Elegí un camión…</option>
            {camionesAptos.map((c) => <option key={c.id} value={c.id}>{c.patente} · carga {num2(c.capacidad)} m³ · {c.viajes.length} {c.viajes.length === 1 ? 'viaje' : 'viajes'}</option>)}
          </select>
        </label>
        <label className="fld">Desde (cantera donde retira)
          <input type="text" list="dl-asignar-cantera" value={cantera} onChange={(e) => setCanteraTxt(e.target.value)} placeholder="Elegí o escribí una cantera" autoComplete="off" />
          <datalist id="dl-asignar-cantera">{canteras.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="fld">m³ de cada viaje
            <input type="text" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </label>
          <label className="fld">Cantidad de viajes
            <input type="text" inputMode="numeric" value={veces} onChange={(e) => setVeces(e.target.value.replace(/\D/g, ''))} aria-describedby="ayuda-viajes" />
          </label>
        </div>
        {(() => {
          const n = parseFloat(cantidad.replace(',', '.')), k = Number(veces);
          const total = n > 0 && k > 0 ? n * k : 0;
          return (
            <span id="ayuda-viajes" className="muted" style={{ fontSize: 12, marginTop: -4 }}>
              {k > 1 && total > 0 ? <><strong>{k} viajes iguales de {num2(n)} m³ = {num2(total)} m³</strong> (uno detrás de otro en el itinerario). </> : ''}
              {camion ? `Máximo ${num2(camion.capacidad)} m³ por viaje (lo que carga este camión). ` : ''}
              {item ? `Sin asignar de este material: ${num2(faltaSinPlan)} m³.` : ''}
              {item && total > faltaSinPlan + 0.001 ? <span style={{ color: 'var(--warn)' }}> Lo que cargás supera lo que falta asignar.</span> : null}
            </span>
          );
        })()}
        {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary" onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : Number(veces) > 1 ? `Agregar ${Number(veces)} viajes` : 'Agregar al itinerario'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────── camión (crear / editar) ─────────────
function FormCamion({ camion, onCerrar }: { camion: CamionPlan | null; onCerrar: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [patente, setPatente] = useState(camion?.patente ?? '');
  const [chofer, setChofer] = useState(camion?.chofer ?? '');
  const [capacidad, setCapacidad] = useState(camion ? String(camion.capacidad) : '');
  const [disponible, setDisponible_] = useState(camion?.disponible ?? true);
  const [soloMayorista, setSoloMayorista] = useState(camion?.soloMayorista ?? false);
  const [mayTocado, setMayTocado] = useState(!!camion);
  // Un camión nuevo que carga más de 12 m³ se sugiere como "solo mayorista" (hasta que se decide a mano)
  function cambiarCapacidad(v: string) {
    setCapacidad(v);
    if (!mayTocado) setSoloMayorista(parseFloat(v.replace(',', '.')) > 12);
  }

  function guardar() {
    setError(null);
    start(async () => {
      const r = await guardarCamion({ id: camion?.id ?? null, patente, chofer, capacidad: parseFloat(capacidad.replace(',', '.')), disponible, soloMayorista });
      if (r.error) setError(r.error); else onCerrar();
    });
  }
  function borrar() {
    if (!camion || !confirm(`¿Eliminar el camión ${camion.patente}? También se borran sus itinerarios. Si solo está en el taller, mejor desmarcá "Disponible".`)) return;
    start(async () => {
      const r = await eliminarCamion(camion.id);
      if (r.error) setError(r.error); else onCerrar();
    });
  }
  return (
    <Modal titulo={camion ? `Editar camión ${camion.patente}` : 'Agregar camión'} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="fld">Patente<input type="text" value={patente} onChange={(e) => setPatente(e.target.value)} autoComplete="off" /></label>
          <label className="fld">Capacidad (m³ por viaje)<input type="text" inputMode="decimal" value={capacidad} onChange={(e) => cambiarCapacidad(e.target.value)} /></label>
        </div>
        <label className="fld">Chofer habitual (opcional)<input type="text" value={chofer} onChange={(e) => setChofer(e.target.value)} autoComplete="off" /></label>
        <label className="campo check row" style={{ gap: 8 }}>
          <input type="checkbox" checked={disponible} onChange={(e) => setDisponible_(e.target.checked)} style={{ minHeight: 'auto' }} /> Disponible (desmarcá si está en el taller o fuera de servicio)
        </label>
        <label className="campo check row" style={{ gap: 8 }}>
          <input type="checkbox" checked={soloMayorista} onChange={(e) => { setSoloMayorista(e.target.checked); setMayTocado(true); }} style={{ minHeight: 'auto' }} /> Camión grande: solo viajes mayoristas (no se le asignan pedidos minoristas)
        </label>
        {error && <div className="banner err" style={{ margin: 0 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          {camion ? <button type="button" className="btn danger" onClick={borrar} disabled={pending}>Eliminar</button> : <span />}
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="btn primary" onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
