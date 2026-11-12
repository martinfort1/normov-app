-- Pedidos, paso 2 de 2: tablero de pedidos de clientes (qué hay que entregar) y su vínculo con los viajes ya cargados.
-- Requiere haber corrido 0008. Todo o nada.
--
-- Un pedido = un cliente (y opcionalmente una obra) con uno o más materiales y sus m³ pedidos, una prioridad y una
-- fecha de entrega. Los viajes (remitos) se vinculan al pedido; lo entregado se calcula sumando esos viajes.
-- Estados: pendiente → realizado → completado (archivado). También puede quedar cancelado (archivado).

begin;

do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'modulo_app' and e.enumlabel = 'pedidos') then
    raise exception 'Falta correr antes 0008_modulo_pedidos.sql. Ejecutala y después volvé a correr esta (0009).';
  end if;
end $$;

create type prioridad_pedido as enum ('urgente', 'alta', 'normal', 'baja');
create type estado_pedido    as enum ('pendiente', 'realizado', 'completado', 'cancelado');

create table pedidos (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity unique,   -- número correlativo del pedido
  cliente_id    uuid not null references clientes on delete restrict,
  obra_id       uuid references obras on delete set null,
  prioridad     prioridad_pedido not null default 'normal',
  fecha_entrega date,
  estado        estado_pedido not null default 'pendiente',
  autor         text,
  creado        timestamptz not null default now(),
  actualizado   timestamptz not null default now(),
  cerrado       timestamptz
);
create index pedidos_estado_idx on pedidos (estado);
create trigger pedidos_upd before update on pedidos for each row execute function set_actualizado();

create table pedido_items (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references pedidos on delete cascade,
  material_id uuid not null references materiales on delete restrict,
  cantidad    numeric(14,2) not null check (cantidad > 0),
  unique (pedido_id, material_id)
);

-- Un viaje pertenece a un solo pedido (la clave es el propio viaje).
create table pedido_remitos (
  remito_id  uuid primary key references remitos on delete cascade,
  pedido_id  uuid not null references pedidos on delete cascade,
  autor      text,
  vinculado  timestamptz not null default now()
);
create index pedido_remitos_pedido_idx on pedido_remitos (pedido_id);

-- Avance por material: pedido vs. entregado (suma de los viajes vinculados con ese material).
-- Corre con los permisos del dueño de la vista para que quien solo tiene "Pedidos" vea lo entregado sin necesitar
-- acceso a Viajes; el filtro de abajo mantiene la regla: solo ve el avance quien puede ver Pedidos.
create view v_pedido_avance as
select i.id as item_id, i.pedido_id, i.material_id, i.cantidad as pedido,
       coalesce((
         select sum(r.cantidad) from pedido_remitos pr join remitos r on r.id = pr.remito_id
         where pr.pedido_id = i.pedido_id and r.material_id = i.material_id
       ), 0)::numeric(14,2) as entregado
from pedido_items i
where (select puede_ver('pedidos'::modulo_app));

-- ───────────── guardar un pedido completo en un solo paso (cabecera + materiales) ─────────────
-- p_id nulo = crear. Los materiales que ya no estén en la lista se quitan (los viajes vinculados siguen vinculados).
create function guardar_pedido(p_id uuid, p_cliente uuid, p_obra uuid, p_prioridad prioridad_pedido, p_fecha date, p_items jsonb, p_autor text)
returns uuid language plpgsql as $$
declare
  v_id uuid := p_id;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un material.';
  end if;
  if v_id is null then
    insert into pedidos (cliente_id, obra_id, prioridad, fecha_entrega, autor)
    values (p_cliente, p_obra, p_prioridad, p_fecha, p_autor) returning id into v_id;
  else
    update pedidos set cliente_id = p_cliente, obra_id = p_obra, prioridad = p_prioridad, fecha_entrega = p_fecha where id = v_id;
    if not found then raise exception 'No se encontró el pedido.'; end if;
    delete from pedido_items where pedido_id = v_id
      and material_id not in (select (x->>'material_id')::uuid from jsonb_array_elements(p_items) x);
  end if;
  insert into pedido_items (pedido_id, material_id, cantidad)
  select v_id, (x->>'material_id')::uuid, (x->>'cantidad')::numeric from jsonb_array_elements(p_items) x
  on conflict (pedido_id, material_id) do update set cantidad = excluded.cantidad;
  return v_id;
end $$;

-- ───────────── seguridad ─────────────
alter table pedidos        enable row level security;
alter table pedido_items   enable row level security;
alter table pedido_remitos enable row level security;

create policy pedidos_sel on pedidos for select using ((select puede_ver('pedidos'::modulo_app)));
create policy pedidos_ins on pedidos for insert with check ((select puede_editar('pedidos'::modulo_app)));
create policy pedidos_upd on pedidos for update using ((select puede_editar('pedidos'::modulo_app))) with check ((select puede_editar('pedidos'::modulo_app)));
create policy pedidos_del on pedidos for delete using ((select puede_editar('pedidos'::modulo_app)));

create policy pedido_items_sel on pedido_items for select using ((select puede_ver('pedidos'::modulo_app)));
create policy pedido_items_ins on pedido_items for insert with check ((select puede_editar('pedidos'::modulo_app)));
create policy pedido_items_upd on pedido_items for update using ((select puede_editar('pedidos'::modulo_app))) with check ((select puede_editar('pedidos'::modulo_app)));
create policy pedido_items_del on pedido_items for delete using ((select puede_editar('pedidos'::modulo_app)));

-- Vincular un viaje exige poder cargar Pedidos y además poder ver Viajes.
create policy pedido_remitos_sel on pedido_remitos for select using ((select puede_ver('pedidos'::modulo_app)));
create policy pedido_remitos_ins on pedido_remitos for insert
  with check ((select puede_editar('pedidos'::modulo_app) and puede_ver('viajes'::modulo_app)));
create policy pedido_remitos_del on pedido_remitos for delete using ((select puede_editar('pedidos'::modulo_app)));

-- ───────────── quienes ya existen heredan su nivel en Viajes ─────────────
insert into permisos (user_id, modulo, nivel)
select user_id, 'pedidos'::modulo_app, nivel from permisos where modulo = 'viajes'
on conflict (user_id, modulo) do nothing;

commit;
