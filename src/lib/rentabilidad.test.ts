import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRentabilidad, patenteKey, precioGasA, type Viaje, type GastoProv } from './rentabilidad';

const camiones = [{ patente: 'HCQ546', rubro: 'Minorista' as const }, { patente: 'GQA834', rubro: 'Mayorista' as const }];
const viaje = (o: Partial<Viaje>): Viaje => ({ fecha: '2026-03-04', camion: 'HCQ546', chofer: 'JUAN', material: 'BASE', cantera: 'MOYANO', m3: 6, venta: 120000, costo: 0, remito: '1', cliente: 'X', ...o });
const costos = [{ cantera: 'MOYANO', material: 'BASE', desde: '2026-01-01', m3: 9000 }];
const op = { incluirIngenio: true, repartir: false, horas: 8, precioGas: null };
const base = { camiones, viajes: [] as Viaje[], cargas: [], preciosGas: [], costos, gastos: [] as GastoProv[], hasta: '2026-03-31' };

test('patentes: alias y formato', () => {
  assert.equal(patenteKey('hca-546'), 'HCQ546');
  assert.equal(patenteKey('ac 124 ba'), 'AC124BA');
});

test('precio del gasoil: el vigente a la fecha', () => {
  const l = [{ desde: '2026-01-01', precio: 2000 }, { desde: '2026-03-01', precio: 2500 }];
  assert.equal(precioGasA(l, '2026-02-28'), 2000);
  assert.equal(precioGasA(l, '2026-03-01'), 2500);
  assert.equal(precioGasA(l, '2025-12-31'), null);
});

test('un viaje minorista: material de la lista, chofer, gasoil y resultado', () => {
  const r = calcularRentabilidad({ ...base, viajes: [viaje({})], cargas: [{ fecha: '2026-03-04', patente: 'HCQ546', litros: 10 }], preciosGas: [{ desde: '2026-01-01', precio: 2000 }] }, op);
  const f = r.list.find((x) => x.k === 'HCQ546')!;
  assert.equal(f.mat, 54000); // 6 m³ × 9000
  assert.equal(f.chofer, 10000); // miércoles, minorista
  assert.equal(f.gas, 20000);
  assert.equal(f.res, 120000 - 54000 - 10000 - 20000);
});

test('sábado +50% y domingo +100% al chofer', () => {
  const r = calcularRentabilidad({ ...base, viajes: [viaje({ fecha: '2026-03-07' }), viaje({ fecha: '2026-03-08' })] }, op);
  assert.equal(r.list[0].chofer, 15000 + 20000);
  assert.equal(r.list[0].fines, 2);
});

test('sin costo en lista usa el del remito; si no hay nada queda "sin costo"', () => {
  const r = calcularRentabilidad({ ...base, viajes: [viaje({ cantera: 'OTRA', costo: 30000 }), viaje({ cantera: 'OTRA', material: 'RARO' })] }, op);
  const f = r.list[0];
  assert.equal(f.mat, 30000);
  assert.equal(f.sinC.length, 1);
});

test('ceniza (Ingenio): sin material, una jornada por chofer y día', () => {
  const v = viaje({ material: 'CENIZA', cantera: 'INGENIO' });
  const r = calcularRentabilidad({ ...base, viajes: [v, v] }, op);
  assert.equal(r.list[0].mat, 0);
  assert.equal(r.list[0].diasIng, 1);
  assert.equal(r.list[0].chofer, 6697 * 8);
  const sin = calcularRentabilidad({ ...base, viajes: [v] }, { ...op, incluirIngenio: false });
  assert.equal(sin.list[0].viajes, 0);
});

test('camiones ajenos y viajes sin patente no entran', () => {
  const r = calcularRentabilidad({ ...base, viajes: [viaje({ camion: 'ZZZ999' }), viaje({ camion: null })] }, op);
  assert.equal(r.fuera.get('ZZZ999'), 1);
  assert.equal(r.sinPat, 1);
  assert.equal(r.list.reduce((a, f) => a + f.viajes, 0), 0);
});

test('arreglos: por patente en el detalle; taller sin patente se reparte si se pide', () => {
  const g = (o: Partial<GastoProv>): GastoProv => ({ fecha: '2026-03-10', proveedor: 'GOMERIA', rubro: 'FLOTA', subrubro: 'NEUMATICOS', centro: '', detalle: '', obs: '', factura: 'A-1', debe: 121000, ...o });
  const gastos = [g({ detalle: 'cubiertas HCQ-546' }), g({ detalle: 'sin dato' }), g({ rubro: 'COMBUSTIBLE', subrubro: '', detalle: 'HCQ546' })];
  const viajes = [viaje({}), viaje({ camion: 'GQA834' })];
  const a = calcularRentabilidad({ ...base, viajes, gastos }, op);
  assert.equal(a.list.find((x) => x.k === 'HCQ546')!.mec, 121000); // el de combustible se ignora
  assert.equal(a.totSA, 121000);
  assert.equal(a.list.find((x) => x.k === 'GQA834')!.mecT, 0);
  const b = calcularRentabilidad({ ...base, viajes, gastos }, { ...op, repartir: true });
  assert.equal(b.list.find((x) => x.k === 'GQA834')!.mecPror, 60500);
});

test('factura que empieza con S: se le saca el IVA', () => {
  const r = calcularRentabilidad({ ...base, gastos: [{ fecha: '2026-03-10', proveedor: 'P', rubro: 'FLOTA', subrubro: 'SERVICE', centro: '', detalle: 'HCQ546', obs: '', factura: 'S-5', debe: 121000 }] }, op);
  assert.equal(r.list.find((x) => x.k === 'HCQ546')!.mec, 100000);
});

test('por tipo de viaje: la ceniza va aparte y el gasoil se reparte por viajes', () => {
  const r = calcularRentabilidad({ ...base, viajes: [viaje({}), viaje({}), viaje({ material: 'CENIZA', cantera: 'INGENIO' })], cargas: [{ fecha: '2026-03-04', patente: 'HCQ546', litros: 30 }], preciosGas: [{ desde: '2026-01-01', precio: 1000 }] }, op);
  const f = r.list.find((x) => x.k === 'HCQ546')!;
  assert.equal(f.rub.Minorista!.viajes, 2);
  assert.equal(f.rub.Ingenio!.viajes, 1);
  assert.equal(f.rub.Minorista!.gas, 20000);
  assert.equal(f.rub.Ingenio!.gas, 10000);
  const suma = Object.values(f.rub).reduce((a, x) => a + x.res, 0);
  assert.ok(Math.abs(suma - f.res) < 0.01);
});
