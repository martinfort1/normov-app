'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAcceso, type Acceso } from '@/lib/permisos';
import { resolverMaestros, idsMaestros } from '@/lib/sheets/importar';
import { sha, partesMov, partesCheque, partesCarga, partesSinRemito, siguienteLibre, siguienteLibreSR } from '@/lib/sheets/claves';
import { clean, up, remitoKey, unitOf, isTruck } from '@/lib/sheets/parsers';

export type Valores = Record<string, string>;
export interface EntradaCarga { valores: Valores; fotoPath: string | null }
export type Resultado = { error: string | null; mensaje?: string };

const err = (error: string): Resultado => ({ error });
const redondear = (n: number) => Math.round(n * 100) / 100;
const numero = (s: string | undefined) => { const n = Number(String(s ?? '').trim().replace(',', '.')); return s?.trim() && Number.isFinite(n) ? n : NaN; };
const fechaOk = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const msgDb = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Falta correr la migración 0006_cargar.sql en Supabase.' : m);
const CARPETAS = ['viajes', 'combustible', 'proveedores', 'cheques'] as const;
type Carpeta = (typeof CARPETAS)[number];
const pathOk = (p: string | null, carpeta: Carpeta) => p === null || (p.startsWith(carpeta + '/') && !p.includes('..') && /^[\w./-]+$/.test(p));

async function exigir(modulo: Carpeta): Promise<{ a: Acceso } | { error: Resultado }> {
  const a = await getAcceso();
  if (!a?.puedeEscribir(modulo)) return { error: err('No tenés permiso para cargar en esta sección.') };
  return { a };
}
function refrescar() { revalidatePath('/cargar'); revalidatePath('/operaciones'); revalidatePath('/combustible'); revalidatePath('/cheques'); revalidatePath('/proveedores'); }

// ───────────── viaje ─────────────
export async function guardarViaje(e: EntradaCarga): Promise<Resultado> {
  const p = await exigir('viajes'); if ('error' in p) return p.error;
  if (!pathOk(e.fotoPath, 'viajes')) return err('Adjunto inválido.');
  const v = e.valores;
  const fecha = v.fecha;
  const cliente = up(v.cliente), razon = up(v.razon) || cliente, material = up(v.material);
  const cantera = up(v.cantera), camion = up(v.camion), chofer = up(v.chofer);
  const cantidad = numero(v.cantidad), precio = numero(v.precio);
  const costoUnit = v.costoUnit?.trim() ? numero(v.costoUnit) : 0;
  const faltan = [
    !fechaOk(fecha) && 'la fecha', !cliente && 'el cliente / obra', !material && 'el material', !cantera && 'la cantera',
    !camion && 'el camión', !chofer && 'el chofer', !(cantidad > 0) && 'la cantidad', !(precio >= 0) && 'el precio',
  ].filter(Boolean);
  if (faltan.length) return err(`Falta completar: ${faltan.join(', ')}.`);
  if (Number.isNaN(costoUnit) || costoUnit < 0) return err('El costo del material no es válido.');

  const unidad = unitOf(material);
  const neto = redondear(cantidad * precio);
  const total = v.iva === '1' ? redondear(neto * 1.21) : neto;
  const costo = costoUnit > 0 ? redondear(costoUnit * cantidad) : 0;

  const supabase = await createClient();
  let numeroFinal = remitoKey(v.remito);
  if (!numeroFinal) {
    // Sin remito: misma clave que arma el sync para los viajes sin número, así no se duplica si también está en la planilla.
    const base12 = sha(partesSinRemito({ fecha, cliente, razon, material, cantidad, precio, camion, chofer, cantera })).slice(0, 12);
    const { data } = await supabase.from('remitos').select('numero').eq('fecha', fecha).like('numero', `SR-${base12}%`);
    numeroFinal = siguienteLibreSR(base12, (data ?? []).map((r) => r.numero as string));
  }
  try {
    const maestros = await resolverMaestros(supabase, [{ razon, cliente, material, unidad }]);
    const { error } = await supabase.from('remitos').insert({
      numero: numeroFinal, fecha, ...idsMaestros(maestros, { razon, cliente, material }), camion, chofer, cantera,
      cantidad, precio, total, neto, costo, origen: 'manual', foto_path: e.fotoPath, creado_por: p.a.userId, autor: p.a.nombre,
    });
    if (error) {
      if (error.code === '23505') return err(`Ya hay un viaje con el remito ${numeroFinal} en esa fecha. Si es un segundo viaje con el mismo remito, avisalo: hoy la base no admite dos viajes con el mismo número y fecha.`);
      return err(msgDb(error.message));
    }
  } catch (x) {
    return err(msgDb(x instanceof Error ? x.message : 'No se pudo guardar.'));
  }
  refrescar();
  return { error: null, mensaje: `Viaje cargado${numeroFinal.startsWith('SR-') ? ' (sin número de remito)' : ` · remito ${numeroFinal}`}.` };
}

