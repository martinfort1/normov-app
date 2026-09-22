'use client';
import { useMemo, useState, useTransition } from 'react';
import { buscarRemitos, guardarCertificado, type ItemPayload } from './actions';
import { fecha, money, num2, remito as fmtRemito } from '@/lib/format';
import { hoyAR } from '@/lib/periodo';

interface Cliente { id: string; razon_social: string }
type Item = ItemPayload & { key: string };

function round2(n: number) { return Math.round(n * 100) / 100; }

export function ArmarCertificado({ clientes }: { clientes: Cliente[] }) {
  const hoy = hoyAR();
  const [clienteId, setClienteId] = useState('');
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy);
  const [unidad, setUnidad] = useState<'m3' | 't' | 'h'>('m3');
  const [emision, setEmision] = useState(hoy);
  const [items, setItems] = useState<Item[]>([]);
  const [incluirSinNumero, setIncluirSinNumero] = useState(false);
  const [manual, setManual] = useState({ fecha: hoy, remito: '', cantidad: '', precio: '' });
  const [msg, setMsg] = useState<{ tipo: 'good' | 'bad' | 'warn'; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const totales = useMemo(
    () => items.reduce((a, i) => ({ cant: a.cant + i.cantidad, total: a.total + i.total }), { cant: 0, total: 0 }),
    [items],
  );

  function traerRemitos() {
    if (!clienteId) { setMsg({ tipo: 'warn', texto: 'Elegí un cliente primero.' }); return; }
    setMsg(null);
    startTransition(async () => {
      const { rows, error } = await buscarRemitos(clienteId, desde, hasta, incluirSinNumero);
      if (error) { setMsg({ tipo: 'bad', texto: error }); return; }
      // El número de remito se reutiliza con el tiempo: la clave es (número, fecha).
      const have = new Set(items.map((i) => `${i.remito_numero}|${i.fecha}`));
      const nuevos = rows.filter((r) => !have.has(`${r.numero}|${r.fecha}`)).map((r): Item => ({
        key: r.remito_id, remito_id: r.remito_id, remito_numero: r.numero, fecha: r.fecha,
        cantidad: r.cantidad, precio: r.precio, total: round2(r.cantidad * r.precio), origen: 'planilla',
      }));
      setItems((prev) => [...prev, ...nuevos]);
      setMsg({ tipo: nuevos.length ? 'good' : 'warn', texto: nuevos.length ? `${nuevos.length} remitos agregados.` : 'No hay remitos nuevos para ese cliente y esas fechas.' });
    });
  }

  function agregarManual() {
    const num = manual.remito.trim();
    const cant = parseFloat(manual.cantidad), precio = parseFloat(manual.precio);
    if (!num || !manual.fecha || !(cant > 0) || !(precio >= 0)) { setMsg({ tipo: 'warn', texto: 'Completá fecha, número de remito, cantidad y precio.' }); return; }
    if (items.some((i) => i.remito_numero === num && i.fecha === manual.fecha)) { setMsg({ tipo: 'warn', texto: `El remito ${num} del ${manual.fecha} ya está en este certificado.` }); return; }
    setItems((prev) => [...prev, { key: 'm' + num + '|' + manual.fecha, remito_id: null, remito_numero: num, fecha: manual.fecha, cantidad: cant, precio, total: round2(cant * precio), origen: 'manual' }]);
    setManual({ fecha: manual.fecha, remito: '', cantidad: '', precio: '' });
    setMsg(null);
  }

  function editar(key: string, campo: 'cantidad' | 'precio', valor: string) {
    const v = parseFloat(valor);
    if (Number.isNaN(v) || v < 0) return;
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [campo]: v, total: round2((campo === 'cantidad' ? v : i.cantidad) * (campo === 'precio' ? v : i.precio)) } : i)));
  }

  function quitar(key: string) { setItems((prev) => prev.filter((i) => i.key !== key)); }

  function guardar() {
    if (!clienteId) { setMsg({ tipo: 'warn', texto: 'Elegí un cliente.' }); return; }
    if (!items.length) { setMsg({ tipo: 'warn', texto: 'Agregá al menos un remito.' }); return; }
    setMsg(null);
    startTransition(async () => {
      const { error, numero } = await guardarCertificado({
        clienteId, desde, hasta, unidad, emision,
        items: items.map(({ key: _key, ...rest }) => rest),
      });
      if (error) { setMsg({ tipo: 'bad', texto: error }); return; }
      setMsg({ tipo: 'good', texto: `Certificado N° ${String(numero).padStart(4, '0')} guardado como pendiente.` });
      setItems([]);
    });
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Armar certificado</h2>
      <div style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>Cliente</label><br />
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ width: '100%' }}>
              <option value="">Elegir…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </select>
          </div>
          <div><label className="muted" style={{ fontSize: 12 }}>Desde</label><br /><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: '100%' }} /></div>
          <div><label className="muted" style={{ fontSize: 12 }}>Hasta</label><br /><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: '100%' }} /></div>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>Unidad</label><br />
            <select value={unidad} onChange={(e) => setUnidad(e.target.value as typeof unidad)} style={{ width: '100%' }}>
              <option value="m3">m³</option><option value="t">toneladas</option><option value="h">horas</option>
            </select>
          </div>
        </div>
        <div><label className="muted" style={{ fontSize: 12 }}>Fecha de emisión</label><br /><input type="date" value={emision} onChange={(e) => setEmision(e.target.value)} /></div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', margin: '0 0 8px' }}>A · Desde los remitos cargados</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={traerRemitos} disabled={pending}>{pending ? 'Buscando…' : 'Traer remitos'}</button>
            <label className="row" style={{ gap: 6, fontSize: 13.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={incluirSinNumero} onChange={(e) => setIncluirSinNumero(e.target.checked)} style={{ minHeight: 'auto' }} />
              Incluir viajes sin número de remito propio
            </label>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', margin: '0 0 8px' }}>B · Carga manual <span className="muted" style={{ textTransform: 'none' }}>(obras que no están en la planilla)</span></h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <input type="date" value={manual.fecha} onChange={(e) => setManual({ ...manual, fecha: e.target.value })} aria-label="Fecha" />
            <input type="text" value={manual.remito} onChange={(e) => setManual({ ...manual, remito: e.target.value })} placeholder="N° remito" aria-label="N° remito" />
            <input type="number" step="0.01" min="0" value={manual.cantidad} onChange={(e) => setManual({ ...manual, cantidad: e.target.value })} placeholder="Cantidad" aria-label="Cantidad" />
            <input type="number" step="0.01" min="0" value={manual.precio} onChange={(e) => setManual({ ...manual, precio: e.target.value })} placeholder="Precio unitario" aria-label="Precio unitario" />
          </div>
          <button type="button" onClick={agregarManual} style={{ marginTop: 8 }}>Agregar remito</button>
        </div>

        {msg && <div className={`banner ${msg.tipo === 'bad' ? 'err' : ''}`} style={{ margin: 0 }}>{msg.texto}</div>}
      </div>

      <table style={{ marginTop: 16 }}>
        <thead><tr><th>Fecha</th><th>N° remito</th><th className="r">Cantidad</th><th className="r">Precio</th><th className="r">Total</th><th /></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <td>{fecha(i.fecha)}</td><td>{fmtRemito(i.remito_numero)} {i.origen === 'manual' && <span className="pill">manual</span>}</td>
              <td className="r"><input type="number" step="0.01" min="0" value={i.cantidad} onChange={(e) => editar(i.key, 'cantidad', e.target.value)} style={{ width: 90 }} /></td>
              <td className="r"><input type="number" step="0.01" min="0" value={i.precio} onChange={(e) => editar(i.key, 'precio', e.target.value)} style={{ width: 100 }} /></td>
              <td className="r">{money(i.total)}</td>
              <td><button type="button" onClick={() => quitar(i.key)} aria-label={`Quitar remito ${i.remito_numero}`} style={{ color: 'var(--bad)', border: 0, background: 'none' }}>×</button></td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} className="muted">Todavía no hay remitos. Usá A o B para cargarlos.</td></tr>}
          {items.length > 0 && (
            <tr style={{ fontWeight: 600 }}><td colSpan={2}>{items.length} remitos</td><td className="r">{num2(totales.cant)}</td><td /><td className="r">{money(totales.total)}</td><td /></tr>
          )}
        </tbody>
      </table>

      <button type="button" className="primary" onClick={guardar} disabled={pending || !items.length} style={{ marginTop: 12 }}>
        {pending ? 'Guardando…' : 'Guardar y enviar a aprobación'}
      </button>
    </div>
  );
}
