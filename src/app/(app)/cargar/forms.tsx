'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { CatalogoViaje, CatalogoCombustible, CatalogoProveedor, CatalogoCheque } from './datos';
import { guardarViaje, guardarCombustible, guardarProveedor, guardarCheque, type Valores, type EntradaCarga, type Resultado } from './actions';
import { subirAdjunto, descartarAdjunto, type CarpetaAdjunto } from '@/lib/adjuntos';
import { money } from '@/lib/format';

// ───────────── motor de formularios ─────────────
interface Campo {
  k: string; label: string; req?: boolean;
  tipo?: 'text' | 'date' | 'number' | 'select' | 'combo' | 'check';
  ayuda?: string; ancho?: 'full';
  /** En un menú de lista cerrada (select) */
  lista?: string[];
}
type Opciones = (k: string, v: Valores) => string[];
type AlCambiar = (v: Valores, k: string, nuevo: string, tocados: Set<string>) => Valores;

const mayus = (s: string | undefined) => (s ?? '').trim().toUpperCase();
const n = (s: string | undefined) => { const x = Number(String(s ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

function Vista({ archivo }: { archivo: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!archivo || !archivo.type.startsWith('image/')) { setUrl(null); return; }
    const u = URL.createObjectURL(archivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [archivo]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="Vista previa del adjunto" style={{ maxHeight: 120, borderRadius: 6, border: '1px solid var(--line)' }} /> : null;
}

function FormCarga({ carpeta, campos, inicial, mantener, opciones, alCambiar, resumen, guardar, boton }: {
  carpeta: CarpetaAdjunto; campos: Campo[]; inicial: Valores; mantener: string[]; opciones: Opciones; alCambiar?: AlCambiar;
  resumen?: (v: Valores) => React.ReactNode; guardar: (e: EntradaCarga) => Promise<Resultado>; boton: string;
}) {
  const [v, setV] = useState<Valores>(inicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [claveArchivo, setClaveArchivo] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const tocados = useRef<Set<string>>(new Set());

  function cambiar(k: string, nuevo: string) {
    tocados.current.add(k);
    setV((prev) => {
      const sig = { ...prev, [k]: nuevo };
      return alCambiar ? alCambiar(sig, k, nuevo, tocados.current) : sig;
    });
  }

  function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setMsg(null);
    const faltan = campos.filter((c) => c.req && !(v[c.k] ?? '').trim()).map((c) => c.label.toLowerCase());
    if (faltan.length) { setMsg({ ok: false, texto: `Falta completar: ${faltan.join(', ')}.` }); return; }
    start(async () => {
      let ruta: string | null = null;
      try { if (archivo) ruta = await subirAdjunto(archivo, carpeta); }
      catch (x) { setMsg({ ok: false, texto: x instanceof Error ? x.message : 'No se pudo subir el archivo.' }); return; }
      const r = await guardar({ valores: v, fotoPath: ruta });
      if (r.error) {
        if (ruta) await descartarAdjunto(ruta);
        setMsg({ ok: false, texto: r.error });
        return;
      }
      setMsg({ ok: true, texto: r.mensaje ?? 'Guardado.' });
      setV(Object.fromEntries(Object.entries(inicial).map(([k, val]) => [k, mantener.includes(k) ? v[k] ?? val : val])));
      tocados.current = new Set();
      setArchivo(null); setClaveArchivo((c) => c + 1);
    });
  }

  return (
    <form onSubmit={enviar} className="cform-wrap">
      <div className="cform">
        {campos.map((c) => {
          const id = `f-${carpeta}-${c.k}`, val = v[c.k] ?? '';
          if (c.tipo === 'check') {
            return (
              <label key={c.k} className="campo check row" style={{ gap: 8 }}>
                <input type="checkbox" checked={val === '1'} onChange={(e) => cambiar(c.k, e.target.checked ? '1' : '')} style={{ minHeight: 'auto' }} /> {c.label}
              </label>
            );
          }
          const ops = c.tipo === 'combo' ? opciones(c.k, v) : [];
          const esNuevo = c.tipo === 'combo' && val.trim() !== '' && ops.length > 0 && !ops.some((o) => o.toUpperCase() === val.trim().toUpperCase());
          return (
            <div key={c.k} className={`campo${c.ancho ? ' full' : ''}`}>
              <label htmlFor={id}>{c.label}{c.req && <span className="req"> *</span>}</label>
              {c.tipo === 'select' ? (
                <select id={id} value={val} onChange={(e) => cambiar(c.k, e.target.value)}>
                  <option value="">— elegir —</option>
                  {(c.lista ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <>
                  <input id={id} type={c.tipo === 'date' ? 'date' : c.tipo === 'number' ? 'number' : 'text'} value={val}
                    step={c.tipo === 'number' ? 'any' : undefined} min={c.tipo === 'number' ? 0 : undefined} inputMode={c.tipo === 'number' ? 'decimal' : undefined}
                    list={c.tipo === 'combo' ? `dl-${carpeta}-${c.k}` : undefined} autoComplete="off"
                    placeholder={c.tipo === 'combo' ? 'Elegí de la lista o escribí uno nuevo' : undefined}
                    onChange={(e) => cambiar(c.k, e.target.value)} />
                  {c.tipo === 'combo' && <datalist id={`dl-${carpeta}-${c.k}`}>{ops.slice(0, 2000).map((o) => <option key={o} value={o} />)}</datalist>}
                </>
              )}
              {esNuevo && <span className="ayuda" style={{ color: 'var(--warn)' }}>No está en la lista: se va a agregar como nuevo.</span>}
              {c.ayuda && <span className="ayuda">{c.ayuda}</span>}
            </div>
          );
        })}

        <div className="campo full">
          <label htmlFor={`f-${carpeta}-adjunto`}>Adjuntar foto o comprobante <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(opcional, queda enlazado a este registro)</span></label>
          <input key={claveArchivo} id={`f-${carpeta}-adjunto`} type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          {archivo && <span className="ayuda">{archivo.name} · {Math.round(archivo.size / 1024)} KB{archivo.type.startsWith('image/') ? ' · se achica antes de subir' : ''}</span>}
          <Vista archivo={archivo} />
        </div>
      </div>

      {resumen && <div className="cresumen">{resumen(v)}</div>}
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.texto}</div>}
      <div className="row"><button type="submit" className="primary" disabled={pending}>{pending ? 'Guardando…' : boton}</button></div>
    </form>
  );
}

// ───────────── viaje ─────────────
export function FormViaje({ catalogo: cat, hoy }: { catalogo: CatalogoViaje; hoy: string }) {
  const inicial: Valores = { fecha: hoy, remito: '', razon: '', cliente: '', material: '', cantidad: '', precio: '', cantera: '', camion: '', chofer: '', costoUnit: '', iva: '' };
  const campos: Campo[] = [
    { k: 'fecha', label: 'Fecha', tipo: 'date', req: true },
    { k: 'remito', label: 'N° remito', tipo: 'text', ayuda: 'Dejalo vacío si el viaje no tiene remito: se guarda igual, como "(sin número)".' },
    { k: 'razon', label: 'Razón social', tipo: 'combo' },
    { k: 'cliente', label: 'Cliente / obra', tipo: 'combo', req: true },
    { k: 'material', label: 'Material', tipo: 'combo', req: true },
    { k: 'cantidad', label: 'Cantidad (m³, t u horas)', tipo: 'number', req: true },
    { k: 'precio', label: 'Precio de venta unitario', tipo: 'number', req: true },
    { k: 'cantera', label: 'Cantera', tipo: 'combo', req: true },
    { k: 'camion', label: 'Camión', tipo: 'combo', req: true },
    { k: 'chofer', label: 'Chofer', tipo: 'combo', req: true },
    { k: 'costoUnit', label: 'Costo del material (unitario)', tipo: 'number' },
    { k: 'iva', label: 'Sumar IVA 21% al total', tipo: 'check' },
  ];
  const lookup = (v: Valores) => {
    const m = mayus(v.material);
    if (!m) return null;
    return cat.precios[`${mayus(v.cliente)}|${m}`] ?? cat.precios[`${mayus(v.razon)}|${m}`] ?? null;
  };
  const opciones: Opciones = (k, v) => {
    if (k === 'razon') return cat.razones;
    if (k === 'material') return cat.materiales.map((m) => m.nombre);
    if (k === 'cantera') return cat.canteras;
    if (k === 'camion') return cat.camiones;
    if (k === 'chofer') return cat.choferes;
    if (k === 'cliente') {
      const r = mayus(v.razon);
      const de = r ? cat.obras.filter((o) => o.razon.toUpperCase() === r) : cat.obras;
      return [...new Set(de.map((o) => o.nombre))];
    }
    return [];
  };
  const alCambiar: AlCambiar = (v, k, nuevo, tocados) => {
    const sig = { ...v };
    // Elegir una obra completa sola la razón social
    if (k === 'cliente' && !sig.razon.trim()) {
      const o = cat.obras.find((x) => x.nombre.toUpperCase() === nuevo.trim().toUpperCase());
      if (o?.razon) sig.razon = o.razon;
    }
    // Al elegir cliente y material, sugerir el último precio y costo usados (si todavía no se tocaron)
    if (k === 'cliente' || k === 'razon' || k === 'material') {
      const hit = lookup(sig);
      if (hit) {
        if (!tocados.has('precio')) sig.precio = String(hit.precio);
        if (!tocados.has('costoUnit') && hit.costoUnit > 0) sig.costoUnit = String(hit.costoUnit);
      }
    }
    return sig;
  };
  const resumen = (v: Valores) => {
    const neto = Math.round(n(v.cantidad) * n(v.precio) * 100) / 100;
    const total = v.iva === '1' ? Math.round(neto * 1.21 * 100) / 100 : neto;
    const costo = Math.round(n(v.costoUnit) * n(v.cantidad) * 100) / 100;
    const hit = lookup(v);
    return (
      <>
        <span>Neto <strong>{money(neto)}</strong></span> · <span>Total <strong>{money(total)}</strong></span>
        {costo > 0 && <> · <span>Costo material <strong>{money(costo)}</strong></span> · <span>Margen <strong>{money(neto - costo)}</strong></span></>}
        {hit && <div className="muted" style={{ fontSize: 12.5 }}>Último precio usado para este cliente y material: {money(hit.precio)}{hit.costoUnit > 0 ? ` · costo ${money(hit.costoUnit)}` : ''}</div>}
      </>
    );
  };
  return <FormCarga carpeta="viajes" campos={campos} inicial={inicial} mantener={['fecha']} opciones={opciones} alCambiar={alCambiar} resumen={resumen} guardar={guardarViaje} boton="Guardar viaje" />;
}

// ───────────── combustible ─────────────
export function FormCombustible({ catalogo: cat, hoy }: { catalogo: CatalogoCombustible; hoy: string }) {
  const inicial: Valores = { fecha: hoy, remito: '', patente: '', litros: '', tipo: '', precioLitro: '', estacion: '', chofer: '' };
  const campos: Campo[] = [
    { k: 'fecha', label: 'Fecha', tipo: 'date', req: true },
    { k: 'remito', label: 'N° remito', tipo: 'text' },
    { k: 'patente', label: 'Patente o equipo', tipo: 'combo', req: true },
    { k: 'litros', label: 'Litros', tipo: 'number', req: true },
    { k: 'tipo', label: 'Tipo de combustible', tipo: 'combo' },
    { k: 'precioLitro', label: 'Precio por litro (opcional)', tipo: 'number' },
    { k: 'estacion', label: 'Estación', tipo: 'combo' },
    { k: 'chofer', label: 'Chofer', tipo: 'combo' },
  ];
  const opciones: Opciones = (k) => (k === 'patente' ? cat.patentes : k === 'tipo' ? cat.tipos : k === 'estacion' ? cat.estaciones : k === 'chofer' ? cat.choferes : []);
  const resumen = (v: Valores) => (n(v.litros) > 0 && n(v.precioLitro) > 0 ? <span>Neto <strong>{money(n(v.litros) * n(v.precioLitro))}</strong></span> : null);
  return <FormCarga carpeta="combustible" campos={campos} inicial={inicial} mantener={['fecha', 'estacion', 'tipo']} opciones={opciones} resumen={resumen} guardar={guardarCombustible} boton="Guardar carga" />;
}

// ───────────── proveedor ─────────────
const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Cheque', 'E-cheq', 'Especie', 'Endoso de cheque de tercero'];
export function FormProveedor({ catalogo: cat, hoy }: { catalogo: CatalogoProveedor; hoy: string }) {
  const inicial: Valores = { fecha: hoy, proveedor: '', unidad: '', centro: '', rubro: '', subrubro: '', detalle: '', factura: '', debe: '', haber: '', forma: '', cheque: '', fechaPago: '', obs: '' };
  const campos: Campo[] = [
    { k: 'fecha', label: 'Fecha', tipo: 'date', req: true },
    { k: 'proveedor', label: 'Proveedor', tipo: 'combo', req: true },
    { k: 'unidad', label: 'Unidad de negocio', tipo: 'combo' },
    { k: 'centro', label: 'Centro de soporte', tipo: 'combo' },
    { k: 'rubro', label: 'Rubro', tipo: 'combo' },
    { k: 'subrubro', label: 'Sub-rubro', tipo: 'combo' },
    { k: 'detalle', label: 'Detalle', tipo: 'text', ancho: 'full' },
    { k: 'factura', label: 'N° factura', tipo: 'text' },
    { k: 'debe', label: 'Debe (compra o gasto)', tipo: 'number', ayuda: 'Lo que le debemos por esta factura o gasto.' },
    { k: 'haber', label: 'Haber (pagado)', tipo: 'number', ayuda: 'Lo que se le pagó. Cargá uno u otro, no los dos.' },
    { k: 'forma', label: 'Forma de pago', tipo: 'select', lista: [...FORMAS_PAGO, ...cat.formas.filter((f) => !FORMAS_PAGO.includes(f))] },
    { k: 'cheque', label: 'N° de cheque', tipo: 'text' },
    { k: 'fechaPago', label: 'Fecha de pago', tipo: 'date', ayuda: 'El día que la plata sale de verdad (o va a salir): sirve para el cash flow.' },
    { k: 'obs', label: 'Observaciones', tipo: 'text', ancho: 'full' },
  ];
  const opciones: Opciones = (k, v) => {
    if (k === 'proveedor') return cat.proveedores;
    if (k === 'unidad') return cat.unidades;
    if (k === 'centro') return cat.centros;
    if (k === 'rubro') return cat.rubros;
    if (k === 'subrubro') return (v.rubro && cat.subrubrosPorRubro[v.rubro]) || cat.subrubros;
    return [];
  };
  return <FormCarga carpeta="proveedores" campos={campos} inicial={inicial} mantener={['fecha']} opciones={opciones} guardar={guardarProveedor} boton="Guardar movimiento" />;
}

// ───────────── cheque ─────────────
const ESTADOS_CHEQUE = ['Emitido', 'En Cartera', 'Endosado', 'Debitado', 'Depositado', 'Cobrado', 'Rechazado'];
export function FormCheque({ catalogo: cat, hoy }: { catalogo: CatalogoCheque; hoy: string }) {
  const inicial: Valores = { fecha: hoy, tipoCheque: '', contraparte: '', nro: '', banco: '', librador: '', cuit: '', monto: '', vto: '', estadoCheque: '', endosado: '', obs: '' };
  const campos: Campo[] = [
    { k: 'fecha', label: 'Fecha de emisión', tipo: 'date', req: true },
    { k: 'tipoCheque', label: 'Tipo (Propio o Tercero)', tipo: 'select', req: true, lista: ['Propio', 'Tercero'] },
    { k: 'contraparte', label: 'Cliente o proveedor', tipo: 'combo' },
    { k: 'nro', label: 'N° cheque', tipo: 'text', req: true },
    { k: 'banco', label: 'Banco', tipo: 'combo' },
    { k: 'librador', label: 'Librador / emisor', tipo: 'combo' },
    { k: 'cuit', label: 'CUIT', tipo: 'text' },
    { k: 'monto', label: 'Monto', tipo: 'number', req: true },
    { k: 'vto', label: 'Fecha de vencimiento', tipo: 'date', req: true },
    { k: 'estadoCheque', label: 'Estado', tipo: 'select', req: true, lista: ESTADOS_CHEQUE },
    { k: 'endosado', label: 'Endosado a', tipo: 'combo' },
    { k: 'obs', label: 'Observaciones', tipo: 'text', ancho: 'full' },
  ];
  const opciones: Opciones = (k) => (k === 'banco' ? cat.bancos : k === 'librador' ? cat.libradores : k === 'contraparte' || k === 'endosado' ? cat.contrapartes : []);
  const alCambiar: AlCambiar = (v, k, nuevo, tocados) => {
    // Un cheque propio nace "Emitido"; uno de tercero, "En Cartera" (si todavía no se eligió otro estado)
    if (k === 'tipoCheque' && !tocados.has('estadoCheque')) return { ...v, estadoCheque: /^prop/i.test(nuevo) ? 'Emitido' : /^terc/i.test(nuevo) ? 'En Cartera' : v.estadoCheque };
    return v;
  };
  return <FormCarga carpeta="cheques" campos={campos} inicial={inicial} mantener={['fecha']} opciones={opciones} alCambiar={alCambiar} guardar={guardarCheque} boton="Guardar cheque" />;
}
