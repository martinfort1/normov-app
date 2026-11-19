-- Cola de envío app → planillas. Cada carga hecha desde la app (viaje, combustible, movimiento de proveedor, cheque)
-- deja una fila acá; un Apps Script instalado en la Planilla NORMOV 2026 las busca por /api/sync/cola, las escribe en la
-- hoja que corresponde y las marca como enviadas. Si la planilla falla, la fila queda con el error y se reintenta.
create table if not exists sheet_cola (
  id        bigint generated always as identity primary key,
  tipo      text not null check (tipo in ('viaje', 'combustible', 'proveedor', 'cheque')),
  datos     jsonb not null,
  creado    timestamptz not null default now(),
  enviado   timestamptz,
  intentos  integer not null default 0,
  error     text
);
create index if not exists sheet_cola_pendientes_idx on sheet_cola (id) where enviado is null;

alter table sheet_cola enable row level security;

-- Quien puede cargar en una sección puede dejar su carga en la cola. Leer y marcar como enviada lo hace solo el servidor
-- (service role, desde /api/sync/cola): ningún usuario ve ni toca la cola.
drop policy if exists sheet_cola_insert on sheet_cola;
create policy sheet_cola_insert on sheet_cola for insert to authenticated
  with check (
    case tipo
      when 'viaje'       then puede_editar('viajes'::modulo_app)
      when 'combustible' then puede_editar('combustible'::modulo_app)
      when 'proveedor'   then puede_editar('proveedores'::modulo_app)
      when 'cheque'      then puede_editar('cheques'::modulo_app)
      else false
    end
  );
