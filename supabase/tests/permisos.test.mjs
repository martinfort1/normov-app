/* Prueba las migraciones y los permisos contra un Postgres real (PGlite, en memoria).
   Uso:  cd supabase/tests && npm install && npm test
   No toca ninguna base real. Simula a Supabase con un esquema "auth" mínimo. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migraciones = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const sql = (f) => readFileSync(path.join(dir, f), 'utf8');

const db = new PGlite();
const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  lector: '00000000-0000-0000-0000-0000000000a2',   // legacy: rol lector
  operador: '00000000-0000-0000-0000-0000000000a3', // legacy: rol operador
  viajes: '00000000-0000-0000-0000-0000000000a4',   // nuevo: escritura solo en viajes
  pendiente: '00000000-0000-0000-0000-0000000000a5',// sin_acceso
  cert: '00000000-0000-0000-0000-0000000000a6',     // escritura en certificados, lectura en viajes
};
let clienteId;

/** Ejecuta consultas como un usuario de la app (rol authenticated, con RLS). */
async function como(userId, fn) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = (texto, params) => db.query(texto, params);

before(async () => {
  // Simula lo que Supabase ya trae: esquema auth, auth.uid() y los roles.
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

  // Esquema tal como estaba antes de los permisos (0001..0004)
  for (const f of migraciones.filter((m) => m < '0005')) await db.exec(sql(f));

  // Usuarios que YA existían, con los roles viejos
  for (const [k, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${k}@test.com`]);
  await db.exec(`
    update profiles set rol = 'admin'    where email = 'admin@test.com';
    update profiles set rol = 'lector'   where email = 'lector@test.com';
    update profiles set rol = 'operador' where email = 'operador@test.com';
    update profiles set rol = 'operador' where email in ('viajes@test.com', 'cert@test.com');
  `);

  // Datos de ejemplo (como superusuario, sin RLS)
  const c = await q("insert into clientes (razon_social) values ('CLIENTE UNO') returning id");
  clienteId = c.rows[0].id;
  await q(`insert into remitos (numero, fecha, cliente_id, cantidad, precio, total, neto) values ('100', '2026-09-01', $1, 10, 100, 1000, 1000)`, [clienteId]);
  await q("insert into proveedores (nombre) values ('PROV 1')");
  await q("insert into cheques (tipo, monto, vencimiento) values ('Propio', 500, '2026-12-01')");
  await q("insert into saldos_clientes_planilla (fuente, nombre, ventas, cobranzas, saldo) values ('cta_clientes', 'CLIENTE UNO', 1000, 0, 1000)");
  await q("insert into sync_log (archivo, ok) values ('planilla', true)");

  // Ahora la migración nueva
  for (const f of migraciones.filter((m) => m >= '0005')) await db.exec(sql(f));

  // Permisos finos para los usuarios nuevos
  await q("update profiles set rol = 'operador' where id = $1", [U.viajes]);
  await q("delete from permisos where user_id in ($1, $2)", [U.viajes, U.cert]);
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'viajes', 'escritura')", [U.viajes]);
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'certificados', 'escritura'), ($1, 'viajes', 'lectura')", [U.cert]);
});

test('los usuarios que ya existían conservan su acceso (lector: lectura, operador: escritura)', async () => {
  const lec = await q('select count(*)::int n, bool_and(nivel = $2) ok from permisos where user_id = $1', [U.lector, 'lectura']);
  assert.equal(lec.rows[0].n, 7); assert.equal(lec.rows[0].ok, true);
  const ope = await q('select count(*)::int n, bool_and(nivel = $2) ok from permisos where user_id = $1', [U.operador, 'escritura']);
  assert.equal(ope.rows[0].n, 7); assert.equal(ope.rows[0].ok, true);
  const adm = await q('select count(*)::int n from permisos where user_id = $1', [U.admin]);
  assert.equal(adm.rows[0].n, 0, 'el admin no necesita filas: entra por su rol');
});

test('admin: ve todo y puede escribir', async () => {
  await como(U.admin, async () => {
    for (const t of ['remitos', 'cheques', 'proveedores', 'saldos_clientes_planilla', 'sync_log', 'clientes'])
      assert.equal((await q(`select count(*)::int n from ${t}`)).rows[0].n, 1, t);
    await q(`insert into remitos (numero, fecha, cantidad) values ('101', '2026-09-02', 5)`);
  });
});

test('lector (legacy): ve pero no escribe', async () => {
  await como(U.lector, async () => {
    assert.equal((await q('select count(*)::int n from remitos')).rows[0].n, 2);
    await assert.rejects(() => q(`insert into remitos (numero, fecha, cantidad) values ('102', '2026-09-03', 1)`), (e) => e.code === '42501');
    assert.equal((await q("update remitos set chofer = 'X' returning id")).rows.length, 0, 'no debe poder modificar');
    assert.equal((await q("delete from cheques returning id")).rows.length, 0, 'no debe poder borrar');
  });
});

test('operador (legacy): ve y escribe en todo', async () => {
  await como(U.operador, async () => {
    await q(`insert into cheques (tipo, monto, vencimiento) values ('Tercero', 700, '2026-12-05')`);
    assert.equal((await q('select count(*)::int n from cheques')).rows[0].n, 2);
  });
});

test('usuario con escritura solo en viajes: carga remitos pero no ve cheques ni proveedores', async () => {
  await como(U.viajes, async () => {
    await q(`insert into remitos (numero, fecha, cantidad) values ('103', '2026-09-04', 2)`);
    assert.equal((await q('select count(*)::int n from cheques')).rows[0].n, 0);
    assert.equal((await q('select count(*)::int n from proveedores')).rows[0].n, 0);
    assert.equal((await q('select count(*)::int n from sync_log')).rows[0].n, 0);
    await assert.rejects(() => q(`insert into cheques (tipo, monto) values ('Propio', 1)`), (e) => e.code === '42501');
    // los maestros se leen para poder cargar viajes
    assert.equal((await q('select count(*)::int n from clientes')).rows[0].n, 1);
  });
});

test('cuenta pendiente (sin_acceso): no ve nada, ni los maestros', async () => {
  await como(U.pendiente, async () => {
    for (const t of ['remitos', 'cheques', 'proveedores', 'clientes', 'sync_log', 'saldos_clientes_planilla'])
      assert.equal((await q(`select count(*)::int n from ${t}`)).rows[0].n, 0, t);
    await assert.rejects(() => q(`insert into remitos (numero, fecha, cantidad) values ('104', '2026-09-05', 1)`), (e) => e.code === '42501');
  });
});

test('permisos: cada uno ve los suyos, solo el admin los cambia', async () => {
  await como(U.viajes, async () => {
    const propios = await q('select user_id from permisos');
    assert.ok(propios.rows.every((r) => r.user_id === U.viajes), 'solo ve las filas propias');
    await assert.rejects(() => q(`insert into permisos (user_id, modulo, nivel) values ($1, 'cheques', 'escritura')`, [U.viajes]), (e) => e.code === '42501');
    assert.equal((await q("update permisos set nivel = 'escritura' returning user_id")).rows.length, 0);
  });
  await como(U.admin, async () => {
    await q(`insert into permisos (user_id, modulo, nivel) values ($1, 'cheques', 'lectura') on conflict (user_id, modulo) do update set nivel = excluded.nivel`, [U.viajes]);
  });
  await como(U.viajes, async () => {
    assert.equal((await q('select count(*)::int n from cheques')).rows[0].n, 2, 'al darle lectura en cheques, los ve');
  });
});

test('certificados: crear requiere escritura en certificados; aprobar, ser admin', async () => {
  const item = JSON.stringify([{ remito_id: null, remito_numero: '100', fecha: '2026-09-01', cantidad: 10, precio: 100, total: 1000, origen: 'planilla' }]);
  // solo lectura en certificados: no puede
  await como(U.lector, async () => {
    await assert.rejects(() => q('select crear_certificado($1, $2, $3, $4, $5, $6::jsonb)', [clienteId, '2026-09-01', '2026-09-30', 'm3', '2026-09-30', item]), (e) => e.code === '42501');
  });
  // escritura en certificados: crea el certificado pendiente
  let certId;
  await como(U.cert, async () => {
    const r = await q('select (crear_certificado($1, $2, $3, $4, $5, $6::jsonb)).id as id', [clienteId, '2026-09-01', '2026-09-30', 'm3', '2026-09-30', item]);
    certId = r.rows[0].id;
    // pero no puede aprobarlo
    await assert.rejects(() => q("update certificados set estado = 'aprobado' where id = $1", [certId]), /administrador/i);
  });
  await como(U.admin, async () => {
    await q("update certificados set estado = 'aprobado' where id = $1", [certId]);
    assert.equal((await q('select estado from certificados where id = $1', [certId])).rows[0].estado, 'aprobado');
  });
  // sin permiso en certificados no ve ni la lista
  await como(U.viajes, async () => {
    assert.equal((await q('select count(*)::int n from certificados')).rows[0].n, 0);
  });
});

test('adjuntos: ver y subir según el permiso de la sección de la carpeta', async () => {
  const subir = (nombre) => q("insert into storage.objects (bucket_id, name) values ('adjuntos', $1)", [nombre]);
  const cuantos = async () => (await q("select count(*)::int n from storage.objects where bucket_id = 'adjuntos'")).rows[0].n;

  // quien carga viajes sube a viajes/, no a cheques/
  await como(U.viajes, async () => {
    await subir('viajes/2026-09/foto1.jpg');
    await assert.rejects(() => subir('cheques/2026-09/foto2.jpg'), (e) => e.code === '42501');
    await assert.rejects(() => subir('carpeta-inventada/x.jpg'), (e) => e.code === '42501', 'una carpeta que no es una sección no se acepta');
  });
  // el admin sube a cheques/
  await como(U.admin, async () => { await subir('cheques/2026-09/foto2.jpg'); });

  // sin permiso en cheques, el de viajes ve su adjunto pero no el de cheques/
  await q("delete from permisos where user_id = $1 and modulo = 'cheques'", [U.viajes]);
  await como(U.viajes, async () => {
    const r = await q("select name from storage.objects where bucket_id = 'adjuntos' order by name");
    assert.deepEqual(r.rows.map((x) => x.name), ['viajes/2026-09/foto1.jpg']);
  });
  // el lector (legacy) puede ver todo pero no subir
  await como(U.lector, async () => {
    assert.equal(await cuantos(), 2);
    await assert.rejects(() => subir('viajes/2026-09/otra.jpg'), (e) => e.code === '42501');
  });
  // la cuenta pendiente no ve nada
  await como(U.pendiente, async () => { assert.equal(await cuantos(), 0); });
  // borrar: solo quien puede cargar en esa sección
  await como(U.lector, async () => {
    assert.equal((await q("delete from storage.objects where name like 'viajes/%' returning id")).rows.length, 0);
  });
  await como(U.viajes, async () => {
    assert.equal((await q("delete from storage.objects where name like 'viajes/%' returning id")).rows.length, 1);
  });
});

test('registros cargados desde la app guardan autor, origen y adjunto', async () => {
  await como(U.operador, async () => {
    await q(`insert into cargas_combustible (fecha, patente, es_camion, litros, origen, autor, foto_path, precio_litro, source_hash)
             values ('2026-09-10', 'AB123CD', true, 100, 'app', 'Operador Test', 'combustible/2026-09/a.jpg', 1500.5, 'h1')`);
    await q(`insert into movimientos_proveedor (proveedor_id, fecha, debe, fecha_pago, origen, foto_path, source_hash)
             select id, '2026-09-10', 1000, '2026-10-10', 'app', 'proveedores/2026-09/b.jpg', 'h2' from proveedores limit 1`);
    await q(`insert into cheques (tipo, monto, cuit, origen, foto_path, source_hash) values ('Tercero', 10, '20-1-3', 'app', 'cheques/2026-09/c.jpg', 'h3')`);
    const c = await q("select origen, autor, precio_litro from cargas_combustible where source_hash = 'h1'");
    assert.equal(c.rows[0].origen, 'app'); assert.equal(c.rows[0].autor, 'Operador Test'); assert.equal(Number(c.rows[0].precio_litro), 1500.5);
  });
  // las filas que vienen de la planilla quedan con origen 'planilla' por defecto
  const r = await q("select origen from cheques where monto = 500");
  assert.equal(r.rows[0].origen, 'planilla');
});

test('un remito no puede estar en dos certificados vigentes', async () => {
  const item = JSON.stringify([{ remito_id: null, remito_numero: '100', fecha: '2026-09-01', cantidad: 10, precio: 100, total: 1000, origen: 'planilla' }]);
  await como(U.cert, async () => {
    await assert.rejects(() => q('select crear_certificado($1, $2, $3, $4, $5, $6::jsonb)', [clienteId, '2026-09-01', '2026-09-30', 'm3', '2026-09-30', item]), (e) => e.code === '23505');
  });
});
