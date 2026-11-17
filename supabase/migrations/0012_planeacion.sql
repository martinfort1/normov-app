-- Planeación: camiones (con su capacidad y si están disponibles), chofer de cada camión por día e itinerario de viajes por
-- día, que reparte lo que falta entregar de los pedidos. Usa el mismo permiso que Pedidos (ver / cargar).
-- Requiere 0009. Todo o nada.

begin;

do $$
begin
  if to_regclass('public.pedidos') is null then
    raise exception 'Falta correr antes 0009_pedidos.sql. Ejecutala y después volvé a correr esta (0012).';
  end if;
end $$;

create table camiones (
  id          uuid primary key default gen_random_uuid(),
  patente     text not null,
  chofer      text,                                             -- chofer habitual
  capacidad   numeric(6,2) not null check (capacidad > 0),      -- m³ que carga por viaje
  disponible  boolean not null default true,                    -- false = en taller / fuera de servicio
  creado      timestamptz not null default now()
);
create unique index camiones_patente_uq on camiones (upper(btrim(patente)));

-- Chofer de cada camión en un día puntual (si no hay fila, se usa el habitual)
create table plan_choferes (
  fecha     date not null,
  camion_id uuid not null references camiones on delete cascade,
  chofer    text not null,
  primary key (fecha, camion_id)
);

-- Itinerario: cada fila es un viaje (destino) de un camión en un día
create table plan_viajes (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  camion_id   uuid not null references camiones on delete cascade,
  orden       integer not null,
  pedido_id   uuid not null references pedidos on delete cascade,
  material_id uuid not null references materiales on delete restrict,
  cantidad    numeric(14,2) not null check (cantidad > 0),
  hecho       boolean not null default false,
  autor       text,
  creado      timestamptz not null default now()
);
create index plan_viajes_dia_idx on plan_viajes (fecha, camion_id, orden);
create index plan_viajes_pedido_idx on plan_viajes (pedido_id);

do $$
declare t text;
begin
  foreach t in array array['camiones', 'plan_choferes', 'plan_viajes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using ((select puede_ver(''pedidos''::modulo_app)))', t || '_sel', t);
    execute format('create policy %I on %I for insert with check ((select puede_editar(''pedidos''::modulo_app)))', t || '_ins', t);
    execute format('create policy %I on %I for update using ((select puede_editar(''pedidos''::modulo_app))) with check ((select puede_editar(''pedidos''::modulo_app)))', t || '_upd', t);
    execute format('create policy %I on %I for delete using ((select puede_editar(''pedidos''::modulo_app)))', t || '_del', t);
  end loop;
end $$;

commit;