// ───────────── combustible ─────────────
export async function guardarCombustible(e: EntradaCarga): Promise<Resultado> {
  const p = await exigir('combustible'); if ('error' in p) return p.error;
  if (!pathOk(e.fotoPath, 'combustible')) return err('Adjunto inválido.');
  const v = e.valores;
  const fecha = v.fecha, remito = clean(v.remito), patente = up(v.patente), litros = numero(v.litros);
  const tipo = up(v.tipo) || '—', estacion = up(v.estacion) || '—', chofer = up(v.chofer) || '—';
  const precioLitro = v.precioLitro?.trim() ? numero(v.precioLitro) : null;
  const faltan = [!fechaOk(fecha) && 'la fecha', !patente && 'la patente o equipo', !(litros > 0) && 'los litros'].filter(Boolean);
  if (faltan.length) return err(`Falta completar: ${faltan.join(', ')}.`);
  if (precioLitro !== null && !(precioLitro >= 0)) return err('El precio por litro no es válido.');

  const supabase = await createClient();
  const base = sha(partesCarga({ fecha, remito, patente, litros, tipo, estacion }));
  const { data } = await supabase.from('cargas_combustible').select('source_hash').like('source_hash', `${base}:%`);
  const { error } = await supabase.from('cargas_combustible').insert({
    fecha, remito: remito || null, patente, es_camion: isTruck(patente), litros, tipo, estacion, chofer, precio_litro: precioLitro,
    source_hash: siguienteLibre(base, (data ?? []).map((r) => r.source_hash as string)),
    foto_path: e.fotoPath, origen: 'app', creado_por: p.a.userId, autor: p.a.nombre,
  });
  if (error) return err(msgDb(error.message));
  refrescar();
  return { error: null, mensaje: `Carga cargada: ${patente}, ${litros} litros.` };
}

// ───────────── proveedor ─────────────
export async function guardarProveedor(e: EntradaCarga): Promise<Resultado> {
  const p = await exigir('proveedores'); if ('error' in p) return p.error;
  if (!pathOk(e.fotoPath, 'proveedores')) return err('Adjunto inválido.');
  const v = e.valores;
  const fecha = v.fecha, proveedor = clean(v.proveedor);
  const debe = v.debe?.trim() ? numero(v.debe) : 0, haber = v.haber?.trim() ? numero(v.haber) : 0;
  const detalle = clean(v.detalle), factura = clean(v.factura), forma = clean(v.forma), cheque = clean(v.cheque);
  const fechaPago = v.fechaPago?.trim() ? v.fechaPago : null;
  const faltan = [!fechaOk(fecha) && 'la fecha', !proveedor && 'el proveedor'].filter(Boolean);
  if (faltan.length) return err(`Falta completar: ${faltan.join(', ')}.`);
  if (Number.isNaN(debe) || Number.isNaN(haber) || debe < 0 || haber < 0) return err('Los importes no son válidos.');
  if (!(debe > 0) && !(haber > 0)) return err('Poné un importe en Debe (compra o gasto) o en Haber (pagado).');
  if (fechaPago && !fechaOk(fechaPago)) return err('La fecha de pago no es válida.');

  const supabase = await createClient();
  const prov = await supabase.from('proveedores').upsert({ nombre: proveedor }, { onConflict: 'nombre' }).select('id').single();
  if (prov.error || !prov.data) return err(msgDb(prov.error?.message ?? 'No se pudo guardar el proveedor.'));
  const base = sha(partesMov({ fecha, proveedor, detalle, factura, debe, haber, forma, cheque }));
  const { data } = await supabase.from('movimientos_proveedor').select('source_hash').like('source_hash', `${base}:%`);
  const { error } = await supabase.from('movimientos_proveedor').insert({
    proveedor_id: prov.data.id, fecha, centro_costo: clean(v.centro) || null, unidad_negocio: clean(v.unidad) || null,
    rubro: clean(v.rubro) || null, subrubro: clean(v.subrubro) || null, detalle: detalle || null, nro_factura: factura || null,
    debe, haber, forma_pago: forma || null, nro_cheque: cheque || null, observaciones: clean(v.obs) || null, fecha_pago: fechaPago,
    source_hash: siguienteLibre(base, (data ?? []).map((r) => r.source_hash as string)),
    foto_path: e.fotoPath, origen: 'app', creado_por: p.a.userId, autor: p.a.nombre,
  });
  if (error) return err(msgDb(error.message));
  refrescar();
  return { error: null, mensaje: `Movimiento cargado: ${proveedor}.` };
}

