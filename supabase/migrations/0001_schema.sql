-- NORMOV · esquema inicial
-- Fuente de verdad para remitos, certificados, cuentas corrientes, cheques y combustible.
-- Los saldos son VISTAS: nunca se guardan, así no se desfasan.

-- ───────────── tipos ─────────────
create type unidad_medida       as enum ('m3', 't', 'h');
create type rol_usuario         as enum ('sin_acceso', 'lector', 'operador', 'admin');
create type origen_remito       as enum ('planilla', 'manual', 'foto');
create type estado_certificado  as enum ('pendiente', 'aprobado', 'anulado');

-- ───────────── utilidades ─────────────
-- "hoy" en Tucumán, no en UTC
create function hoy_ar() returns date
language sql stable as $$ select (now() at time zone 'America/Argentina/Tucuman')::date $$;

create function set_actualizado() returns trigger
language plpgsql as $$ begin new.actualizado = now(); return new; end $$;

-- ───────────── usuarios y roles ─────────────
-- Todo usuario nuevo entra como 'sin_acceso'; un admin lo promueve.
create table profiles (
  id        uuid primary key references auth.users on delete cascade,
  email     text,
  nombre    text,
  rol       rol_usuario not null default 'sin_acceso',
  creado    timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

create function rol_actual() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from profiles where id = auth.uid()), 'sin_acceso')
$$;
create function puede_leer() returns boolean
language sql stable as $$ select rol_actual() in ('lector', 'operador', 'admin') $$;
create function puede_escribir() returns boolean
language sql stable as $$ select rol_actual() in ('operador', 'admin') $$;

-- ───────────── maestros ─────────────
create table clientes (
  id           uuid primary key default gen_random_uuid(),
  razon_social text not null unique,
  activo       boolean not null default true,
  creado       timestamptz not null default now()
);

-- "Cliente / obra" de la planilla
create table obras (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes on delete restrict,
  nombre     text not null,
  unique nulls not distinct (cliente_id, nombre)
);

create table materiales (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  unidad unidad_medida not null default 'm3'
);

-- Lista de precios con vigencia: reemplaza la actualización manual de precios.
create table precios (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references clientes on delete cascade,
  material_id    uuid not null references materiales on delete cascade,
  precio         numeric(14,2) not null check (precio >= 0),
  vigente_desde  date not null,
  unique (cliente_id, material_id, vigente_desde)
);

