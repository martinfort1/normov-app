-- Planeación por segmento (minorista / mayorista) y lista de costos por cantera.
-- Requiere 0010 (lista de precios), 0012 (planeación) y 0009 (pedidos). Se puede volver a correr: no duplica.
--
-- · pedidos.segmento: 'minorista' (viajes de hasta 12 m³) o 'mayorista' (más de 12 m³). Los pedidos que ya existen
--   se clasifican por su material más grande; después se puede cambiar a mano en el pedido.
-- · camiones.solo_mayorista: camión grande que no hace viajes de pedidos minoristas (los chicos hacen de los dos tipos).
-- · lista_costos: costo por m³ de cada material en cada cantera, con vigencia (hoja PRECIOS COSTO de la planilla).
--   Sugiere el costo al cargar un viaje, igual que lista_precios sugiere el precio de venta.

begin;

do $$
begin
  if to_regclass('public.camiones') is null then raise exception 'Falta correr antes 0012_planeacion.sql.'; end if;
  if to_regclass('public.lista_precios') is null then raise exception 'Falta correr antes 0010_lista_precios.sql.'; end if;
end $$;

alter table camiones add column if not exists solo_mayorista boolean not null default false;
-- Una versión anterior de esta migración creaba "solo_minorista" (regla al revés): se descarta si quedó
alter table camiones drop column if exists solo_minorista;

alter table pedidos add column if not exists segmento text not null default 'minorista';
alter table pedidos drop constraint if exists pedidos_segmento_check;
alter table pedidos add constraint pedidos_segmento_check check (segmento in ('minorista', 'mayorista'));
-- Clasificación inicial de los pedidos existentes (solo los que todavía están en el valor por defecto)
update pedidos p set segmento = 'mayorista'
where p.segmento = 'minorista' and exists (select 1 from pedido_items i where i.pedido_id = p.id and i.cantidad > 12);

-- ───────────── costos por cantera ─────────────
create table if not exists lista_costos (
  id        uuid primary key default gen_random_uuid(),
  cantera   text not null,
  material  text not null,
  desde     date not null,
  costo_m3  numeric(14,2) not null check (costo_m3 >= 0),
  unique (cantera, material, desde)
);

alter table lista_costos enable row level security;
drop policy if exists lista_costos_sel on lista_costos;
drop policy if exists lista_costos_ins on lista_costos;
drop policy if exists lista_costos_upd on lista_costos;
drop policy if exists lista_costos_del on lista_costos;
create policy lista_costos_sel on lista_costos for select using ((select puede_ver('viajes'::modulo_app)));
create policy lista_costos_ins on lista_costos for insert with check ((select puede_editar('viajes'::modulo_app)));
create policy lista_costos_upd on lista_costos for update using ((select puede_editar('viajes'::modulo_app))) with check ((select puede_editar('viajes'::modulo_app)));
create policy lista_costos_del on lista_costos for delete using ((select puede_editar('viajes'::modulo_app)));

insert into lista_costos (cantera, material, desde, costo_m3) values
  ('HARO', 'ARENA', '2026-01-01', 16000), ('SYNBUILD', 'ARENA', '2026-01-01', 10500), ('CACIQUE', 'ARENA', '2026-01-01', 10000),
  ('JACOUB', 'ARENA', '2026-01-01', 10000), ('D ARIDOS', 'ARENA', '2026-01-01', 10000), ('SAN JOSE', 'ARENA', '2026-01-01', 15000),
  ('SYNBUILD', '1 AL 3', '2026-01-01', 16000), ('CACIQUE', '1 AL 3', '2026-01-01', 21000), ('D ARIDOS', '1 AL 3', '2026-01-01', 21000),
  ('SAN JOSE', '1 AL 3', '2026-01-01', 28000),
  ('HARO', 'BASE', '2026-01-01', 16000), ('CACIQUE', 'BASE', '2026-01-01', 10000), ('MOYANO', 'BASE', '2026-01-01', 9000),
  ('SAN JOSE', 'BASE', '2026-01-01', 13000), ('GOMEZ', 'BASE', '2026-01-01', 10000), ('TIPAS', 'BASE', '2026-01-01', 2445),
  ('GARAY', 'BASE', '2026-01-01', 10000),
  ('HARO', 'BRUTO FINO', '2026-01-01', 16000), ('SYNBUILD', 'BRUTO FINO', '2026-01-01', 10000), ('CACIQUE', 'BRUTO FINO', '2026-01-01', 11000),
  ('MOYANO', 'BRUTO FINO', '2026-01-01', 11500), ('SAN JOSE', 'BRUTO FINO', '2026-01-01', 13000),
  ('HARO', 'RECHAZO', '2026-01-01', 16000), ('CACIQUE', 'RECHAZO', '2026-01-01', 10000), ('MOYANO', 'RECHAZO', '2026-01-01', 9000),
  ('GOMEZ', 'RECHAZO', '2026-01-01', 10000), ('TIPAS', 'RECHAZO', '2026-01-01', 2445),
  ('SAN JOSE', 'ARENA Y 1 AL 3', '2026-01-01', 18000), ('CACIQUE', 'TRITURADO', '2026-01-01', 21000), ('SAN JOSE', 'TRITURADO', '2026-01-01', 18000),
  ('CACIQUE', 'PIEDRA BOLA', '2026-01-01', 10000), ('INGENIO', 'CENIZA', '2026-01-01', 3000), ('INGENIO', 'RECHAZO', '2026-01-01', 10000),
  ('GARAY', 'PIEDRA BOLA', '2026-01-01', 10000), ('CACIQUE', 'GRANZA', '2026-01-01', 28372),
  ('MOYANO', 'BASE', '2026-11-01', 11000)
on conflict (cantera, material, desde) do nothing;

-- Precio de venta cargado en la hoja después de la lista inicial
insert into lista_precios (razon_social, material, tipo, desde, precio_viaje6, precio_m3) values
  ('CARLOS MELIAN', 'BASE', 'mayorista', '2026-10-10', null, 19000),
  ('CARLOS MELIAN', 'BASE', 'minorista', '2026-10-10', null, 19000)
on conflict (razon_social, material, tipo, desde) do nothing;

commit;
