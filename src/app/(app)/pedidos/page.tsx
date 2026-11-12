import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';
import { hoyAR } from '@/lib/periodo';
import { SinAcceso } from '@/components/sin-acceso';
import { Tablero, type PedidoCard, type Catalogos } from './tablero';

export const dynamic = 'force-dynamic';

const RANGO = { urgente: 0, alta: 1, normal: 2, baja: 3 } as const;

interface FilaPedido {
  id: string; numero: number; cliente_id: string; obra_id: string | null; prioridad: keyof typeof RANGO; fecha_entrega: string | null; estado: 'pendiente' | 'realizado';
  clientes: { razon_social: string } | null; obras: { nombre: string } | null;
}

export default async function Pedidos() {
  const acceso = await getAcceso();
  if (!acceso?.puedeVer('pedidos')) return <SinAcceso seccion="Pedidos" />;
  const supabase = await createClient();

  const pedidosRes = await supabase.from('pedidos').select('id,numero,cliente_id,obra_id,prioridad,fecha_entrega,estado,clientes(razon_social),obras(nombre)')
    .in('estado', ['pendiente', 'realizado']).order('numero').limit(500);
  if (pedidosRes.error) {
    return (
      <>
        <h1>Pedidos</h1>
        <div className="banner err">
          Todavía no está lista la base para Pedidos ({pedidosRes.error.message}). Corré en Supabase las migraciones <b>0008_modulo_pedidos.sql</b> y después <b>0009_pedidos.sql</b>.
        </div>
      </>
    );
  }
  const filas = (pedidosRes.data ?? []) as unknown as FilaPedido[];
  const ids = filas.map((f) => f.id);

  const [avanceRes, vinculosRes, clientesRes, obrasRes, materialesRes] = await Promise.all([
    ids.length ? supabase.from('v_pedido_avance').select('pedido_id,material_id,pedido,entregado').in('pedido_id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from('pedido_remitos').select('pedido_id').in('pedido_id', ids) : Promise.resolve({ data: [], error: null }),
    supabase.from('clientes').select('id,razon_social').eq('activo', true).order('razon_social').limit(3000),
    supabase.from('obras').select('id,nombre,cliente_id').order('nombre').limit(8000),
    supabase.from('materiales').select('id,nombre,unidad').order('nombre').limit(500),
  ]);

  const materiales = new Map((materialesRes.data ?? []).map((m) => [m.id as string, { nombre: m.nombre as string, unidad: m.unidad as string }]));
  const viajes = new Map<string, number>();
  for (const v of (vinculosRes.data ?? []) as { pedido_id: string }[]) viajes.set(v.pedido_id, (viajes.get(v.pedido_id) ?? 0) + 1);
  const itemsDe = new Map<string, PedidoCard['items']>();
  for (const a of (avanceRes.data ?? []) as { pedido_id: string; material_id: string; pedido: number; entregado: number }[]) {
    const m = materiales.get(a.material_id);
    const lista = itemsDe.get(a.pedido_id) ?? [];
    lista.push({ materialId: a.material_id, material: m?.nombre ?? '—', unidad: m?.unidad ?? 'm3', pedido: Number(a.pedido), entregado: Number(a.entregado) });
    itemsDe.set(a.pedido_id, lista);
  }

  const pedidos: PedidoCard[] = filas.map((f) => {
    const items = (itemsDe.get(f.id) ?? []).sort((x, y) => x.material.localeCompare(y.material));
    const total = items.reduce((s, i) => s + i.pedido, 0);
    const hecho = items.reduce((s, i) => s + Math.min(i.entregado, i.pedido), 0);
    return {
      id: f.id, numero: f.numero, clienteId: f.cliente_id, cliente: f.clientes?.razon_social ?? '—', obraId: f.obra_id, obra: f.obras?.nombre ?? null,
      prioridad: f.prioridad, fechaEntrega: f.fecha_entrega, estado: f.estado, items, viajes: viajes.get(f.id) ?? 0,
      pct: total > 0 ? Math.round((hecho / total) * 100) : 0,
    };
  }).sort((a, b) => RANGO[a.prioridad] - RANGO[b.prioridad] || (a.fechaEntrega ?? '9999').localeCompare(b.fechaEntrega ?? '9999') || a.numero - b.numero);

  const cat: Catalogos = {
    clientes: (clientesRes.data ?? []).map((c) => ({ id: c.id as string, nombre: c.razon_social as string })),
    obras: (obrasRes.data ?? []).map((o) => ({ id: o.id as string, nombre: o.nombre as string, clienteId: o.cliente_id as string | null })),
    materiales: [...materiales].map(([id, m]) => ({ id, nombre: m.nombre, unidad: m.unidad })),
  };

  return (
    <>
      <h1>Pedidos</h1>
      <p className="lede">Lo que hay que entregar. Vinculá los viajes ya cargados para ver cuánto se entregó y cuánto falta.</p>
      <Tablero pedidos={pedidos} cat={cat} hoy={hoyAR()} puedeCargar={acceso.puedeEscribir('pedidos')} puedeVincular={acceso.puedeEscribir('pedidos') && acceso.puedeVer('viajes')} />
    </>
  );
}