-- ───────────── remitos ─────────────
create table remitos (
  id          uuid primary key default gen_random_uuid(),
  numero      text not null unique,
  fecha       date not null,
  cliente_id  uuid references clientes,
  obra_id     uuid references obras,
  material_id uuid references materiales,
  camion      text,
  chofer      text,
  cantera     text,
  cantidad    numeric(14,2) not null default 0,
  precio      numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  neto        numeric(14,2) not null default 0,
  costo       numeric(14,2) not null default 0,
  origen      origen_remito not null default 'planilla',
  foto_path   text,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index remitos_fecha_idx   on remitos (fecha);
create index remitos_cliente_idx on remitos (cliente_id, fecha);
create trigger remitos_upd before update on remitos for each row execute function set_actualizado();

-- ───────────── certificados ─────────────
create table certificados (
  id           uuid primary key default gen_random_uuid(),
  numero       integer generated always as identity unique,
  cliente_id   uuid not null references clientes,
  desde        date not null,
  hasta        date not null,
  unidad       unidad_medida not null,
  emision      date not null default hoy_ar(),
  estado       estado_certificado not null default 'pendiente',
  cantidad     numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  creado_por   uuid references profiles,
  creado       timestamptz not null default now(),
  aprobado_por uuid references profiles,
  aprobado_en  timestamptz,
  check (hasta >= desde)
);

create table certificado_items (
  id             uuid primary key default gen_random_uuid(),
  certificado_id uuid not null references certificados on delete cascade,
  remito_id      uuid references remitos,           -- null en remitos cargados a mano
  remito_numero  text not null,
  fecha          date not null,
  cantidad       numeric(14,2) not null check (cantidad > 0),
  precio         numeric(14,2) not null check (precio >= 0),
  total          numeric(14,2) not null,
  origen         origen_remito not null,
  cert_activo    boolean not null default true       -- lo mantienen los triggers
);
-- Un remito no puede estar en dos certificados vigentes (pendiente o aprobado).
-- La regla la garantiza la base, aunque dos personas armen certificados a la vez.
create unique index certificado_items_remito_activo
  on certificado_items (remito_numero) where cert_activo;

create function items_set_activo() returns trigger
language plpgsql as $$
begin
  select estado in ('pendiente', 'aprobado') into new.cert_activo
    from certificados where id = new.certificado_id;
  return new;
end $$;
create trigger items_activo before insert on certificado_items
  for each row execute function items_set_activo();

create function cert_sync_items() returns trigger
language plpgsql as $$
begin
  update certificado_items set cert_activo = (new.estado in ('pendiente', 'aprobado'))
   where certificado_id = new.id;
  return new;
end $$;
create trigger cert_estado_sync after update of estado on certificados
  for each row when (old.estado is distinct from new.estado) execute function cert_sync_items();

-- Solo un admin aprueba; queda registrado quién y cuándo.
create function cert_guard() returns trigger
language plpgsql as $$
begin
  if new.estado = 'aprobado' and old.estado <> 'aprobado' then
    if rol_actual() <> 'admin' then
      raise exception 'Solo un administrador puede aprobar certificados';
    end if;
    new.aprobado_por = auth.uid();
    new.aprobado_en  = now();
  end if;
  return new;
end $$;
create trigger cert_guard_trg before update on certificados
  for each row execute function cert_guard();

-- ───────────── proveedores / cuenta corriente ─────────────
create table proveedores (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table movimientos_proveedor (
  id            uuid primary key default gen_random_uuid(),
  proveedor_id  uuid not null references proveedores,
  fecha         date,
  centro_costo  text,
  unidad_negocio text,
  rubro         text,
  subrubro      text,
  detalle       text,
  nro_factura   text,
  debe          numeric(14,2) not null default 0,   -- compras y gastos
  haber         numeric(14,2) not null default 0,   -- pagos
  forma_pago    text,
  nro_cheque    text,
  observaciones text,
  source_hash   text unique                          -- idempotencia de la importación
);
create index mov_prov_fecha_idx on movimientos_proveedor (fecha);

-- ───────────── cheques ─────────────
create table cheques (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,                       -- Propio / Tercero
  contraparte   text,
  numero        text,
  banco         text,
  librador      text,
  monto         numeric(14,2) not null,
  emision       date,
  vencimiento   date,
  estado        text not null default '—',
  endosado_a    text,
  observaciones text,
  source_hash   text unique
);
create index cheques_venc_idx on cheques (vencimiento);

-- ───────────── combustible ─────────────
create table cargas_combustible (
  id          uuid primary key default gen_random_uuid(),
  fecha       date,
  remito      text,
  patente     text not null,
  es_camion   boolean not null,
  litros      numeric(12,2) not null,
  tipo        text,
  estacion    text,
  chofer      text,
  source_hash text unique
);
create index combustible_fecha_idx on cargas_combustible (fecha);

create table precios_combustible (
  vigente_desde date primary key,
  precio        numeric(12,2) not null check (precio >= 0)
);

-- Saldos de clientes tal como los calculan hoy las planillas (fase puente).
-- Cuando las facturas y cobranzas se carguen en la app, se reemplaza por una vista.
create table saldos_clientes_planilla (
  fuente     text not null,                          -- 'cta_clientes' | 'clientes_diego'
  nombre     text not null,
  ventas     numeric(16,2) not null default 0,
  cobranzas  numeric(16,2) not null default 0,
  saldo      numeric(16,2) not null default 0,
  capturado  timestamptz not null default now(),
  primary key (fuente, nombre)
);

-- ───────────── vistas ─────────────
create view v_saldo_proveedores with (security_invoker = true) as
select p.id, p.nombre,
       sum(m.debe)  as debe,
       sum(m.haber) as haber,
       sum(m.debe) - sum(m.haber) as saldo,
       count(*)     as movimientos
from proveedores p join movimientos_proveedor m on m.proveedor_id = p.id
group by p.id, p.nombre;

-- Remito + certificado vigente que lo contiene (si hay)
create view v_remitos_estado with (security_invoker = true) as
select r.*, ci.certificado_id, c.numero as cert_numero, c.estado as cert_estado
from remitos r
left join certificado_items ci on ci.remito_numero = r.numero and ci.cert_activo
left join certificados c on c.id = ci.certificado_id;

-- Semáforo de cheques. Umbral de "por vencer": 7 días (ajustable).
create view v_cheques_panel with (security_invoker = true) as
select c.*,
       (c.vencimiento - hoy_ar()) as dias,
       case
         when c.estado ilike 'debitad%' or c.estado ilike 'endosad%' then 'cerrado'
         when c.vencimiento is null            then 'sin_fecha'
         when c.vencimiento <  hoy_ar()        then 'vencido'
         when c.vencimiento <= hoy_ar() + 7    then 'por_vencer'
         else 'ok'
       end as semaforo
from cheques c;

-- ───────────── seguridad (RLS) ─────────────
alter table profiles enable row level security;
create policy profiles_ver on profiles for select using (id = auth.uid() or rol_actual() = 'admin');
create policy profiles_admin on profiles for update using (rol_actual() = 'admin');

do $$
declare t text;
begin
  foreach t in array array[
    'clientes','obras','materiales','precios','remitos','certificados','certificado_items',
    'proveedores','movimientos_proveedor','cheques','cargas_combustible','precios_combustible',
    'saldos_clientes_planilla'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (puede_leer())', t || '_sel', t);
    execute format('create policy %I on %I for insert with check (puede_escribir())', t || '_ins', t);
    execute format('create policy %I on %I for update using (puede_escribir())', t || '_upd', t);
    execute format('create policy %I on %I for delete using (puede_escribir())', t || '_del', t);
  end loop;
end $$;
-- La importación usa la service role key, que se salta RLS.
