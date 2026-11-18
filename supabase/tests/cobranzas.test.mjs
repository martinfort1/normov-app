/* Migraciones 0015 y 0016: cobranzas imputadas a certificados + caja diaria. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { baseConStubs, aplicar, crearComo } from './helpers.mjs';

let db, como, cliente, otro, cert1, cert2, certOtro, certPend, cobId;
const ADMIN = '00000000-0000-0000-0000-0000000000d1';
const CLIENTES_W = '00000000-0000-0000-0000-0000000000d2'; // Saldos de clientes: ver y cargar; sin Caja
const CLIENTES_R = '00000000-0000-0000-0000-0000000000d3'; // Saldos de clientes: solo ver
const CAJA_W = '00000000-0000-0000-0000-0000000000d4';     // Caja: ver y cargar; sin Saldos de clientes
const q = (texto, params) => db.query(texto, params);
const falla = async (fn, patron) => assert.rejects(fn, patron);

before(async () => {
  db = await baseConStubs();
  como = crearComo(db);
  await aplicar(db);
  for (const [id, mail] of [[ADMIN, 'a'], [CLIENTES_W, 'cw'], [CLIENTES_R, 'cr'], [CAJA_W, 'kw']]) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${mail}@test.com`]);
  await q("update profiles set rol = 'admin' where id = $1", [ADMIN]);
  await q("update profiles set rol = 'operador' where id <> $1", [ADMIN]);
  await q("insert into permisos (user_id, modulo, nivel) values ($1, 'clientes', 'escritura'), ($2, 'clientes', 'lectura'), ($3, 'caja', 'escritura')", [CLIENTES_W, CLIENTES_R, CAJA_W]);

  cliente = (await q("insert into clientes (razon_social) values ('CLIENTE UNO') returning id")).rows[0].id;
  otro = (await q("insert into clientes (razon_social) values ('CLIENTE DOS') returning id")).rows[0].id;
  const cert = async (c, emision, total, estado) =>
    (await q("insert into certificados (cliente_id, desde, hasta, unidad, emision, estado, total) values ($1, '2026-09-01', '2026-09-30', 'm3', $2, $3, $4) returning id", [c, emision, estado, total])).rows[0].id;
  cert1 = await cert(cliente, '2026-10-05', 1000, 'aprobado');
  cert2 = await cert(cliente, '2026-10-20', 500, 'aprobado');
  certPend = await cert(cliente, '2026-10-25', 300, 'pendiente');
  certOtro = await cert(otro, '2026-10-06', 700, 'aprobado');
});

const imput = (...xs) => JSON.stringify(xs.map(([c, m]) => ({ certificado_id: c, monto: m })));
const cobrar = (usuario, cli, monto, imp, fecha = '2026-11-02') =>
  como(usuario, async () => (await q("select registrar_cobranza($1, $2, $3, 'efectivo', 'nota', $4::jsonb, 'Tester') as id", [cli, fecha, monto, imp])).rows[0].id);

test('la deuda del cliente sale de sus certificados aprobados (sin saldo inicial, todos cuentan)', async () => {
  const c = (await como(CLIENTES_R, () => q('select facturado, cobrado, saldo_inicial from v_cuenta_cliente where cliente_id = $1', [cliente]))).rows[0];
  assert.equal(Number(c.facturado), 1500); // el pendiente de aprobar no cuenta
  assert.equal(Number(c.cobrado), 0);
});

test('el saldo inicial excluye los certificados emitidos hasta esa fecha', async () => {
  await q("insert into saldos_iniciales (cliente_id, monto, al) values ($1, 2000, '2026-10-10')", [cliente]);
  const c = (await como(CLIENTES_R, () => q('select facturado, saldo_inicial from v_cuenta_cliente where cliente_id = $1', [cliente]))).rows[0];
  assert.equal(Number(c.facturado), 500); // solo cert2 (emitido el 20/10)
  assert.equal(Number(c.saldo_inicial), 2000);
});

test('registrar una cobranza imputa a certificados y genera el ingreso de caja', async () => {
  cobId = await cobrar(CLIENTES_W, cliente, 1200, imput([cert1, 1000], [cert2, 100]));
  const cert = (await q('select certificado_id, cobrado, pendiente from v_cert_cobro where cliente_id = $1 order by numero', [cliente])).rows;
  assert.equal(Number(cert[0].pendiente), 0);
  assert.equal(Number(cert[1].cobrado), 100);
  assert.equal(Number(cert[1].pendiente), 400);
  const mov = (await q('select tipo, monto, fecha::text f, concepto from caja_movimientos where cobranza_id = $1', [cobId])).rows[0];
  assert.equal(mov.tipo, 'ingreso');
  assert.equal(Number(mov.monto), 1200);
  assert.match(mov.concepto, /Cobranza N° 1 — CLIENTE UNO/);
  const c = (await q('select cobrado from v_cuenta_cliente where cliente_id = $1', [cliente])).rows[0];
  assert.equal(Number(c.cobrado), 1200);
});

test('lo que sobra de la imputación queda a cuenta y baja el saldo', async () => {
  await cobrar(CLIENTES_W, cliente, 300, imput([cert2, 100]));
  const c = (await q('select saldo_inicial + facturado - cobrado as saldo from v_cuenta_cliente where cliente_id = $1', [cliente])).rows[0];
  assert.equal(Number(c.saldo), 2000 + 500 - 1500);
});

test('no se puede cobrar de más un certificado, ni imputar a uno ajeno o sin aprobar, ni pasarse del monto', async () => {
  await falla(() => cobrar(CLIENTES_W, cliente, 900, imput([cert2, 900])), /solo le faltan cobrar/);
  await falla(() => cobrar(CLIENTES_W, cliente, 100, imput([certOtro, 100])), /no pertenece a este cliente/);
  await falla(() => cobrar(CLIENTES_W, cliente, 100, imput([certPend, 100])), /no está aprobado/);
  await falla(() => cobrar(CLIENTES_W, cliente, 100, imput([cert2, 150])), /supera lo cobrado/);
  await falla(() => cobrar(CLIENTES_W, cliente, 0, '[]'), /mayor a cero/);
  // los intentos fallidos no dejan nada a medias
  assert.equal((await q('select count(*)::int n from cobranzas')).rows[0].n, 2);
  assert.equal((await q('select count(*)::int n from caja_movimientos')).rows[0].n, 2);
});

test('sin permiso de escritura en Saldos de clientes no se cobra', async () => {
  await falla(() => cobrar(CLIENTES_R, cliente, 100, '[]'), /No tenés permiso/);
  await falla(() => cobrar(CAJA_W, cliente, 100, '[]'), /No tenés permiso/);
});

test('la caja la ve quien tiene ese módulo, no quien solo tiene Saldos de clientes', async () => {
  assert.equal((await como(CLIENTES_W, () => q('select * from caja_movimientos'))).rows.length, 0);
  assert.equal((await como(CAJA_W, () => q('select * from caja_movimientos'))).rows.length, 2);
  assert.equal((await como(ADMIN, () => q('select * from caja_movimientos'))).rows.length, 2);
});

test('la caja admite ingresos y egresos sueltos, pero no ingresos falsos de cobranza', async () => {
  await como(CAJA_W, async () => {
    await q("insert into caja_movimientos (fecha, tipo, concepto, monto, autor) values ('2026-11-02', 'egreso', 'Gasoil', 250, 'k')");
    await q("insert into caja_movimientos (fecha, tipo, concepto, monto, autor) values ('2026-11-03', 'ingreso', 'Venta suelta', 50, 'k')");
    await falla(() => q("insert into caja_movimientos (fecha, tipo, concepto, monto, cobranza_id) values ('2026-11-03', 'ingreso', 'x', 5, $1)", [cobId]), /row-level security/);
  });
  await falla(() => como(CLIENTES_W, () => q("insert into caja_movimientos (fecha, tipo, concepto, monto) values ('2026-11-03', 'ingreso', 'x', 5)")), /row-level security/);
});

test('apertura de caja = saldo acumulado de los días anteriores', async () => {
  const ap = async (f) => Number((await como(CAJA_W, () => q('select caja_apertura($1) a', [f]))).rows[0].a);
  assert.equal(await ap('2026-11-02'), 0);
  assert.equal(await ap('2026-11-03'), 1500 - 250); // cobranzas 1200 + 300, menos gasoil
});

test('el ingreso de una cobranza no se puede anular suelto; anular la cobranza lo anula y libera los certificados', async () => {
  await falla(() => como(CAJA_W, () => q('update caja_movimientos set anulado = true where cobranza_id = $1', [cobId])), /anulá la cobranza/);
  await como(CLIENTES_W, () => q('select anular_cobranza($1)', [cobId]));
  assert.equal((await q('select anulado from caja_movimientos where cobranza_id = $1', [cobId])).rows[0].anulado, true);
  const pend = (await q('select pendiente from v_cert_cobro where certificado_id = $1', [cert1])).rows[0].pendiente;
  assert.equal(Number(pend), 1000);
  await falla(() => como(CLIENTES_W, () => q('select anular_cobranza($1)', [cobId])), /ya estaba anulada/);
  assert.equal(Number((await como(CAJA_W, () => q("select caja_apertura('2026-11-04') a"))).rows[0].a), 300 - 250 + 50);
});

test('solo se pueden cargar cobranzas en efectivo por ahora', async () => {
  await falla(() => como(CLIENTES_W, () => q("select registrar_cobranza($1, '2026-11-05', 10, 'cheque', null, '[]'::jsonb, 'x')", [cliente])), /solo se cargan cobranzas en efectivo/);
});
