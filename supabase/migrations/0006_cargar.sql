-- Carga de datos desde la app: columnas que faltaban respecto de las planillas, quién cargó cada registro,
-- y almacenamiento de adjuntos (fotos de remitos, comprobantes) con permisos por sección.
-- Se corre una sola vez, después de 0005. Todo o nada.

begin;

do $$
begin
  if to_regclass('public.permisos') is null then
    raise exception 'Falta correr antes 0005_permisos.sql. Ejecutala y después volvé a correr esta (0006).';
  end if;
end $$;

-- ───────────── quién cargó, de dónde viene y adjunto ─────────────
-- origen: 'planilla' (sync o Excel) o 'app' (formulario). Solo lo cargado desde la app se puede anular desde la app.
-- autor: nombre de quien cargó, guardado tal cual para que lo vea cualquiera (los perfiles de otros no son visibles).
alter table remitos
  add column creado_por uuid references profiles on delete set null,
  add column autor text;

alter table cargas_combustible
  add column precio_litro numeric(12,2),
  add column foto_path text,
  add column origen text not null default 'planilla',
  add column creado_por uuid references profiles on delete set null,
  add column autor text,
  add column creado timestamptz not null default now();

alter table movimientos_proveedor
  add column fecha_pago date,                     -- "Fecha Cobro/Pago": el día que la plata sale de verdad
  add column foto_path text,
  add column origen text not null default 'planilla',
  add column creado_por uuid references profiles on delete set null,
  add column autor text,
  add column creado timestamptz not null default now();

alter table cheques
  add column cuit text,
  add column foto_path text,
  add column origen text not null default 'planilla',
  add column creado_por uuid references profiles on delete set null,
  add column autor text,
  add column creado timestamptz not null default now();

-- ───────────── adjuntos ─────────────
-- Una carpeta por sección dentro del bucket: viajes/, combustible/, proveedores/, cheques/ ...
-- Ver un adjunto requiere poder ver esa sección; subirlo o borrarlo, poder cargar en ella.
create function puede_ver_carpeta(carpeta text) returns boolean
language sql stable as $$
  select exists (select 1 from unnest(enum_range(null::modulo_app)) m where m::text = carpeta and puede_ver(m))
$$;

create function puede_editar_carpeta(carpeta text) returns boolean
language sql stable as $$
  select exists (select 1 from unnest(enum_range(null::modulo_app)) m where m::text = carpeta and puede_editar(m))
$$;

insert into storage.buckets (id, name, public) values ('adjuntos', 'adjuntos', false) on conflict (id) do nothing;

create policy adjuntos_ver on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and puede_ver_carpeta((storage.foldername(name))[1]));
create policy adjuntos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and puede_editar_carpeta((storage.foldername(name))[1]));
create policy adjuntos_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'adjuntos' and puede_editar_carpeta((storage.foldername(name))[1]))
  with check (bucket_id = 'adjuntos' and puede_editar_carpeta((storage.foldername(name))[1]));
create policy adjuntos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'adjuntos' and puede_editar_carpeta((storage.foldername(name))[1]));

commit;
