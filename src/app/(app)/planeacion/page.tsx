import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';
import { addDays, hoyAR } from '@/lib/periodo';
import { SinAcceso } from '@/components/sin-acceso';
import { Planeacion, type CamionPlan, type PedidoPlan, type ViajePlan, type Segmento } from './planeacion';

export const dynamic = 'force-dynamic';

const RANGO: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baja: 3 };

interface FilaPedido {
  id: string; numero: number; prioridad: string; fecha_entrega: string | null; estado: string;
  clientes: { razon_social: string } | null; obras: { nombre: string } | null;
}

export default async function PaginaPlaneacion({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const acceso = await getAcceso();
  if (!acceso?.puedeVer('pedidos')) return <SinAcceso seccion="Planeación" />;
  const hoy = hoyAR();
  const { fecha: pedida } = await searchParams;
  const fecha = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : hoy;
  const supabase = await createClient();

  const camionesRes = await supabase.from('camiones').select('*').order('patente');
  if (camionesRes.error) {
    return (
      <>
        <h1>Planeación</h1>
        <div className="banner err">
          Todavía no está lista la base para Planeación ({camionesRes.error.message}). Corré en Supabase la migración <b>0012_planeacion.sql</b> (requiere haber corrido antes la 0009 de Pedidos).
        </div>
      </>
    );
  }

  // El punto de retiro (cantera) necesita la migración 0013; sin ella se sigue funcionando sin esa columna
  const pedirViajes = async () => {
    // remito_id (migración 0017) dice si el viaje ya tiene su remito cargado
    const todo = await supabase.from('plan_viajes').select('id,camion_id,orden,pedido_id,material_id,cantidad,hecho,cantera,remito_id').eq('fecha', fecha).order('orden');
    if (!todo.error) return todo;
    const con = await supabase.from('plan_viajes').select('id,camion_id,orden,pedido_id,material_id,cantidad,hecho,cantera').eq('fecha', fecha).order('orden');
    if (!con.error) return con;
    return supabase.from('plan_viajes').select('id,camion_id,orden,pedido_id,material_id,cantidad,hecho').eq('fecha', fecha).order('orden');
  };
  const [viajesRes, choferesRes, abiertosRes, materialesRes, canterasRes] = await Promise.all([
    pedirViajes(),
    supabase.from('plan_choferes').select('camion_id,chofer').eq('fecha', fecha),
    supabase.from('pedidos').select('id,numero,prioridad,fecha_entrega,estado,clientes(razon_social),obras(nombre)').in('estado', ['pendiente', 'realizado']).order('numero').limit(500),
    supabase.from('materiales').select('id,nombre,unidad').limit(500),
    // Canteras conocidas: las de los viajes de los últimos ~18 meses, de más a menos usadas
    supabase.from('remitos').select('cantera').gte('fecha', addDays(hoy, -548)).not('cantera', 'is', null).order('fecha', { ascending: false }).limit(5000),
  ]);
  const viajes = (viajesRes.data ?? []) as unknown as { id: string; camion_id: string; orden: number; pedido_id: string; material_id: string; cantidad: number; hecho: boolean; cantera?: string | null; remito_id?: string | null }[];
  const uso = new Map<string, number>();
  for (const r of (canterasRes.data ?? []) as { cantera: string | null }[]) {
    const c = (r.cantera ?? '').trim().toUpperCase();
    if (c && c !== '—') uso.set(c, (uso.get(c) ?? 0) + 1);
  }
  for (const v of viajes) if (v.cantera) uso.set(v.cantera, uso.get(v.cantera) ?? 1);
  const canteras = [...uso].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
  const abiertos = (abiertosRes.data ?? []) as unknown as FilaPedido[];

  // Minorista / mayorista de cada pedido (migración 0018); sin ella todo cae en la pestaña Minorista
  const todosIds = [...new Set([...abiertos.map((p) => p.id), ...viajes.map((v) => v.pedido_id)])];
  const segRes = todosIds.length ? await supabase.from('pedidos').select('id,segmento').in('id', todosIds) : { data: [], error: null };
  const segmentoListo = !segRes.error;
  const segmentoDe = new Map<string, Segmento>(segRes.error ? [] : ((segRes.data ?? []) as { id: string; segmento: Segmento }[]).map((r) => [r.id, r.segmento]));
  const seg = (id: string): Segmento => segmentoDe.get(id) ?? 'minorista';

  // Pedidos que aparecen en el itinerario pero ya no están abiertos (completados o cancelados): se traen aparte para poder mostrarlos
  const abiertosIds = new Set(abiertos.map((p) => p.id));
  const faltantes = [...new Set(viajes.map((v) => v.pedido_id))].filter((id) => !abiertosIds.has(id));
  const extra = faltantes.length
    ? ((await supabase.from('pedidos').select('id,numero,prioridad,fecha_entrega,estado,clientes(razon_social),obras(nombre)').in('id', faltantes)).data ?? []) as unknown as FilaPedido[]
    : [];

  const idsAvance = abiertos.map((p) => p.id);
  const avanceRes = idsAvance.length
    ? await supabase.from('v_pedido_avance').select('pedido_id,material_id,pedido,entregado').in('pedido_id', idsAvance)
    : { data: [] as { pedido_id: string; material_id: string; pedido: number; entregado: number }[] };
  const avance = (avanceRes.data ?? []) as { pedido_id: string; material_id: string; pedido: number; entregado: number }[];

  const materiales = new Map((materialesRes.data ?? []).map((m) => [m.id as string, { nombre: m.nombre as string, unidad: m.unidad as string }]));
  // Lo planificado (y todavía no hecho) en el día, por pedido y material
  const planificado = new Map<string, number>();
  for (const v of viajes) if (!v.hecho) planificado.set(`${v.pedido_id}|${v.material_id}`, (planificado.get(`${v.pedido_id}|${v.material_id}`) ?? 0) + Number(v.cantidad));

  const pedidos: PedidoPlan[] = abiertos.map((p) => ({
    id: p.id, numero: p.numero, cliente: p.clientes?.razon_social ?? '—', obra: p.obras?.nombre ?? null, prioridad: p.prioridad, fechaEntrega: p.fecha_entrega, segmento: seg(p.id),
    items: avance.filter((a) => a.pedido_id === p.id).map((a) => ({
      materialId: a.material_id, material: materiales.get(a.material_id)?.nombre ?? '—', unidad: materiales.get(a.material_id)?.unidad ?? 'm3',
      pedido: Number(a.pedido), entregado: Number(a.entregado), planificado: planificado.get(`${p.id}|${a.material_id}`) ?? 0,
    })).sort((x, y) => x.material.localeCompare(y.material)),
  })).sort((a, b) => (RANGO[a.prioridad] ?? 9) - (RANGO[b.prioridad] ?? 9) || (a.fechaEntrega ?? '9999').localeCompare(b.fechaEntrega ?? '9999') || a.numero - b.numero);

  const info = new Map<string, { numero: number; cliente: string; obra: string | null }>();
  for (const p of [...abiertos, ...extra]) info.set(p.id, { numero: p.numero, cliente: p.clientes?.razon_social ?? '—', obra: p.obras?.nombre ?? null });

  const choferDia = new Map((choferesRes.data ?? []).map((c) => [c.camion_id as string, c.chofer as string]));
  const camiones: CamionPlan[] = (camionesRes.data ?? []).map((c) => ({
    id: c.id as string, patente: c.patente as string, chofer: (c.chofer as string | null) ?? '', choferDia: choferDia.get(c.id as string) ?? null,
    capacidad: Number(c.capacidad), disponible: c.disponible as boolean, soloMayorista: !!c.solo_mayorista,
    viajes: viajes.filter((v) => v.camion_id === c.id).map((v): ViajePlan => {
      const ped = info.get(v.pedido_id);
      return {
        id: v.id, orden: v.orden, pedidoId: v.pedido_id, materialId: v.material_id, material: materiales.get(v.material_id)?.nombre ?? '—',
        unidad: materiales.get(v.material_id)?.unidad ?? 'm3', cantidad: Number(v.cantidad), hecho: v.hecho, cantera: v.cantera ?? '', cargado: !!v.remito_id, segmento: seg(v.pedido_id),
        numeroPedido: ped?.numero ?? 0, cliente: ped?.cliente ?? '—', obra: ped?.obra ?? null,
      };
    }),
  }));

  return (
    <>
      <h1>Planeación</h1>
      <p className="lede">Qué camiones salen, con qué chofer y a dónde, y cuánto avanza cada pedido con los viajes del día.</p>
      <Planeacion fecha={fecha} hoy={hoy} camiones={camiones} pedidos={pedidos} canteras={canteras} segmentoListo={segmentoListo} puedeCargar={acceso.puedeEscribir('pedidos')} puedeCargarViaje={acceso.puedeEscribir('viajes')} />
    </>
  );
}
