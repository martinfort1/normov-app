-- Planeación: al marcar un viaje del itinerario como "hecho", sus metros suman de inmediato a lo entregado del pedido
-- (sin esperar a cargar el remito) y el pedido pasa de columna solo: de Pendientes a "Realizado en parte" y, si ya
-- está todo entregado, a "Realizado". Al desmarcarlo, se restan.
--
-- Cómo suma: los metros van a "entregado_declarado" del material (el mismo campo que se escribe a mano en la tarjeta).
-- Cuando después se cargan los viajes con su remito, lo entregado es el mayor entre lo anotado y lo que suman los
-- remitos, así que no se duplica. "impactado" recuerda si los metros de ese viaje ya se sumaron (evita sumarlos dos veces).
-- Requiere 0011 y 0012. Se puede volver a correr.

begin;

do $$
begin
  if to_regclass('public.plan_viajes') is null then
    raise exception 'Falta correr antes 0012_planeacion.sql.';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'estado_pedido' and e.enumlabel = 'remitado') then
    raise exception 'Falta correr antes 0011_pedidos_entregado.sql.';
  end if;
end $$;

alter table plan_viajes add column if not exists impactado boolean not null default false;

-- Los viajes que ya estaban marcados como hechos suman una sola vez
with h as (
  select pedido_id, material_id, sum(cantidad) as c from plan_viajes where hecho and not impactado group by 1, 2
)
update pedido_items i set entregado_declarado = i.entregado_declarado + h.c
from h where i.pedido_id = h.pedido_id and i.material_id = h.material_id;
update plan_viajes set impactado = true where hecho and not impactado;

create or replace function marcar_viaje_hecho(p_id uuid, p_hecho boolean) returns void
language plpgsql as $$
declare
  v plan_viajes%rowtype;
begin
  select * into v from plan_viajes where id = p_id for update;
  if not found then raise exception 'El viaje ya no existe.'; end if;

  update plan_viajes set hecho = p_hecho where id = p_id;

  if p_hecho and not v.impactado then
    update pedido_items set entregado_declarado = entregado_declarado + v.cantidad
    where pedido_id = v.pedido_id and material_id = v.material_id;
    update plan_viajes set impactado = true where id = p_id;
  elsif not p_hecho and v.impactado then
    update pedido_items set entregado_declarado = greatest(0, entregado_declarado - v.cantidad)
    where pedido_id = v.pedido_id and material_id = v.material_id;
    update plan_viajes set impactado = false where id = p_id;
  end if;

  if p_hecho then
    -- el pedido avanza solo: Pendientes -> Realizado en parte -> Realizado (todo entregado)
    update pedidos set estado = 'realizado' where id = v.pedido_id and estado = 'pendiente';
    if not exists (select 1 from v_pedido_avance a where a.pedido_id = v.pedido_id and a.entregado < a.pedido) then
      update pedidos set estado = 'remitado' where id = v.pedido_id and estado in ('pendiente', 'realizado');
    end if;
  end if;
end $$;

commit;
