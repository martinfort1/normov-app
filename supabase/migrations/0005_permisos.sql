-- Permisos por usuario y por módulo (ninguno / lectura / escritura).
-- Reemplaza el esquema "lector / operador / admin" de las políticas RLS por uno más fino:
-- cada usuario tiene un nivel en cada módulo. El rol 'admin' lo puede todo; 'sin_acceso' no puede nada
-- (cuenta pendiente o desactivada). Los usuarios que ya existen conservan exactamente lo que tenían:
-- lector -> lectura en todo, operador -> lectura y escritura en todo.
-- Se corre una sola vez, después de 0001..0004. Todo o nada: si algo falla, no queda nada a medias.

begin;

create type nivel_permiso as enum ('ninguno', 'lectura', 'escritura');
create type modulo_app    as enum ('viajes', 'combustible', 'certificados', 'clientes', 'proveedores', 'cheques', 'sistema');

create table permisos (
  user_id uuid not null references profiles on delete cascade,
  modulo  modulo_app not null,
  nivel   nivel_permiso not null default 'ninguno',
  primary key (user_id, modulo)
);

-- ───────────── funciones ─────────────
create function nivel_en(m modulo_app) returns nivel_permiso
language sql stable security definer set search_path = public as $$
  select case rol_actual()
    when 'admin'      then 'escritura'::nivel_permiso
    when 'sin_acceso' then 'ninguno'::nivel_permiso
    else coalesce((select p.nivel from permisos p where p.user_id = auth.uid() and p.modulo = m), 'ninguno'::nivel_permiso)
  end
$$;

create function puede_ver(m modulo_app) returns boolean
language sql stable as $$ select nivel_en(m) in ('lectura', 'escritura') $$;

create function puede_editar(m modulo_app) returns boolean
language sql stable as $$ select nivel_en(m) = 'escritura' $$;

-- ¿Tiene acceso a algo? Los maestros (clientes, obras, materiales) se leen desde todas las pantallas.
create function tiene_acceso() returns boolean
language sql stable security definer set search_path = public as $$
  select case rol_actual()
    when 'admin'      then true
    when 'sin_acceso' then false
    else exists (select 1 from permisos where user_id = auth.uid() and nivel <> 'ninguno')
  end
$$;

-- ───────────── los usuarios de hoy conservan su acceso ─────────────
insert into permisos (user_id, modulo, nivel)
select p.id, m.modulo,
       case p.rol when 'operador' then 'escritura'::nivel_permiso else 'lectura'::nivel_permiso end
from profiles p
cross join (select unnest(enum_range(null::modulo_app)) as modulo) m
where p.rol in ('lector', 'operador');

-- ───────────── quién ve y quién cambia los permisos ─────────────
alter table permisos enable row level security;
create policy permisos_ver       on permisos for select using (user_id = auth.uid() or rol_actual() = 'admin');
create policy permisos_admin_ins on permisos for insert with check (rol_actual() = 'admin');
create policy permisos_admin_upd on permisos for update using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy permisos_admin_del on permisos for delete using (rol_actual() = 'admin');

-- ───────────── nuevas políticas por módulo ─────────────
do $$
declare
  r record;
  t text;
begin
  for r in select * from (values
      ('remitos', 'viajes'), ('precios', 'viajes'),
      ('cargas_combustible', 'combustible'), ('precios_combustible', 'combustible'),
      ('certificados', 'certificados'), ('certificado_items', 'certificados'),
      ('saldos_clientes_planilla', 'clientes'),
      ('proveedores', 'proveedores'), ('movimientos_proveedor', 'proveedores'),
      ('cheques', 'cheques')
    ) as v(tabla, modulo)
  loop
    execute format('drop policy if exists %I on %I', r.tabla || '_sel', r.tabla);
    execute format('drop policy if exists %I on %I', r.tabla || '_ins', r.tabla);
    execute format('drop policy if exists %I on %I', r.tabla || '_upd', r.tabla);
    execute format('drop policy if exists %I on %I', r.tabla || '_del', r.tabla);
    execute format('create policy %I on %I for select using ((select puede_ver(%L::modulo_app)))',
                   r.tabla || '_sel', r.tabla, r.modulo);
    execute format('create policy %I on %I for insert with check ((select puede_editar(%L::modulo_app)))',
                   r.tabla || '_ins', r.tabla, r.modulo);
    execute format('create policy %I on %I for update using ((select puede_editar(%L::modulo_app))) with check ((select puede_editar(%L::modulo_app)))',
                   r.tabla || '_upd', r.tabla, r.modulo, r.modulo);
    execute format('create policy %I on %I for delete using ((select puede_editar(%L::modulo_app)))',
                   r.tabla || '_del', r.tabla, r.modulo);
  end loop;

  -- Maestros: los lee cualquiera con acceso a algo; los cambia quien carga viajes, certificados o clientes.
  foreach t in array array['clientes', 'obras', 'materiales'] loop
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);
    execute format('create policy %I on %I for select using ((select tiene_acceso()))', t || '_sel', t);
    execute format('create policy %I on %I for insert with check ((select puede_editar(''viajes''::modulo_app) or puede_editar(''certificados''::modulo_app) or puede_editar(''clientes''::modulo_app)))', t || '_ins', t);
    execute format('create policy %I on %I for update using ((select puede_editar(''viajes''::modulo_app) or puede_editar(''certificados''::modulo_app) or puede_editar(''clientes''::modulo_app))) with check ((select puede_editar(''viajes''::modulo_app) or puede_editar(''certificados''::modulo_app) or puede_editar(''clientes''::modulo_app)))', t || '_upd', t);
    execute format('create policy %I on %I for delete using ((select puede_editar(''viajes''::modulo_app) or puede_editar(''certificados''::modulo_app) or puede_editar(''clientes''::modulo_app)))', t || '_del', t);
  end loop;
end $$;

drop policy if exists sync_log_sel on sync_log;
create policy sync_log_sel on sync_log for select using ((select puede_ver('sistema'::modulo_app)));

commit;
