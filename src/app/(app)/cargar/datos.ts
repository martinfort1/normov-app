/* Datos que necesita la pantalla Cargar: opciones de los menús desplegables (salen de lo ya cargado, ordenadas
   de más a menos usadas) y el historial de lo cargado desde la app. Solo servidor. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/fetch-all';
import { addDays, hoyAR } from '@/lib/periodo';
import { fecha as fmtFecha, money, num2, remito as fmtRemito } from '@/lib/format';

/** Valores distintos, de más a menos usados. */
function frecuentes(xs: (string | null | undefined)[]): string[] {
  const m = new Map<string, number>();
  for (const x of xs) {
    const v = (x ?? '').trim();
    if (v && v !== '—' && v !== '(sin dato)') m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
}
const desdeReciente = () => addDays(hoyAR(), -548); // ~18 meses

// ───────────── viaje ─────────────
export interface CatalogoViaje {
  razones: string[];
  obras: { nombre: string; razon: string }[];
  materiales: { nombre: string; unidad: string }[];
  canteras: string[]; camiones: string[]; choferes: string[];
  /** Último precio y costo unitario usados, por "obra|material" y por "razón|material" */
  precios: Record<string, { precio: number; costoUnit: number }>;
}
interface RemitoCat {
  cantera: string | null; camion: string | null; chofer: string | null; precio: number; costo: number; cantidad: number;
  clientes: { razon_social: string } | null; obras: { nombre: string } | null; materiales: { nombre: string } | null;
}
export async function catalogoViaje(db: SupabaseClient): Promise<CatalogoViaje> {
  const [clientes, obras, materiales, remitos] = await Promise.all([
    db.from('clientes').select('razon_social').eq('activo', true).order('razon_social').limit(3000),
    db.from('obras').select('nombre, clientes(razon_social)').order('nombre').limit(8000),
    db.from('materiales').select('nombre, unidad').order('nombre').limit(500),
    fetchAll<RemitoCat>((from, to) =>
      db.from('remitos').select('cantera,camion,chofer,precio,costo,cantidad,clientes(razon_social),obras(nombre),materiales(nombre)')
        .gte('fecha', desdeReciente()).order('fecha', { ascending: false }).order('id').range(from, to),
    ).catch(() => [] as RemitoCat[]),
  ]);
  const precios: CatalogoViaje['precios'] = {};
  for (const r of remitos) {
    const mat = r.materiales?.nombre;
    if (!mat || !(r.precio > 0)) continue;
    const dato = { precio: r.precio, costoUnit: r.costo > 0 && r.cantidad > 0 ? Math.round((r.costo / r.cantidad) * 100) / 100 : 0 };
    for (const k of [r.obras?.nombre && `${r.obras.nombre}|${mat}`, r.clientes?.razon_social && `${r.clientes.razon_social}|${mat}`]) {
      if (k && !(k in precios)) precios[k] = dato; // el primero (más reciente) gana
    }
  }
  return {
    razones: (clientes.data ?? []).map((c) => c.razon_social as string),
    obras: ((obras.data ?? []) as unknown as { nombre: string; clientes: { razon_social: string } | null }[]).map((o) => ({ nombre: o.nombre, razon: o.clientes?.razon_social ?? '' })),
    materiales: (materiales.data ?? []).map((m) => ({ nombre: m.nombre as string, unidad: m.unidad as string })),
    canteras: frecuentes(remitos.map((r) => r.cantera)), camiones: frecuentes(remitos.map((r) => r.camion)), choferes: frecuentes(remitos.map((r) => r.chofer)),
    precios,
  };
}

// ───────────── combustible ─────────────
export interface CatalogoCombustible { patentes: string[]; tipos: string[]; estaciones: string[]; choferes: string[] }
export async function catalogoCombustible(db: SupabaseClient): Promise<CatalogoCombustible> {
  const filas = await fetchAll<{ patente: string; tipo: string | null; estacion: string | null; chofer: string | null }>((from, to) =>
    db.from('cargas_combustible').select('patente,tipo,estacion,chofer').gte('fecha', desdeReciente()).order('id').range(from, to),
  ).catch(() => []);
  return {
    patentes: frecuentes(filas.map((f) => f.patente)), tipos: frecuentes(filas.map((f) => f.tipo)),
    estaciones: frecuentes(filas.map((f) => f.estacion)), choferes: frecuentes(filas.map((f) => f.chofer)),
  };
}

// ───────────── proveedor ─────────────
export interface CatalogoProveedor {
  proveedores: string[]; centros: string[]; unidades: string[]; rubros: string[]; formas: string[];
  /** Sub-rubros observados para cada rubro, y todos juntos */
  subrubrosPorRubro: Record<string, string[]>; subrubros: string[];
}
export async function catalogoProveedor(db: SupabaseClient): Promise<CatalogoProveedor> {
  const [provs, movs] = await Promise.all([
    db.from('proveedores').select('nombre').order('nombre').limit(5000),
    fetchAll<{ centro_costo: string | null; unidad_negocio: string | null; rubro: string | null; subrubro: string | null; forma_pago: string | null }>((from, to) =>
      db.from('movimientos_proveedor').select('centro_costo,unidad_negocio,rubro,subrubro,forma_pago').order('id').range(from, to),
    ).catch(() => []),
  ]);
  const porRubro: Record<string, string[]> = {};
  for (const r of [...new Set(movs.map((m) => m.rubro).filter((x): x is string => !!x))]) {
    porRubro[r] = frecuentes(movs.filter((m) => m.rubro === r).map((m) => m.subrubro));
  }
  return {
    proveedores: (provs.data ?? []).map((p) => p.nombre as string), centros: frecuentes(movs.map((m) => m.centro_costo)),
    unidades: [...new Set(['Áridos - Mayorista', 'Áridos - Minorista', 'Ingenio (Servicio Industrial)', 'Obras y Movimiento de Suelo', ...frecuentes(movs.map((m) => m.unidad_negocio))])],
    rubros: frecuentes(movs.map((m) => m.rubro)), formas: frecuentes(movs.map((m) => m.forma_pago)),
    subrubrosPorRubro: porRubro, subrubros: frecuentes(movs.map((m) => m.subrubro)),
  };
}

// ───────────── cheque ─────────────
export interface CatalogoCheque { bancos: string[]; contrapartes: string[]; libradores: string[] }
export async function catalogoCheque(db: SupabaseClient): Promise<CatalogoCheque> {
  const [chq, provs] = await Promise.all([
    fetchAll<{ banco: string | null; contraparte: string | null; librador: string | null; endosado_a: string | null }>((from, to) =>
      db.from('cheques').select('banco,contraparte,librador,endosado_a').order('id').range(from, to),
    ).catch(() => []),
    db.from('proveedores').select('nombre').limit(5000),
  ]);
  return {
    bancos: frecuentes(chq.map((c) => c.banco)),
    contrapartes: frecuentes([...chq.map((c) => c.contraparte), ...chq.map((c) => c.endosado_a), ...(provs.data ?? []).map((p) => p.nombre as string)]),
    libradores: frecuentes(chq.map((c) => c.librador)),
  };
}

// ───────────── historial de lo cargado desde la app ─────────────
export interface ItemHistorial { id: string; titulo: string; detalle: string; cuando: string; autor: string | null; fotoPath: string | null }
const cuando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Tucuman', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

type Fila = Record<string, unknown>;
export async function historial(db: SupabaseClient, tipo: 'viaje' | 'combustible' | 'proveedor' | 'cheque'): Promise<ItemHistorial[]> {
  const N = 15;
  if (tipo === 'viaje') {
    const columnas = (conId: boolean): string => `id,${conId ? 'id_viaje,' : ''}numero,fecha,cantidad,total,autor,creado,foto_path,clientes(razon_social),obras(nombre),materiales(nombre)`;
    const pedir = (conId: boolean) => db.from('remitos').select(columnas(conId)).eq('origen', 'manual').order('creado', { ascending: false }).limit(N);
    let { data, error } = await pedir(true);
    if (error && /id_viaje/.test(error.message)) ({ data, error } = await pedir(false)); // antes de la migración 0007
    void error;
    return ((data ?? []) as unknown as (Fila & { clientes: { razon_social: string } | null; obras: { nombre: string } | null; materiales: { nombre: string } | null })[]).map((r) => ({
      id: r.id as string, titulo: `${fmtFecha(r.fecha as string)} · remito ${fmtRemito(r.numero as string)}${r.id_viaje ? ` · ID ${r.id_viaje}` : ''}`,
      detalle: `${r.obras?.nombre ?? r.clientes?.razon_social ?? '—'} · ${r.materiales?.nombre ?? '—'} · ${num2(r.cantidad as number)} · ${money(r.total as number)}`,
      cuando: cuando(r.creado as string), autor: (r.autor as string) ?? null, fotoPath: (r.foto_path as string) ?? null,
    }));
  }
  if (tipo === 'combustible') {
    const { data } = await db.from('cargas_combustible').select('id,fecha,patente,litros,estacion,autor,creado,foto_path').eq('origen', 'app').order('creado', { ascending: false }).limit(N);
    return ((data ?? []) as Fila[]).map((r) => ({
      id: r.id as string, titulo: `${fmtFecha(r.fecha as string)} · ${r.patente}`, detalle: `${num2(r.litros as number)} litros · ${r.estacion ?? '—'}`,
      cuando: cuando(r.creado as string), autor: (r.autor as string) ?? null, fotoPath: (r.foto_path as string) ?? null,
    }));
  }
  if (tipo === 'proveedor') {
    const { data } = await db.from('movimientos_proveedor').select('id,fecha,debe,haber,detalle,autor,creado,foto_path,proveedores(nombre)').eq('origen', 'app').order('creado', { ascending: false }).limit(N);
    return ((data ?? []) as unknown as (Fila & { proveedores: { nombre: string } | null })[]).map((r) => ({
      id: r.id as string, titulo: `${fmtFecha(r.fecha as string)} · ${r.proveedores?.nombre ?? '—'}`,
      detalle: `${(r.debe as number) > 0 ? `Debe ${money(r.debe as number)}` : `Haber ${money(r.haber as number)}`}${r.detalle ? ` · ${r.detalle}` : ''}`,
      cuando: cuando(r.creado as string), autor: (r.autor as string) ?? null, fotoPath: (r.foto_path as string) ?? null,
    }));
  }
  const { data } = await db.from('cheques').select('id,numero,tipo,monto,vencimiento,contraparte,estado,autor,creado,foto_path').eq('origen', 'app').order('creado', { ascending: false }).limit(N);
  return ((data ?? []) as Fila[]).map((r) => ({
    id: r.id as string, titulo: `Cheque ${r.numero} · ${r.tipo}`,
    detalle: `${money(r.monto as number)} · vence ${fmtFecha(r.vencimiento as string)} · ${r.contraparte ?? '—'} · ${r.estado}`,
    cuando: cuando(r.creado as string), autor: (r.autor as string) ?? null, fotoPath: (r.foto_path as string) ?? null,
  }));
}
