-- Cobranzas y Caja, paso 2 de 2. Requiere haber corrido 0015. Todo o nada.
--
-- Cuenta corriente de clientes cargada directo en la app:
--   deuda de un cliente = saldo inicial (lo que decía la planilla a la fecha de arranque)
--                       + certificados APROBADOS emitidos después de esa fecha
--                       - cobranzas vigentes
-- Una cobranza se imputa a uno o más certificados aprobados; lo que sobra queda "a cuenta" (baja el saldo igual).
-- Cada cobranza en efectivo genera su ingreso en la caja del día. La caja admite además ingresos y egresos sueltos.
-- Permisos: cobranzas y saldos usan el módulo "Saldos de clientes"; la caja tiene su propio módulo.

begin;

do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'modulo_app' and e.enumlabel = 'caja') then
    raise exception 'Falta correr antes 0015_modulo_caja.sql. Ejecutala y después volvé a correr esta (0016).';
  end if;
end $$;

-- ───────────── tablas ─────────────
create table saldos_iniciales (
  cliente_id uuid primary key references clientes on delete cascade,
  monto      numeric(14,2) not null,            -- positivo = el cliente debe
  al         date not null,                      -- fecha de arranque: los certificados emitidos después se suman
  autor      text,
  creado     timestamptz not null default now()
);

create table cobranzas (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity unique,
  fecha         date not null,
  cliente_id    uuid not null references clientes on delete restrict,
  monto         numeric(14,2) not null check (monto > 0),
  medio         text not null default 'efectivo',
  observaciones text,
  autor         text,
  creado        timestamptz not null default now(),
  anulada       boolean not null default false,
  anulada_en    timestamptz
);
create index cobranzas_cliente_idx on cobranzas (cliente_id, fecha);

create table cobranza_items (
  cobranza_id    uuid not null references cobranzas on delete cascade,
  certificado_id uuid not null references certificados on delete restrict,
  monto          numeric(14,2) not null check (monto > 0),
  primary key (cobranza_id, certificado_id)
);
create index cobranza_items_cert_idx on cobranza_items (certificado_id);

create table caja_movimientos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  tipo        text not null check (tipo in ('ingreso', 'egreso')),
  concepto    text not null check (length(btrim(concepto)) > 0),
  monto       numeric(14,2) not null check (monto > 0),
  medio       text not null default 'efectivo',
  cobranza_id uuid unique references cobranzas on delete restrict,   -- si viene de una cobranza
  autor       text,
  creado      timestamptz not null default now(),
  anulado     boolean not null default false
);
create index caja_fecha_idx on caja_movimientos (fecha);

-- Un movimiento que viene de una cobranza solo se anula anulando la cobranza (así no quedan desparejados).
create function caja_guard() returns trigger language plpgsql as $$
begin
  if new.cobranza_id is not null and new.anulado and not old.anulado
     and not exists (select 1 from cobranzas c where c.id = new.cobranza_id and c.anulada) then
    raise exception 'Este ingreso viene de una cobranza: para anularlo, anulá la cobranza.';
  end if;
  return new;
end $$;
create trigger caja_guard_upd before update on caja_movimientos for each row execute function caja_guard();

-- ───────────── permisos ─────────────
alter table saldos_iniciales  enable row level security;
alter table cobranzas         enable row level security;
alter table cobranza_items    enable row level security;
alter table caja_movimientos  enable row level security;

create policy saldos_iniciales_sel on saldos_iniciales for select using ((select puede_ver('clientes'::modulo_app)));
create policy saldos_iniciales_ins on saldos_iniciales for insert with check ((select puede_editar('clientes'::modulo_app)));
create policy saldos_iniciales_upd on saldos_iniciales for update using ((select puede_editar('clientes'::modulo_app))) with check ((select puede_editar('clientes'::modulo_app)));
create policy saldos_iniciales_del on saldos_iniciales for delete using ((select puede_editar('clientes'::modulo_app)));

-- Las cobranzas se crean y anulan solo con las funciones de abajo; acá solo se leen.
create policy cobranzas_sel       on cobranzas       for select using ((select puede_ver('clientes'::modulo_app)));
create policy cobranza_items_sel  on cobranza_items  for select using ((select puede_ver('clientes'::modulo_app)));

create policy caja_sel on caja_movimientos for select using ((select puede_ver('caja'::modulo_app)));
create policy caja_ins on caja_movimientos for insert with check ((select puede_editar('caja'::modulo_app)) and cobranza_id is null);
create policy caja_upd on caja_movimientos for update using ((select puede_editar('caja'::modulo_app))) with check ((select puede_editar('caja'::modulo_app)));

-- ───────────── vistas ─────────────
-- Cuánto se cobró de cada certificado aprobado. Corren con los permisos del dueño y se filtran por módulo:
-- quien ve "Saldos de clientes" ve esto sin necesitar el módulo Certificados.
create view v_cert_cobro as
select c.id as certificado_id, c.numero, c.cliente_id, c.emision, c.desde, c.hasta, c.total,
       coalesce(x.cobrado, 0)::numeric(14,2) as cobrado,
       (c.total - coalesce(x.cobrado, 0))::numeric(14,2) as pendiente
