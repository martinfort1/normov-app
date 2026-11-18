import { createClient } from '@/lib/supabase/server';
import { getAcceso } from '@/lib/permisos';
import { hoyAR } from '@/lib/periodo';
import { SinAcceso } from '@/components/sin-acceso';
import { Precios, type FilaVenta, type FilaCosto } from './precios';

export const dynamic = 'force-dynamic';

export default async function PaginaPrecios() {
  const acceso = await getAcceso();
  if (!acceso?.puedeVer('viajes')) return <SinAcceso seccion="Precios" />;
  const supabase = await createClient();
  const [ventaRes, costoRes, clientesRes, materialesRes] = await Promise.all([
    supabase.from('lista_precios').select('id,razon_social,material,tipo,desde,precio_viaje6,precio_m3').order('razon_social').limit(5000),
    supabase.from('lista_costos').select('id,cantera,material,desde,costo_m3').order('cantera').limit(5000),
    supabase.from('clientes').select('razon_social').eq('activo', true).order('razon_social').limit(3000),
    supabase.from('materiales').select('nombre').order('nombre').limit(500),
  ]);

  const venta: FilaVenta[] = (ventaRes.data ?? []).map((f) => ({
    id: f.id as string, razon: f.razon_social as string, material: f.material as string, tipo: f.tipo as 'minorista' | 'mayorista', desde: f.desde as string,
    viaje6: f.precio_viaje6 == null ? null : Number(f.precio_viaje6), m3: Number(f.precio_m3),
  }));
  const costo: FilaCosto[] = (costoRes.data ?? []).map((f) => ({ id: f.id as string, cantera: f.cantera as string, material: f.material as string, desde: f.desde as string, m3: Number(f.costo_m3) }));
  // Canteras que ya aparecen en viajes (para ofrecerlas al cargar un costo)
  const canterasViajes = await supabase.from('remitos').select('cantera').not('cantera', 'is', null).order('fecha', { ascending: false }).limit(3000);
  const canteras = [...new Set([...costo.map((c) => c.cantera), ...((canterasViajes.data ?? []) as { cantera: string }[]).map((r) => r.cantera.trim().toUpperCase()).filter((c) => c && c !== '—')])].sort();

  return (
    <>
      <h1>Precios</h1>
      <p className="lede">
        Lo que fijás acá es lo que se sugiere al cargar un viaje: el <b>precio de venta</b> por cliente (o <b>GENERAL</b> para quien no tiene uno propio) y el
        <b> costo</b> de cada material en cada cantera. Para cambiar un precio, agregá uno nuevo con su fecha de vigencia: el anterior queda en el historial.
      </p>
      {ventaRes.error && <div className="banner err">Precios de venta: {ventaRes.error.message}. Corré <b>0010_lista_precios.sql</b> en Supabase.</div>}
      {costoRes.error && <div className="banner">Para cargar costos por cantera falta correr <b>0018_segmentos_costos.sql</b> en Supabase.</div>}
      <Precios venta={venta} costo={costo} costoListo={!costoRes.error} clientes={(clientesRes.data ?? []).map((c) => c.razon_social as string)}
        materiales={(materialesRes.data ?? []).map((m) => m.nombre as string)} canteras={canteras} puedeEditar={acceso.puedeEscribir('viajes')} hoy={hoyAR()} />
    </>
  );
}
