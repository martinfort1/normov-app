/* Exportar a Excel y volver a importar no debe cambiar nada.
   Correr con:  npm test   (usa el lector de pruebas de Node, sin dependencias extra) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libroDeBuffer } from './libro';
import { parsePrincipal, parseProveedores, parseCheques, parseCombustible } from './parsers';
import { exportarViajes, exportarProveedores, exportarCheques, exportarCargas, serialExcel, type ViajeExp } from './exportar';
import { partesMov, partesCheque, partesCarga, sha } from './claves';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

const viaje = (o: Partial<ViajeExp>): ViajeExp => ({
  id: ID1, numero: '4094', fecha: '2026-01-26', camion: 'AC124BA', chofer: 'PEREZ JUAN', cantera: 'TIPAS',
  cantidad: 6, precio: 15000, total: 108900, neto: 90000, costo: 30000,
  clientes: { razon_social: 'VIENTO SUR SRL' }, obras: { nombre: 'VIENTO SUR LOTE H14' }, materiales: { nombre: 'PIEDRA 1-3', unidad: 'm3' }, ...o,
});

test('las fechas viajan como fecha de Excel y vuelven al mismo día (sin corrimiento)', () => {
  assert.equal(serialExcel('1900-03-01'), 61);
  for (const f of ['2026-01-01', '2026-03-08', '2026-09-30', '2026-12-31', '2024-02-29']) {
    const [out] = parsePrincipal(libroDeBuffer(exportarViajes([viaje({ fecha: f })])));
    assert.equal(out.fecha, f);
  }
});

test('viajes: todo vuelve igual, con ID, y los sin remito siguen sin remito', () => {
  const filas = [viaje({}), viaje({ id: ID2, numero: 'SR-abc123def456', fecha: '2026-02-03', cantidad: 12.5, precio: 0, total: 0, neto: 0, costo: 0, camion: null })];
  const out = parsePrincipal(libroDeBuffer(exportarViajes(filas)));
  assert.equal(out.length, 2);
  const [a, b] = out;
  assert.deepEqual(
    { id: a.id, numero: a.numero, fecha: a.fecha, cliente: a.cliente, razon: a.razon, camion: a.camion, chofer: a.chofer, cantera: a.cantera, material: a.material, cantidad: a.cantidad, precio: a.precio, neto: a.neto, total: a.total, costo: a.costo, unidad: a.unidad },
    { id: ID1, numero: '4094', fecha: '2026-01-26', cliente: 'VIENTO SUR LOTE H14', razon: 'VIENTO SUR SRL', camion: 'AC124BA', chofer: 'PEREZ JUAN', cantera: 'TIPAS', material: 'PIEDRA 1-3', cantidad: 6, precio: 15000, neto: 90000, total: 108900, costo: 30000, unidad: 'm3' },
  );
  assert.equal(b.id, ID2);
  assert.equal(b.numero, null, 'sin número de remito: la columna REMITO sale vacía');
  assert.equal(b.camion, null);
  assert.equal(b.cantidad, 12.5);
});

test('viajes: el Excel tiene las columnas de la planilla y el estado del certificado', () => {
  const libro = libroDeBuffer(exportarViajes([viaje({ certEstado: 'aprobado', certNumero: 17 }), viaje({ id: ID2, numero: '1', certEstado: null }), viaje({ id: '33333333-3333-4333-8333-333333333333', numero: '2', certEstado: 'pendiente' })]));
  const filas = libro['PRINCIPAL'];
  const enc = filas[0] as string[];
  for (const h of ['AÑO', 'MES', 'FECHA', 'Sem', 'CLIENTE', 'RAZON SOCIAL', 'REMITO', 'CAMION', 'MT3', 'CANTERA', 'MATERIAL', 'CHOFER', 'PRECIO VTA', 'NETO', 'IVA', 'TOTAL', 'COSTO MAT.', 'ESTADO', 'ID VIAJE', 'CERTIFICADO N°'])
    assert.ok(enc.includes(h), `falta la columna ${h}`);
  const iEstado = enc.indexOf('ESTADO'), iCert = enc.indexOf('CERTIFICADO N°');
  assert.deepEqual([filas[1][iEstado], filas[2][iEstado], filas[3][iEstado]], ['Aprobado', 'Realizado', 'Pendiente de aprobación']);
  assert.equal(filas[1][iCert], '0017');
  assert.equal(filas[1][enc.indexOf('MES')], 'enero');
  assert.equal(filas[1][enc.indexOf('IVA')], 18900);
});

test('proveedores: vuelve igual y la clave anti-duplicados no cambia', () => {
  const fila = {
    id: ID1, fecha: '2026-03-05', proveedores: { nombre: 'Corralon Norte' }, unidad_negocio: 'Áridos - Mayorista', centro_costo: 'Taller',
    rubro: 'Repuestos', subrubro: 'Filtros', detalle: 'Filtros de aceite', nro_factura: 'A-0001-123', debe: 125000.5, haber: 0,
    forma_pago: 'Transferencia', nro_cheque: null, fecha_pago: '2026-04-05', observaciones: null,
  };
  const [m] = parseProveedores(libroDeBuffer(exportarProveedores([fila])));
  assert.equal(m.id, ID1);
  assert.equal(m.proveedor, 'Corralon Norte');
  assert.equal(m.fecha, '2026-03-05');
  assert.equal(m.fechaPago, '2026-04-05');
  assert.equal(m.debe, 125000.5); assert.equal(m.haber, 0);
  assert.equal(m.factura, 'A-0001-123'); assert.equal(m.forma, 'Transferencia'); assert.equal(m.cheque, ''); assert.equal(m.obs, '');
  // la misma fila, tal como la habría leído el sync desde la planilla, da la misma clave
  const original = { fecha: '2026-03-05', proveedor: 'Corralon Norte', detalle: 'Filtros de aceite', factura: 'A-0001-123', debe: 125000.5, haber: 0, forma: 'Transferencia', cheque: '' };
  assert.equal(sha(partesMov(m)), sha(partesMov(original)));
});

test('cheques: vuelve igual (incluido el CUIT) y la clave no cambia con el estado', () => {
  const fila = {
    id: ID2, emision: '2026-05-10', tipo: 'Tercero', contraparte: 'Constructora Sur', numero: '00012345', banco: 'Macro', librador: 'Juan Perez',
    cuit: '20-12345678-9', monto: 4100000, vencimiento: '2026-08-10', estado: 'En Cartera', endosado_a: null, observaciones: 'Nota',
  };
  const [c] = parseCheques(libroDeBuffer(exportarCheques([fila])));
  assert.equal(c.id, ID2); assert.equal(c.tipo, 'Tercero'); assert.equal(c.numero, '00012345'); assert.equal(c.cuit, '20-12345678-9');
  assert.equal(c.monto, 4100000); assert.equal(c.vto, '2026-08-10'); assert.equal(c.emision, '2026-05-10'); assert.equal(c.estado, 'En Cartera');
  const [c2] = parseCheques(libroDeBuffer(exportarCheques([{ ...fila, estado: 'Depositado' }])));
  assert.equal(sha(partesCheque(c)), sha(partesCheque(c2)), 'cambiar el estado no cambia la identidad del cheque');
});

test('combustible: vuelve igual y los "—" quedan como en la planilla', () => {
  const fila = { id: ID1, fecha: '2026-06-02', remito: null, patente: 'AB123CD', litros: 180.5, tipo: '—', precio_litro: 1523.25, estacion: '—', chofer: 'GOMEZ' };
  const [r] = parseCombustible(libroDeBuffer(exportarCargas([fila])));
  assert.equal(r.id, ID1); assert.equal(r.fecha, '2026-06-02'); assert.equal(r.patente, 'AB123CD'); assert.equal(r.litros, 180.5);
  assert.equal(r.precioLitro, 1523.25); assert.equal(r.tipo, '—'); assert.equal(r.estacion, '—'); assert.equal(r.chofer, 'GOMEZ'); assert.equal(r.remito, '');
  assert.equal(sha(partesCarga(r)), sha(partesCarga({ fecha: '2026-06-02', remito: '', patente: 'AB123CD', litros: 180.5, tipo: '—', estacion: '—' })));
});

test('un ID que no es de la app (el de la planilla) se ignora', () => {
  const libro = libroDeBuffer(exportarViajes([viaje({ id: 'V-000123' })]));
  assert.equal(parsePrincipal(libro)[0].id, null);
});
