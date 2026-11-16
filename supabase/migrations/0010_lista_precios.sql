-- Lista de precios de venta por cliente, material y tipo (mayorista / minorista), con fecha de vigencia.
-- Alimenta el precio sugerido al cargar un viaje: el tipo sale de los m³ (hasta 12 = minorista, más de 12 = mayorista)
-- y se usa la lista vigente a la fecha del viaje. "GENERAL" es la lista para quien no tiene precio propio.
-- Los nombres se guardan como texto (igual que la hoja de la planilla): se comparan con la razón social o la obra del viaje.
-- Se corre una sola vez; trae cargada la lista actual (se puede volver a correr: no duplica).

begin;

create table if not exists lista_precios (
  id             uuid primary key default gen_random_uuid(),
  razon_social   text not null,                       -- cliente / razón social, o GENERAL
  material       text not null,
  tipo           text not null check (tipo in ('mayorista', 'minorista')),
  desde          date not null,
  precio_viaje6  numeric(14,2),                       -- precio del viaje de 6 m³ (minorista), solo informativo
  precio_m3      numeric(14,2) not null check (precio_m3 >= 0),
  unique (razon_social, material, tipo, desde)
);

alter table lista_precios enable row level security;
-- La ve cualquiera con acceso a algo (se usa al cargar viajes); la cambia el administrador o quien carga viajes.
drop policy if exists lista_precios_sel on lista_precios;
drop policy if exists lista_precios_ins on lista_precios;
drop policy if exists lista_precios_upd on lista_precios;
drop policy if exists lista_precios_del on lista_precios;
create policy lista_precios_sel on lista_precios for select using ((select tiene_acceso()));
create policy lista_precios_ins on lista_precios for insert with check ((select puede_editar('viajes'::modulo_app)));
create policy lista_precios_upd on lista_precios for update using ((select puede_editar('viajes'::modulo_app))) with check ((select puede_editar('viajes'::modulo_app)));
create policy lista_precios_del on lista_precios for delete using ((select puede_editar('viajes'::modulo_app)));

