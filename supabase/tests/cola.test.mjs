/* Migración 0019: cola de envío app → planillas. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { baseConStubs, aplicar, crearComo } from './helpers.mjs';

let db, como;
const OPER_V = '00000000-0000-0000-0000-0000000000e1'; // carga viajes
const OPER_C = '00000000-0000-0000-0000-0000000000e2'; // solo ve combustible
const q = (t, p) => db.query(t, p);

before(async () => {
  db = await baseConStubs();
  como = crearComo(db);
  await aplicar(db);
  for (const [id, m] of [[OPER_V, 'v'], [OPER_C, 'c']]) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${m}@test.com`]);
  await q("update profiles set rol = 'operador'");
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'viajes', 'escritura'), ($2, 'combustible', 'lectura')", [OPER_V, OPER_C]);
});

test('quien carga viajes puede dejar un viaje en la cola', async () => {
  await como(OPER_V, () => q("insert into sheet_cola (tipo, datos) values ('viaje', '{\"remito\":\"1\"}'::jsonb)"));
  assert.equal((await q('select count(*)::int n from sheet_cola')).rows[0].n, 1);
});

test('no puede dejar cargas de una sección donde no escribe', async () => {
  await assert.rejects(() => como(OPER_V, () => q("insert into sheet_cola (tipo, datos) values ('cheque', '{}'::jsonb)")), /row-level security|policy/i);
  await assert.rejects(() => como(OPER_C, () => q("insert into sheet_cola (tipo, datos) values ('combustible', '{}'::jsonb)")), /row-level security|policy/i);
});

test('los usuarios no pueden leer ni modificar la cola', async () => {
  assert.equal((await como(OPER_V, () => q('select * from sheet_cola'))).rows.length, 0);
  await como(OPER_V, () => q("update sheet_cola set enviado = now()"));
  assert.equal((await q('select count(*)::int n from sheet_cola where enviado is not null')).rows[0].n, 0);
});