// ───────────── cheque ─────────────
const ESTADOS_CHEQUE = ['Emitido', 'En Cartera', 'Endosado', 'Debitado', 'Depositado', 'Cobrado', 'Rechazado'];
export async function guardarCheque(e: EntradaCarga): Promise<Resultado> {
  const p = await exigir('cheques'); if ('error' in p) return p.error;
  if (!pathOk(e.fotoPath, 'cheques')) return err('Adjunto inválido.');
  const v = e.valores;
  const tipo = /^terc/i.test(clean(v.tipoCheque)) ? 'Tercero' : /^prop/i.test(clean(v.tipoCheque)) ? 'Propio' : '';
  const emision = v.fecha, vto = v.vto, numeroChq = clean(v.nro), monto = numero(v.monto);
  const estado = ESTADOS_CHEQUE.find((s) => s.toUpperCase() === up(v.estadoCheque));
  const faltan = [
    !fechaOk(emision) && 'la fecha de emisión', !tipo && 'el tipo (Propio o Tercero)', !numeroChq && 'el N° de cheque',
    !(monto > 0) && 'el monto', !fechaOk(vto) && 'el vencimiento', !estado && `el estado (${ESTADOS_CHEQUE.join(', ')})`,
  ].filter(Boolean);
  if (faltan.length) return err(`Falta completar: ${faltan.join(', ')}.`);

  const contraparte = clean(v.contraparte).replace(/^-$/, ''), banco = clean(v.banco);
  const supabase = await createClient();
  const base = sha(partesCheque({ tipo, numero: numeroChq, banco, monto, vto, contraparte }));
  const { data } = await supabase.from('cheques').select('source_hash').like('source_hash', `${base}:%`);
  const { error } = await supabase.from('cheques').insert({
    tipo, contraparte: contraparte || null, numero: numeroChq, banco: banco || null, librador: clean(v.librador) || null,
    cuit: clean(v.cuit) || null, monto, emision, vencimiento: vto, estado, endosado_a: clean(v.endosado) || null,
    observaciones: clean(v.obs) || null, source_hash: siguienteLibre(base, (data ?? []).map((r) => r.source_hash as string)),
    foto_path: e.fotoPath, origen: 'app', creado_por: p.a.userId, autor: p.a.nombre,
  });
  if (error) return err(msgDb(error.message));
  refrescar();
  return { error: null, mensaje: `Cheque N° ${numeroChq} cargado.` };
}

// ───────────── anular y ver adjuntos ─────────────
const TABLAS: Record<string, { tabla: string; modulo: Carpeta }> = {
  viaje: { tabla: 'remitos', modulo: 'viajes' },
  combustible: { tabla: 'cargas_combustible', modulo: 'combustible' },
  proveedor: { tabla: 'movimientos_proveedor', modulo: 'proveedores' },
  cheque: { tabla: 'cheques', modulo: 'cheques' },
};

/** Borra una carga hecha desde la app (las que vienen de la planilla se corrigen en la planilla). */
export async function anularCarga(tipo: string, id: string): Promise<Resultado> {
  const t = TABLAS[tipo];
  if (!t || !/^[0-9a-f-]{36}$/i.test(id)) return err('Carga inválida.');
  const p = await exigir(t.modulo); if ('error' in p) return p.error;
  const supabase = await createClient();
  const { data: fila, error: e1 } = await supabase.from(t.tabla).select('id, origen, foto_path').eq('id', id).maybeSingle();
  if (e1) return err(msgDb(e1.message));
  if (!fila) return err('No se encontró la carga.');
  const deLaApp = tipo === 'viaje' ? fila.origen === 'manual' : fila.origen === 'app';
  if (!deLaApp) return err('Solo se pueden anular acá las cargas hechas desde la app. Esta viene de la planilla: se corrige ahí.');
  const { data, error } = await supabase.from(t.tabla).delete().eq('id', id).select('id');
  if (error) {
    return err(error.code === '23503' ? 'No se puede anular: el viaje ya está en un certificado. Anulá primero ese certificado.' : msgDb(error.message));
  }
  if (!data?.length) return err('No se pudo anular (¿ya estaba anulada o no tenés permiso?).');
  if (fila.foto_path) await supabase.storage.from('adjuntos').remove([fila.foto_path as string]);
  refrescar();
  return { error: null, mensaje: 'Carga anulada.' };
}

/** Link temporal (2 minutos) para ver un adjunto. Solo funciona si el usuario puede ver esa sección. */
export async function urlAdjunto(path: string): Promise<{ url: string | null; error: string | null }> {
  if (!/^(viajes|combustible|proveedores|cheques)\/[\w./-]+$/.test(path) || path.includes('..')) return { url: null, error: 'Adjunto inválido.' };
  const a = await getAcceso();
  if (!a) return { url: null, error: 'Sin sesión.' };
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from('adjuntos').createSignedUrl(path, 120);
  if (error || !data) return { url: null, error: 'No se pudo abrir el adjunto (¿tenés acceso a esa sección?).' };
  return { url: data.signedUrl, error: null };
}
