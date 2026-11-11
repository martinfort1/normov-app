/* Migración 0007: cada viaje tiene su ID; el remito y la fecha dejan de ser una clave única;
   los certificados comprueban "un viaje, un certificado" por el viaje mismo. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { baseConStubs, aplicar, crearComo } from './helpers.mjs';

let db, como, clienteId;
const ADMIN = '00000000-0000-0000-0000-0000000000b1';
const q = (texto, params) => db.query(texto, params);

before(async () => {
  db = await baseConStubs();
  como = crearComo(db);
  await aplicar(db, (m) => m < '0007');

  await q('insert into auth.users (id, email) values ($1, $2)', [ADMIN, 'admin@test.com']);
  await q("update profiles set rol = 'admin' where id = $1", [ADMIN]);
  clienteId = (await q("insert into clientes (razon_social) values ('CLIENTE UNO') returning id")).rows[0].id;
  // Antes de la migración: un viaje de la planilla y uno cargado desde la app
  await q(`insert into remitos (numero, fecha, cliente_id, cantidad, neto, total, origen) values ('500', '2026-10-01', $1, 6, 600, 600, 'planilla')`, [clienteId]);
  await q(`insert into remitos (numero, fecha, cliente_id, cantidad, neto, total, origen) values ('501', '2026-10-01', $1, 6, 600, 600, 'manual')`, [clienteId]);

  await aplicar(db, (m) => m >= '0007');
});

test('los viajes cargados desde la app reciben su ID (A…), los de la planilla esperan al sync', async () => {
  const r = await q("select numero, id_viaje from remitos order by numero");
  assert.equal(r.rows.find((x) => x.numero === '500').id_viaje, null, 'de la planilla: sin ID hasta que el sync lo reconozca');
  assert.equal(r.rows.find((x) => x.numero === '501').id_viaje, 'A000001');
});

test('un viaje nuevo sin ID recibe el siguiente (A000002…)', async () => {
  const r = await q(`insert into remitos (numero, fecha, cantidad) values ('502', '2026-10-02', 1) returning id_viaje`);
  assert.equal(r.rows[0].id_viaje, 'A000002');
  assert.equal((await q('select nuevo_id_viaje_app() as id')).rows[0].id, 'A000003');
});

test('dos viajes con el mismo remito y la misma fecha conviven; el ID, en cambio, no se repite', async () => {
  await q(`insert into remitos (id_viaje, numero, fecha, cantidad) values ('V000010', '9000', '2026-10-05', 6)`);
  await q(`insert into remitos (id_viaje, numero, fecha, cantidad) values ('V000011', '9000', '2026-10-05', 6)`);
  const n = (await q("select count(*)::int n from remitos where numero = '9000' and fecha = '2026-10-05'")).rows[0].n;
  assert.equal(n, 2);
  await assert.rejects(() => q(`insert into remitos (id_viaje, numero, fecha, cantidad) values ('V000010', '9001', '2026-10-06', 1)`), (e) => e.code === '23505');
});

test('certificados: los dos viajes de un mismo remito se certifican por separado, y cada viaje solo una vez', async () => {
  const ids = (await q("select id, id_viaje from remitos where numero = '9000' order by id_viaje")).rows;
  const item = (r) => [{ remito_id: r.id, remito_numero: '9000', fecha: '2026-10-05', cantidad: 6, precio: 100, total: 600, origen: 'planilla' }];
  const crear = (items) => q('select (crear_certificado($1, $2, $3, $4, $5, $6::jsonb)).id as id', [clienteId, '2026-10-01', '2026-10-31', 'm3', '2026-10-31', JSON.stringify(items)]);

  const c1 = (await crear(item(ids[0]))).rows[0].id;
  const c2 = (await crear(item(ids[1]))).rows[0].id;      // el otro viaje, mismo remito y fecha: se puede
  assert.notEqual(c1, c2);
  await assert.rejects(() => crear(item(ids[0])), (e) => e.code === '23505', 'el mismo viaje en otro certificado vigente: no');

  // la vista marca solo el viaje certificado
  const v = (await q("select id_viaje, cert_estado from v_remitos_estado where numero = '9000' order by id_viaje")).rows;
  assert.deepEqual(v.map((x) => x.cert_estado), ['pendiente', 'pendiente']);

  // anulado el primer certificado, ese viaje queda libre para otro
  await q("update certificados set estado = 'anulado' where id = $1", [c1]);
  const libre = (await q("select cert_estado from v_remitos_estado where id = $1", [ids[0].id])).rows[0].cert_estado;
  assert.equal(libre, null);
  await crear(item(ids[0]));
  // y vista por usuario (RLS): el admin la ve completa
  await como(ADMIN, async () => {
    assert.equal((await q("select count(*)::int n from v_remitos_estado where numero = '9000'")).rows[0].n, 2);
  });
});

test('remitos cargados a mano en un certificado (sin viaje en la base) siguen protegidos por número y fecha', async () => {
  const manual = JSON.stringify([{ remito_id: null, remito_numero: 'M-1', fecha: '2026-10-07', cantidad: 3, precio: 50, total: 150, origen: 'manual' }]);
  const crear = () => q('select (crear_certificado($1, $2, $3, $4, $5, $6::jsonb)).id as id', [clienteId, '2026-10-01', '2026-10-31', 'm3', '2026-10-31', manual]);
  await crear();
  await assert.rejects(crear, (e) => e.code === '23505');
});