insert into lista_precios (razon_social, material, tipo, desde, precio_viaje6, precio_m3) values
  -- mayorista, vigente desde 01/01/2026
  ('DESARROLLOS URBANOS SRL', 'ARENA',       'mayorista', '2026-01-01', null, 18500),
  ('DESARROLLOS URBANOS SRL', '1 AL 3',      'mayorista', '2026-01-01', null, 33000),
  ('DESARROLLOS URBANOS SRL', 'BASE',        'mayorista', '2026-01-01', null, 18000),
  ('DESARROLLOS URBANOS SRL', 'BRUTO FINO',  'mayorista', '2026-01-01', null, 18500),
  ('DESARROLLOS URBANOS SRL', 'RECHAZO',     'mayorista', '2026-01-01', null, 18000),
  ('AVANCO', 'ARENA',      'mayorista', '2026-01-01', null, 18500),
  ('AVANCO', '1 AL 3',     'mayorista', '2026-01-01', null, 33000),
  ('AVANCO', 'BASE',       'mayorista', '2026-01-01', null, 18000),
  ('AVANCO', 'BRUTO FINO', 'mayorista', '2026-01-01', null, 18000),
  ('AVANCO', 'RECHAZO',    'mayorista', '2026-01-01', null, 18000),
  ('INGENIOS DE TUCUMAN SA', 'CENIZA',  'mayorista', '2026-01-01', null, 9200),
  ('INGENIOS DE TUCUMAN SA', 'RECHAZO', 'mayorista', '2026-01-01', null, 20000),
  ('MUNICIPALIDAD SMT', 'BASE',    'mayorista', '2026-01-01', null, 18000),
  ('MUNICIPALIDAD SMT', 'RECHAZO', 'mayorista', '2026-01-01', null, 16000),
  ('CAFELLI', 'BASE',       'mayorista', '2026-01-01', null, 15000),
  ('CAFELLI', 'BRUTO FINO', 'mayorista', '2026-01-01', null, 15000),
  ('CAFELLI', 'RECHAZO',    'mayorista', '2026-01-01', null, 15000),
  ('IGMA CONSTRUCCIONES', 'ARENA',   'mayorista', '2026-01-01', null, 18500),
  ('IGMA CONSTRUCCIONES', 'BASE',    'mayorista', '2026-01-01', null, 18000),
  ('IGMA CONSTRUCCIONES', 'RECHAZO', 'mayorista', '2026-01-01', null, 15000),
  ('PINELLO', 'BASE',       'mayorista', '2026-01-01', null, 17000),
  ('PINELLO', 'BRUTO FINO', 'mayorista', '2026-01-01', null, 17000),
  ('CARLOS MELIAN', 'BASE', 'mayorista', '2026-01-01', null, 17700),
  ('KRAN', 'ARENA',   'mayorista', '2026-01-01', null, 18500),
  ('KRAN', '1 AL 3',  'mayorista', '2026-01-01', null, 33000),
  ('KRAN', 'BASE',    'mayorista', '2026-01-01', null, 18000),
  ('KRAN', 'RECHAZO', 'mayorista', '2026-01-01', null, 20000),
  ('GERONIMO PADILLA', 'BASE', 'mayorista', '2026-01-01', null, 18000),
  ('GONZALO REMIS', 'ARENA',  'mayorista', '2026-01-01', 0, 0),
  ('GONZALO REMIS', '1 AL 3', 'mayorista', '2026-01-01', 0, 0),
  -- minorista, vigente desde 01/01/2026 (precio del viaje de 6 m³ y por m³)
  ('GENERAL', 'ARENA',              'minorista', '2026-01-01', 150000, 25000),
  ('GENERAL', '1 AL 3',             'minorista', '2026-01-01', 220000, 36666.67),
  ('GENERAL', 'BASE',               'minorista', '2026-01-01', 150000, 25000),
  ('GENERAL', 'ARENA Y BRUTO FINO', 'minorista', '2026-01-01', 150000, 25000),
  ('GENERAL', 'BRUTO FINO',         'minorista', '2026-01-01', 150000, 25000),
  ('GENERAL', 'RECHAZO',            'minorista', '2026-01-01', 150000, 25000),
  ('GENERAL', 'PIEDRA BOLA',        'minorista', '2026-01-01', 200000, 33333.33),
  ('GENERAL', 'TIERRA',             'minorista', '2026-01-01', 140000, 23333.33),
  ('ALTIVO', '1 AL 3',  'minorista', '2026-01-01', 220000, 36666.67),
  ('ALTIVO', 'BASE',    'minorista', '2026-01-01', 150000, 25000),
  ('ALTIVO', 'RECHAZO', 'minorista', '2026-01-01', 150000, 25000),
  ('ALTIVO', 'TIERRA',  'minorista', '2026-01-01', 140000, 23333.33),
  ('ALEJANDRO DEVANI', '1 AL 3',  'minorista', '2026-01-01', 220000, 36666.67),
  ('ALEJANDRO DEVANI', 'BASE',    'minorista', '2026-01-01', 150000, 25000),
  ('ALEJANDRO DEVANI', 'RECHAZO', 'minorista', '2026-01-01', 150000, 25000),
  ('ALEJANDRO DEVANI', 'TIERRA',  'minorista', '2026-01-01', 140000, 23333.33),
  ('AVANCO', '1 AL 3', 'minorista', '2026-01-01', 220000, 36666.67),
  ('AVANCO', 'BASE',   'minorista', '2026-01-01', 150000, 25000),
  ('KRAN', '1 AL 3', 'minorista', '2026-01-01', 220000, 36666.67),
  ('KRAN', 'BASE',   'minorista', '2026-01-01', 150000, 18000),
  ('IGMA CONSTRUCCIONES', 'PIEDRA BOLA', 'minorista', '2026-01-01', 150000, 25000),
  ('FELIPE MORALES',   'TIERRA', 'minorista', '2026-01-01', 120000, 20000),
  ('SANTIAGO RETONDO', 'TIERRA', 'minorista', '2026-01-01', 120000, 20000),
  ('GONZALO REMIS', 'ARENA',  'minorista', '2026-01-01', 0, 0),
  ('GONZALO REMIS', '1 AL 3', 'minorista', '2026-01-01', 0, 0),
  -- actualizaciones posteriores
  ('AVANCO', 'ARENA', 'mayorista', '2026-10-15', null, 20000),
  ('AVANCO', 'BASE',  'mayorista', '2026-10-15', null, 19500),
  ('DESARROLLOS URBANOS SRL', '1 AL 3',  'minorista', '2026-10-27', 220000, 36666.67),
  ('DESARROLLOS URBANOS SRL', 'ARENA',   'minorista', '2026-10-27', 160000, 26666.67),
  ('DESARROLLOS URBANOS SRL', 'BASE',    'minorista', '2026-10-27', 160000, 26666.67),
  ('DESARROLLOS URBANOS SRL', 'RECHAZO', 'minorista', '2026-10-27', 160000, 26666.67),
  ('DESARROLLOS URBANOS SRL', 'ARENA',   'mayorista', '2026-10-27', null, 20000),
  ('DESARROLLOS URBANOS SRL', 'BASE',    'mayorista', '2026-10-27', null, 19500),
  ('MUNICIPALIDAD SMT', 'BASE', 'minorista', '2026-11-01', 18000, 18000),
  ('MUNICIPALIDAD SMT', 'BASE', 'mayorista', '2026-11-01', 18000, 18000),
  ('TOTO SCHUJMAN', 'BASE',    'mayorista', '2026-11-04', null, 20000),
  ('TOTO SCHUJMAN', 'RECHAZO', 'mayorista', '2026-11-04', null, 20000),
  ('GENERAL', 'TRITURADO',  'mayorista', '2026-11-04', null, 48000),
  ('GENERAL', 'BRUTO FINO', 'mayorista', '2026-11-04', null, 20000),
  ('DESARROLLOS URBANOS SRL', 'TRITURADO', 'minorista', '2026-11-04', null, 48000)
on conflict (razon_social, material, tipo, desde) do nothing;

commit;
