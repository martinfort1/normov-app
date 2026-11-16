import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precioDeLista, tipoPorCantidad, type ListaPrecio } from './precios';

const L: ListaPrecio[] = [
  { razon: 'GENERAL', material: 'BASE', tipo: 'minorista', desde: '2026-01-01', viaje6: 150000, m3: 25000 },
  { razon: 'GENERAL', material: '1 AL 3', tipo: 'minorista', desde: '2026-01-01', viaje6: 220000, m3: 36666.67 },
  { razon: 'AVANCO', material: 'BASE', tipo: 'mayorista', desde: '2026-01-01', viaje6: null, m3: 18000 },
  { razon: 'AVANCO', material: 'BASE', tipo: 'mayorista', desde: '2026-10-15', viaje6: null, m3: 19500 },
  { razon: 'KRAN', material: 'BASE', tipo: 'minorista', desde: '2026-01-01', viaje6: 150000, m3: 18000 },
];

test('el tipo sale de los m³: 6 y 12 minorista; 15, 18, 20 y 22 mayorista', () => {
  for (const c of [6, 12]) assert.equal(tipoPorCantidad(c), 'minorista');
  for (const c of [15, 18, 20, 22]) assert.equal(tipoPorCantidad(c), 'mayorista');
  assert.equal(tipoPorCantidad(0), null);
});

test('usa la lista del cliente vigente a la fecha del viaje', () => {
  const q = { nombres: ['AVANCO', 'OBRA X'], material: 'base', cantidad: 18 };
  assert.equal(precioDeLista(L, { ...q, fecha: '2026-09-01' })?.precio, 18000);
  assert.equal(precioDeLista(L, { ...q, fecha: '2026-10-20' })?.precio, 19500);
});

test('el cliente puede reconocerse por la razón social o por la obra', () => {
  const r = precioDeLista(L, { nombres: ['', 'avanco'], material: 'BASE', cantidad: 20, fecha: '2026-10-20' });
  assert.equal(r?.precio, 19500);
  assert.equal(r?.general, false);
});

test('sin lista propia usa GENERAL; minorista: el precio del viaje de 6 m³ da el exacto por m³', () => {
  const r = precioDeLista(L, { nombres: ['CLIENTE NUEVO'], material: '1 AL 3', cantidad: 6, fecha: '2026-10-20' });
  assert.equal(r?.general, true);
  assert.equal(r?.precio, 36666.67);
  assert.equal(precioDeLista(L, { nombres: ['CLIENTE NUEVO'], material: 'BASE', cantidad: 12, fecha: '2026-10-20' })?.precio, 25000);
});

test('si el cliente solo tiene lista del otro tipo, cae en GENERAL; si no hay nada, null', () => {
  // AVANCO tiene BASE mayorista pero no minorista: un viaje de 6 m³ usa GENERAL minorista
  assert.equal(precioDeLista(L, { nombres: ['AVANCO'], material: 'BASE', cantidad: 6, fecha: '2026-10-20' })?.precio, 25000);
  assert.equal(precioDeLista(L, { nombres: ['AVANCO'], material: 'BASE', cantidad: 18, fecha: '2025-12-01' }), null, 'antes de la vigencia');
  assert.equal(precioDeLista(L, { nombres: ['X'], material: 'PIEDRA', cantidad: 6, fecha: '2026-10-20' }), null);
});

test('un precio propio inconsistente (KRAN: viaje 150000 pero 18000 por m³) respeta el por m³ de la lista', () => {
  assert.equal(precioDeLista(L, { nombres: ['KRAN'], material: 'BASE', cantidad: 6, fecha: '2026-10-20' })?.precio, 18000);
});
