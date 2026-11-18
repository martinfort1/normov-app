-- Planeación: al cargar un viaje desde el botón "Cargar viaje" del itinerario, el remito queda vinculado al pedido
-- y el viaje del plan queda hecho, sin pasos manuales. "remito_id" recuerda qué remito cargó cada viaje del plan
-- (así el viaje no se vincula dos veces). Requiere 0014. Se puede volver a correr.

begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'marcar_viaje_hecho') then
    raise exception 'Falta correr antes 0014_viaje_hecho.sql.';
  end if;
end $$;

alter table plan_viajes add column if not exists remito_id uuid references remitos on delete set null;

-- Vincula el remito recién cargado con el pedido del viaje del plan y marca el viaje como hecho.
-- Corre con los permisos de quien llama: necesita poder cargar en Pedidos. Devuelve false si el viaje ya tenía su remito.
create or replace function vincular_viaje_cargado(p_plan uuid, p_remito uuid, p_autor text) returns boolean
language plpgsql as $$
declare
  v plan_viajes%rowtype;
begin
  select * into v from plan_viajes where id = p_plan for update;
  if not found then raise exception 'El viaje del plan ya no existe.'; end if;
  if v.remito_id is not null then return false; end if;

  insert into pedido_remitos (remito_id, pedido_id, autor) values (p_remito, v.pedido_id, p_autor) on conflict (remito_id) do nothing;
  update plan_viajes set remito_id = p_remito where id = p_plan;
  if not v.hecho then perform marcar_viaje_hecho(p_plan, true); end if;
  return true;
end $$;

commit;