from certificados c
left join lateral (
  select sum(i.monto) as cobrado from cobranza_items i join cobranzas b on b.id = i.cobranza_id
  where i.certificado_id = c.id and not b.anulada
) x on true
where c.estado = 'aprobado' and (select puede_ver('clientes'::modulo_app));

create view v_cuenta_cliente as
select cl.id as cliente_id, cl.razon_social,
       coalesce(s.monto, 0)::numeric(14,2) as saldo_inicial,
       s.al,
       coalesce((select sum(c.total) from certificados c
                 where c.cliente_id = cl.id and c.estado = 'aprobado' and (s.al is null or c.emision > s.al)), 0)::numeric(14,2) as facturado,
       coalesce((select sum(b.monto) from cobranzas b where b.cliente_id = cl.id and not b.anulada), 0)::numeric(14,2) as cobrado
from clientes cl
left join saldos_iniciales s on s.cliente_id = cl.id
where (select puede_ver('clientes'::modulo_app));

-- ───────────── registrar una cobranza ─────────────
-- p_imputaciones: [{"certificado_id": "...", "monto": 1234.5}, ...]. La suma no puede pasar de p_monto;
-- el resto queda "a cuenta". Cada certificado debe ser del cliente, estar aprobado y no cobrarse de más.
create function registrar_cobranza(p_cliente uuid, p_fecha date, p_monto numeric, p_medio text, p_obs text, p_imputaciones jsonb, p_autor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_num bigint;
  v_nombre text;
  v_total numeric := 0;
  r record;
  v_cert certificados%rowtype;
  v_pend numeric;
begin
  if not puede_editar('clientes'::modulo_app) then raise exception 'No tenés permiso para cargar cobranzas.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto cobrado tiene que ser mayor a cero.'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de la cobranza.'; end if;
  if coalesce(p_medio, 'efectivo') <> 'efectivo' then raise exception 'Por ahora solo se cargan cobranzas en efectivo.'; end if;
  select razon_social into v_nombre from clientes where id = p_cliente;
  if not found then raise exception 'No se encontró el cliente.'; end if;

  insert into cobranzas (fecha, cliente_id, monto, medio, observaciones, autor)
  values (p_fecha, p_cliente, round(p_monto, 2), 'efectivo', nullif(btrim(p_obs), ''), p_autor)
  returning id, numero into v_id, v_num;

  for r in select (e->>'certificado_id')::uuid as cert, round((e->>'monto')::numeric, 2) as monto
           from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb)) e
  loop
    if r.monto is null or r.monto <= 0 then raise exception 'Cada importe imputado tiene que ser mayor a cero.'; end if;
    select * into v_cert from certificados where id = r.cert for update;
    if not found or v_cert.cliente_id <> p_cliente then raise exception 'Un certificado no pertenece a este cliente.'; end if;
    if v_cert.estado <> 'aprobado' then raise exception 'El certificado N° % no está aprobado.', v_cert.numero; end if;
    select v_cert.total - coalesce(sum(i.monto), 0) into v_pend
      from cobranza_items i join cobranzas b on b.id = i.cobranza_id where i.certificado_id = r.cert and not b.anulada and b.id <> v_id;
    if r.monto > v_pend + 0.005 then
      raise exception 'Al certificado N° % solo le faltan cobrar % (se quiso imputar %).', v_cert.numero, v_pend, r.monto;
    end if;
    insert into cobranza_items (cobranza_id, certificado_id, monto) values (v_id, r.cert, r.monto);
    v_total := v_total + r.monto;
  end loop;

  if v_total > round(p_monto, 2) + 0.005 then raise exception 'Lo imputado a certificados supera lo cobrado.'; end if;

  insert into caja_movimientos (fecha, tipo, concepto, monto, medio, cobranza_id, autor)
  values (p_fecha, 'ingreso', 'Cobranza N° ' || v_num || ' — ' || v_nombre, round(p_monto, 2), 'efectivo', v_id, p_autor);

  return v_id;
end $$;

create function anular_cobranza(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not puede_editar('clientes'::modulo_app) then raise exception 'No tenés permiso para anular cobranzas.'; end if;
  update cobranzas set anulada = true, anulada_en = now() where id = p_id and not anulada;
  if not found then raise exception 'La cobranza no existe o ya estaba anulada.'; end if;
  update caja_movimientos set anulado = true where cobranza_id = p_id;
end $$;

-- Saldo de la caja antes de un día (suma de todos los movimientos vigentes anteriores). Respeta el permiso de la caja.
create function caja_apertura(p_fecha date) returns numeric
language sql stable as $$
  select coalesce(sum(case tipo when 'ingreso' then monto else -monto end), 0)
  from caja_movimientos where fecha < p_fecha and not anulado
$$;

commit;
