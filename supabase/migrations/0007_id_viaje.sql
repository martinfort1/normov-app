-- Cada viaje tiene su propio ID, además del número de remito.
-- Hasta ahora un viaje se identificaba por (número de remito, fecha): si dos viajes compartían las dos cosas,
-- la base guardaba uno solo y perdía el otro. Ahora la identidad es el ID del viaje:
--   * los viajes que vienen de la planilla usan su columna ID VIAJE (V000002, V000003…),
--   * los que se cargan desde la app reciben uno propio con otra letra (A000001, A000002…) para no chocar
--     con los que asigna el script de la planilla mientras siga en uso.
-- El número de remito y la fecha pasan a ser datos comunes (la app avisa si hay repetidos, pero no lo impide).
-- Los certificados pasan a comprobar "un viaje no puede estar en dos certificados" por el viaje mismo.
-- Se corre una sola vez, después de 0006. Todo o nada.

begin;

do $$
begin
  if to_regclass('public.permisos') is null then
    raise exception 'Falta correr antes 0005_permisos.sql (y 0006_cargar.sql).';
  end if;
end $$;

-- ───────────── ID de viaje ─────────────
alter table remitos add column id_viaje text;
alter table remitos add constraint remitos_id_viaje_key unique (id_viaje);

create sequence viaje_app_seq;
create function nuevo_id_viaje_app() returns text
language sql as $$ select 'A' || lpad(nextval('viaje_app_seq')::text, 6, '0') $$;
-- Todo viaje que se inserte sin ID (desde la app, o a mano) recibe uno propio.
alter table remitos alter column id_viaje set default nuevo_id_viaje_app();

-- Los viajes ya cargados desde la app reciben su ID. Los de la planilla quedan sin ID hasta que el sync
-- los reconozca y les ponga el de la planilla (así no se duplican).
update remitos set id_viaje = nuevo_id_viaje_app() where origen = 'manual' and id_viaje is null;

-- ───────────── (número, fecha) deja de ser una clave única ─────────────
alter table remitos drop constraint remitos_numero_fecha_key;
create index remitos_numero_fecha_idx on remitos (numero, fecha);   -- para avisar de repetidos

-- ───────────── certificados: un viaje, un certificado ─────────────
drop index certificado_items_remito_activo;
-- viajes de la base: por el viaje mismo (dos viajes con el mismo remito y fecha se pueden certificar por separado)
create unique index certificado_items_viaje_activo on certificado_items (remito_id) where cert_activo and remito_id is not null;
-- remitos cargados a mano en el certificado (sin viaje en la base): como antes, por número y fecha
create unique index certificado_items_manual_activo on certificado_items (remito_numero, fecha) where cert_activo and remito_id is null;

-- La vista une cada viaje con el certificado vigente que lo contiene, ahora por el viaje.
drop view v_remitos_estado;
create view v_remitos_estado with (security_invoker = true) as
select r.*, ci.certificado_id, c.numero as cert_numero, c.estado as cert_estado
from remitos r
left join certificado_items ci on ci.remito_id = r.id and ci.cert_activo
left join certificados c on c.id = ci.certificado_id;

commit;
