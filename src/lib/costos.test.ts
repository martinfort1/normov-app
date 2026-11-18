import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costoDeLista, type ListaCosto } from './costos';

const lista: ListaCosto[] = [
  { cantera: 'MOYANO', material: 'BASE', desde: '2026-01-01', m3: 9000 },
  { cantera: 'MOYANO', material: 'BASE', desde: '2026-11-01', m3: 11000 },
  { cantera: 'SAN JOSE', material: 'ARENA', desde: '2026-01-01', m3: 15000 },
];

test('usa el costo vigente a la fecha del viaje', () => {
  assert.equal(costoDeLista(lista, { cantera: 'Moyano', material: 'base', fecha: '2026-10-31' })?.costo, 9000);
  assert.equal(costoDeLista(lista, { cantera: 'MOYANO', material: 'BASE', fecha: '2026-11-01' })?.costo, 11000);
});

test('ignora mayúsculas, tildes y espacios; null si no hay cantera, material o dato', () => {
  assert.equal(costoDeLista(lista, { cantera: ' san  josé ', material: 'Arena', fecha: '2026-05-05' })?.costo, 15000);
  assert.equal(costoDeLista(lista, { cantera: '', material: 'ARENA', fecha: '2026-05-05' }), null);
  assert.equal(costoDeLista(lista, { cantera: 'HARO', material: 'ARENA', fecha: '2026-05-05' }), null);
  assert.equal(costoDeLista(lista, { cantera: 'MOYANO', material: 'BASE', fecha: '2025-12-31' }), null, 'antes de la primera vigencia no hay costo');
});
