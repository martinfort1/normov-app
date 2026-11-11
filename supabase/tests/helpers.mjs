/* Preparación común de las pruebas de la base: un Postgres en memoria (PGlite) que simula lo que Supabase ya trae
   (esquema auth, storage y roles) y ayudas para correr las migraciones y consultar como un usuario de la app. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
export const migraciones = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
export const sql = (f) => readFileSync(path.join(dir, f), 'utf8');

/** Crea la base y le agrega lo que Supabase trae de fábrica. Todavía sin ninguna migración. */
export async function baseConStubs() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

    -- Simula el almacenamiento de Supabase (storage.buckets, storage.objects y storage.foldername)
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language plpgsql as $$
      declare partes text[]; begin partes := string_to_array(name, '/'); return partes[1:array_length(partes, 1) - 1]; end $$;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
  `);
  return db;
}

/** Corre las migraciones cuyo nombre cumple el filtro, en orden. */
export async function aplicar(db, filtro = () => true) {
  for (const f of migraciones.filter(filtro)) await db.exec(sql(f));
}

/** Ejecuta consultas como un usuario de la app (rol authenticated, con RLS). */
export function crearComo(db) {
  return async (userId, fn) => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
}
