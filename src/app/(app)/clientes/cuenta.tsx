'use client';
import { useMemo, useState, useTransition } from 'react';
import { Modal } from '@/components/modal';
import { money, fecha as fmtFecha, certNo } from '@/lib/format';
import { registrarCobranza, anularCobranza, guardarSaldosIniciales } from './actions';

export interface CuentaFila { clienteId: string; nombre: string; saldoInicial: number; al: string | null; facturado: number; cobrado: number }
export interface CertPend { id: string; clienteId: string; numero: number; emision: string; total: number; pendiente: number }
export interface CobranzaFila { id: string; numero: number; fecha: string; cliente: string; monto: number; imputado: number; anulada: boolean; observaciones: string | null }
export interface SaldoPlanilla { nombre: string; saldo: number }

const redondeo = (n: number) => Math.round(n * 100) / 100;
const aNum = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const saldoDe = (c: CuentaFila) => redondeo(c.saldoInicial + c.facturado - c.cobrado);

export function CuentaCorriente({ cuentas, certs, cobranzas, clientes, planillas, puedeEscribir, hoy }: {
  cuentas: CuentaFila[]; certs: CertPend[]; cobranzas: CobranzaFila[]; clientes: { id: string; nombre: string }[];
  planillas: { cta: SaldoPlanilla[]; diego: SaldoPlanilla[] }; puedeEscribir: boolean; hoy: string;
}) {
  const [q, setQ] = useState('');
  const [cobrando, setCobrando] = useState<CuentaFila | null>(null);
  const [inicial, setInicial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filas = useMemo(() => {
    const t = q.trim().toUpperCase();
    return cuentas.filter((c) => !t || c.nombre.toUpperCase().includes(t));
  }, [cuentas, q]);
  const total = filas.reduce((a, c) => a + saldoDe(c), 0);
  const sinArrancar = cuentas.every((c) => !c.al);

  function anular(c: CobranzaFila) {
    if (!confirm(`¿Anular la cobranza N° ${c.numero} de ${c.cliente} por ${money(c.monto)}? Vuelve a deber lo imputado y se anula su ingreso en la caja.`)) return;
    setError(null);
    start(async () => { const r = await anularCobranza(c.id); if (r.error) setError(r.error); });
  }

  return (
    <>
      {error && <div className="banner err">{error}</div>}
      {sinArrancar && puedeEscribir && (
        <div className="banner">
          Todavía no se fijó desde cuándo la cuenta corriente corre en la app. Cargá los <strong>saldos iniciales</strong> (podés tomarlos de las planillas) y desde esa fecha
          la deuda pasa a ser: saldo inicial + certificados aprobados − cobranzas.
        </div>
      )}
      <div className="kpis">
        <div className="kpi accent"><div className="l">Saldo a cobrar{q ? ' (filtrado)' : ''}</div><div className="v">{money(total)}</div></div>
        <div className="kpi"><div className="l">Clientes con saldo</div><div className="v">{filas.filter((c) => saldoDe(c) > 0.5).length}</div></div>
      </div>

      <div className="filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" />
        {puedeEscribir && <button type="button" onClick={() => setInicial(true)}>Saldos iniciales…</button>}
      </div>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Cliente</th><th className="r">Saldo inicial</th><th className="r">Certificados aprobados</th><th className="r">Cobrado</th><th className="r">Saldo</th><th /></tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.clienteId}>
                <td>{c.nombre}{c.al && <div className="muted" style={{ fontSize: 12 }}>desde {fmtFecha(c.al)}</div>}</td>
                <td className="r">{money(c.saldoInicial)}</td>
                <td className="r">{money(c.facturado)}</td>
                <td className="r">{money(c.cobrado)}</td>
                <td className="r"><strong>{money(saldoDe(c))}</strong></td>
                <td className="r">{puedeEscribir && <button type="button" className="btn sm" onClick={() => setCobrando(c)}>Cobrar</button>}</td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={6} className="muted">Todavía no hay clientes con movimientos. Cargá los saldos iniciales o aprobá certificados.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Últimas cobranzas</h2>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th className="r">Monto</th><th className="r">A certificados</th><th>Nota</th><th /></tr></thead>
          <tbody>
            {cobranzas.map((c) => (
              <tr key={c.id} style={c.anulada ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                <td>{c.numero}</td><td>{fmtFecha(c.fecha)}</td><td>{c.cliente}</td>
                <td className="r">{money(c.monto)}</td>
                <td className="r">{money(c.imputado)}{c.monto - c.imputado > 0.5 && <div className="muted" style={{ fontSize: 12 }}>a cuenta {money(c.monto - c.imputado)}</div>}</td>
                <td className="muted">{c.observaciones ?? ''}</td>
                <td className="r">{puedeEscribir && !c.anulada && <button type="button" className="btn sm danger" disabled={pending} onClick={() => anular(c)}>Anular</button>}{c.anulada && <span className="pill">anulada</span>}</td>
              </tr>
            ))}
            {!cobranzas.length && <tr><td colSpan={7} className="muted">Todavía no se cargó ninguna cobranza.</td></tr>}
          </tbody>
        </table>
      </div>

      {cobrando && <ModalCobranza cuenta={cobrando} certs={certs.filter((c) => c.clienteId === cobrando.clienteId)} hoy={hoy} onCerrar={() => setCobrando(null)} />}
      {inicial && <ModalInicial clientes={clientes} cuentas={cuentas} planillas={planillas} hoy={hoy} onCerrar={() => setInicial(false)} />}
    </>
  );
}

// ───────────── cobrar ─────────────
function ModalCobranza({ cuenta, certs, hoy, onCerrar }: { cuenta: CuentaFila; certs: CertPend[]; hoy: string; onCerrar: () => void }) {
  const ordenados = useMemo(() => [...certs].sort((a, b) => a.emision.localeCompare(b.emision) || a.numero - b.numero), [certs]);
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [nota, setNota] = useState('');
  const [imp, setImp] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Reparte lo cobrado entre los certificados, del más viejo al más nuevo. */
  function repartir(m: number) {
    let resto = m;
    const nuevo: Record<string, string> = {};
    for (const c of ordenados) {
      const x = Math.min(resto, c.pendiente);
      if (x > 0) { nuevo[c.id] = String(redondeo(x)); resto = redondeo(resto - x); }
    }
    setImp(nuevo);
  }
  const m = aNum(monto);
  const imputado = redondeo(ordenados.reduce((a, c) => a + aNum(imp[c.id] ?? ''), 0));
  const aCuenta = redondeo(m - imputado);
  const pasado = ordenados.find((c) => aNum(imp[c.id] ?? '') > c.pendiente + 0.005);
  const mal = imputado > m + 0.005 || !!pasado;

  function guardar() {
    setError(null);
    if (!(m > 0)) return setError('Poné cuánto se cobró.');
    if (imputado > m + 0.005) return setError('Lo imputado a certificados supera lo cobrado.');
    if (pasado) return setError(`Al certificado N° ${certNo(pasado.numero)} solo le faltan cobrar ${money(pasado.pendiente)}.`);
    start(async () => {
      const r = await registrarCobranza({
        clienteId: cuenta.clienteId, fecha, monto: m, observaciones: nota,
        imputaciones: ordenados.filter((c) => aNum(imp[c.id] ?? '') > 0).map((c) => ({ certificadoId: c.id, monto: aNum(imp[c.id]) })),
      });
      if (r.error) setError(r.error); else onCerrar();
    });
  }

  return (
    <Modal titulo={`Cobrar a ${cuenta.nombre}`} onCerrar={onCerrar}>
      <p className="muted" style={{ marginTop: 0 }}>Saldo actual: <strong>{money(saldoDe(cuenta))}</strong>. Cobranza en efectivo: entra sola a la caja del día elegido.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="fld">Monto cobrado
          <input inputMode="decimal" value={monto} autoFocus placeholder="0" onChange={(e) => { setMonto(e.target.value); repartir(aNum(e.target.value)); }} />
        </label>
        <label className="fld">Fecha
          <input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
        </label>
      </div>

      <h3 style={{ marginBottom: 4 }}>Imputar a certificados aprobados</h3>
      {ordenados.length ? (
        <table>
          <thead><tr><th>Certificado</th><th>Emisión</th><th className="r">Falta cobrar</th><th className="r">Imputar</th></tr></thead>
          <tbody>
            {ordenados.map((c) => (
              <tr key={c.id}>
                <td>N° {certNo(c.numero)}</td><td>{fmtFecha(c.emision)}</td><td className="r">{money(c.pendiente)}</td>
                <td className="r"><input inputMode="decimal" style={{ width: 110, textAlign: 'right' }} value={imp[c.id] ?? ''} placeholder="0"
                  onChange={(e) => setImp({ ...imp, [c.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">No hay certificados aprobados con saldo: todo lo cobrado queda a cuenta.</p>}

      <p style={{ margin: '10px 0' }}>
        Imputado <strong>{money(imputado)}</strong> · A cuenta (sin certificado) <strong style={{ color: aCuenta < 0 ? 'var(--bad)' : undefined }}>{money(aCuenta)}</strong>
      </p>
      <label className="fld">Nota (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: lo entregó el encargado de la obra" />
      </label>
      {error && <div className="banner err" style={{ marginTop: 10 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="primary" disabled={pending || mal || !(m > 0)} onClick={guardar}>{pending ? 'Guardando…' : 'Registrar cobranza'}</button>
      </div>
    </Modal>
  );
}

// ───────────── saldos iniciales ─────────────
function ModalInicial({ clientes, cuentas, planillas, hoy, onCerrar }: {
  clientes: { id: string; nombre: string }[]; cuentas: CuentaFila[]; planillas: { cta: SaldoPlanilla[]; diego: SaldoPlanilla[] }; hoy: string; onCerrar: () => void;
}) {
  const alActual = cuentas.find((c) => c.al)?.al ?? hoy;
  const [al, setAl] = useState(alActual);
  const [fuente, setFuente] = useState<'cta' | 'diego' | 'ninguna'>('cta');
  const [montos, setMontos] = useState<Record<string, string>>(() => armar('cta'));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function armar(f: 'cta' | 'diego' | 'ninguna'): Record<string, string> {
    const base: Record<string, string> = {};
    for (const c of cuentas) if (c.al) base[c.clienteId] = String(c.saldoInicial);   // lo ya guardado
    if (f === 'ninguna') return base;
    const porNombre = new Map(clientes.map((c) => [c.nombre.trim().toUpperCase(), c.id]));
    for (const s of planillas[f]) {
      const id = porNombre.get(s.nombre.trim().toUpperCase());
      if (id && Math.abs(s.saldo) > 0.004) base[id] = String(redondeo(s.saldo));
    }
    return base;
  }
  const noEmparejados = fuente === 'ninguna' ? [] : planillas[fuente].filter((s) => Math.abs(s.saldo) > 0.004 && !clientes.some((c) => c.nombre.trim().toUpperCase() === s.nombre.trim().toUpperCase()));
  const visibles = clientes.filter((c) => montos[c.id] !== undefined && montos[c.id] !== '');

  function guardar() {
    setError(null);
    const filas = visibles.map((c) => ({ clienteId: c.id, monto: aNum(montos[c.id]) }));
    start(async () => { const r = await guardarSaldosIniciales(al, filas); if (r.error) setError(r.error); else onCerrar(); });
  }

  return (
    <Modal titulo="Saldos iniciales" onCerrar={onCerrar}>
      <p className="muted" style={{ marginTop: 0 }}>
        Es lo que cada cliente debía a la fecha de arranque. Desde el día siguiente, la deuda suma los certificados aprobados y resta las cobranzas cargadas acá.
        Un saldo positivo es plata que el cliente debe.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="fld">Saldos al (fecha de arranque)
          <input type="date" value={al} max={hoy} onChange={(e) => setAl(e.target.value)} />
        </label>
        <label className="fld">Tomar de la planilla
          <select value={fuente} onChange={(e) => { const f = e.target.value as 'cta' | 'diego' | 'ninguna'; setFuente(f); setMontos(armar(f)); }}>
            <option value="cta">Cta Clientes (Planilla NORMOV)</option>
            <option value="diego">Clientes (NORMOV Diego)</option>
            <option value="ninguna">Ninguna (solo lo ya guardado)</option>
          </select>
        </label>
      </div>
      <table style={{ marginTop: 10 }}>
        <thead><tr><th>Cliente</th><th className="r">Saldo al {fmtFecha(al)}</th></tr></thead>
        <tbody>
          {visibles.map((c) => (
            <tr key={c.id}>
              <td>{c.nombre}</td>
              <td className="r"><input inputMode="decimal" style={{ width: 130, textAlign: 'right' }} value={montos[c.id]} onChange={(e) => setMontos({ ...montos, [c.id]: e.target.value })} /></td>
            </tr>
          ))}
          {!visibles.length && <tr><td colSpan={2} className="muted">Ningún cliente con saldo en esa planilla.</td></tr>}
        </tbody>
      </table>
      {noEmparejados.length > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Sin cliente igual en la app (revisá el nombre, no se cargan): {noEmparejados.slice(0, 8).map((s) => s.nombre).join(', ')}{noEmparejados.length > 8 ? ` y ${noEmparejados.length - 8} más` : ''}.
        </p>
      )}
      {error && <div className="banner err">{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="primary" disabled={pending || !visibles.length} onClick={guardar}>{pending ? 'Guardando…' : `Guardar ${visibles.length} saldos`}</button>
      </div>
    </Modal>
  );
}
