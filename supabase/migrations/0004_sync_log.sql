-- Registro de cada corrida de /api/sync, para ver el estado del sync sin entrar a Apps Script.
create table sync_log (
  id      bigint generated always as identity primary key,
  archivo text not null,
  ok      boolean not null,
  resumen text,
  error   text,
  creado  timestamptz not null default now()
);
create index sync_log_archivo_idx on sync_log (archivo, creado desc);

alter table sync_log enable row level security;
create policy sync_log_sel on sync_log for select using (puede_leer());
-- Solo /api/sync escribe acá, con la service role key (se salta RLS): no hace falta policy de insert.
