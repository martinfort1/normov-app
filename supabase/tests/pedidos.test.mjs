/* Migraciones 0008 y 0009: módulo Pedidos (permisos, avance por material, vínculo con viajes). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { baseConStubs, aplicar, crearComo } from './helpers.mjs';

let db, como, cliente, obra, arena, piedra, pedidoId;
const ADMIN = '00000000-0000-0000-0000-0000000000c1';
const HEREDA = '00000000-0000-0000-0000-0000000000c2';   // ya existía, con Viajes "Ver y cargar"
const SOLO_VER = '00000000-0000-0000-0000-0000000000c3'; // Pedidos solo ver
const CARGA = '00000000-0000-0000-0000-0000000000c4';    // Pedidos ver y cargar, sin Viajes
const CARGA_V = '00000000-0000-0000-0000-0000000000c5';  // Pedidos ver y cargar + Viajes solo ver
const q = (texto, params) => db.query(texto, params);

before(async () => {
  db = await baseConStubs();
  como = crearComo(db);
  await aplicar(db, (m) => m < '0008');

  for (const [id, mail] of [[ADMIN, 'a'], [HEREDA, 'h'], [SOLO_VER, 'v'], [CARGA, 'c'], [CARGA_V, 'cv']]) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${mail}@test.com`]);
  await q("update profiles set rol = 'admin' where id = $1", [ADMIN]);
  await q("update profiles set rol = 'operador' where id <> $1", [ADMIN]);
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'viajes', 'escritura')", [HEREDA]);

  await aplicar(db, (m) => m >= '0008');

  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'pedidos', 'lectura')", [SOLO_VER]);
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'pedidos', 'escritura')", [CARGA]);
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'pedidos', 'escritura'), ($1, 'viajes', 'lectura')", [CARGA_V]);

  cliente = (await q("insert into clientes (razon_social) values ('CLIENTE UNO') returning id")).rows[0].id;
  obra = (await q("insert into obras (cliente_id, nombre) values ($1, 'OBRA 1') returning id", [cliente])).rows[0].id;
  arena = (await q("insert into materiales (nombre) values ('ARENA') returning id")).rows[0].id;
  piedra = (await q("insert into materiales (nombre) values ('PIEDRA') returning id")).rows[0].id;
});

const items = () => JSON.stringify([{ material_id: arena, cantidad: 30 }, { material_id: piedra, cantidad: 12 }]);
const remito = async (n, material, cant) =>
  (await q(`insert into remitos (numero, fecha, cliente_id, obra_id, material_id, cantidad) values ($1, '2026-10-10', $2, $3, $4, $5) returning id`, [n, cliente, obra, material, cant])).rows[0].id;

test('quien ya tenía Viajes hereda ese nivel en Pedidos', async () => {
  const r = await q("select nivel from permisos where user_id = $1 and modulo = 'pedidos'", [HEREDA]);
  assert.equal(r.rows[0].nivel, 'escritura');
});

test('guardar_pedido crea el pedido con sus materiales y número correlativo', async () => {
  await como(CARGA, async () => {
    pedidoId = (await q("select guardar_pedido(null, $1, $2, 'urgente', '2026-10-20', $3::jsonb, 'Carga') as id", [cliente, obra, items()])).rows[0].id;
  });
  const p = (await q('select numero, estado, prioridad from pedidos where id = $1', [pedidoId])).rows[0];
  assert.equal(Number(p.numero), 1);
  assert.equal(p.estado, 'pendiente');
  assert.equal(p.prioridad, 'urgente');
  assert.equal((await q('select count(*)::int n from pedido_items where pedido_id = $1', [pedidoId])).rows[0].n, 2);
});

test('el avance suma solo los viajes vinculados con el material del pedido', async () => {
  const r1 = await remito('7001', arena, 6), r2 = await remito('7002', arena, 6), r3 = await remito('7003', piedra, 6);
  await como(CARGA_V, async () => {
    for (const r of [r1, r2, r3]) await q('insert into pedido_remitos (remito_id, pedido_id, autor) values ($1, $2, $3)', [r, pedidoId, 'x']);
  });
  // quien solo tiene Pedidos (sin Viajes) igual ve lo entregado
  const av = await como(CARGA, async () => (await q('select material_id, pedido, entregado from v_pedido_avance where pedido_id = $1', [pedidoId])).rows);
  const de = (m) => av.find((x) => x.material_id === m);
  assert.equal(Number(de(arena).pedido), 30);
  assert.equal(Number(de(arena).entregado), 12);
  assert.equal(Number(de(piedra).entregado), 6);
});

test('un viaje no puede estar en dos pedidos', async () => {
  const otro = (await q("select guardar_pedido(null, $1, null, 'normal', null, $2::jsonb, 'x') as id", [cliente, items()])).rows[0].id;
  const r = (await q("select id from remitos where numero = '7001'")).rows[0].id;
  await assert.rejects(() => q('insert into pedido_remitos (remito_id, pedido_id) values ($1, $2)', [r, otro]), (e) => e.code === '23505');
});

test('permisos: solo ver no carga; cargar sin Viajes no vincula; sin Pedidos no ve nada', async () => {
  await como(SOLO_VER, async () => {
    assert.ok((await q('select 1 from pedidos')).rows.length >= 1, 've los pedidos');
    await assert.rejects(() => q("select guardar_pedido(null, $1, null, 'normal', null, $2::jsonb, 'x')", [cliente, items()]), (e) => e.code === '42501');
  });
  const r = await remito('7010', arena, 6);
  await como(CARGA, async () => {
    await assert.rejects(() => q('insert into pedido_remitos (remito_id, pedido_id) values ($1, $2)', [r, pedidoId]), (e) => e.code === '42501');
  });
  await como(HEREDA, async () => {
    // HEREDA no tiene Pedidos como "pendiente de crear": lo heredó, así que puede ver; probamos con un usuario nuevo sin permisos
  });
  const SIN = '00000000-0000-0000-0000-0000000000c9';
  await q('insert into auth.users (id, email) values ($1, $2)', [SIN, 'sin@test.com']);
  await q("update profiles set rol = 'operador' where id = $1", [SIN]);
  await como(SIN, async () => {
    assert.equal((await q('select 1 from pedidos')).rows.length, 0);
    assert.equal((await q('select 1 from v_pedido_avance')).rows.length, 0);
  });
});

test('editar un pedido: cambia cantidades y quita materiales', async () => {
  await como(CARGA, async () => {
    await q("select guardar_pedido($1, $2, $3, 'baja', null, $4::jsonb, 'x')", [pedidoId, cliente, obra, JSON.stringify([{ material_id: arena, cantidad: 40 }])]);
  });
  const it = (await q('select material_id, cantidad from pedido_items where pedido_id = $1', [pedidoId])).rows;
  assert.equal(it.length, 1);
  assert.equal(Number(it[0].cantidad), 40);
  assert.equal((await q('select prioridad from pedidos where id = $1', [pedidoId])).rows[0].prioridad, 'baja');
});

test('un pedido sin materiales se rechaza', async () => {
  await assert.rejects(() => q("select guardar_pedido(null, $1, null, 'normal', null, '[]'::jsonb, 'x')", [cliente]));
});
