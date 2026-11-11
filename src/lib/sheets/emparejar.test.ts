/* Reconocer cada viaje de la planilla por su ID, sin duplicar, ni siquiera la primera vez. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planificarRemitos, type Existente, type FilaHoja, type Plan } from './emparejar';

let seq = 0;
const nuevoId = () => `db-${++seq}`;
const fila = (idViaje: string | null, numero: string, fecha: string, extra: Partial<FilaHoja> = {}): FilaHoja => ({ idViaje, idDb: null, claveNatural: numero, fecha, ...extra });

/** Aplica el plan sobre lo que había, como lo haría la base. */
function aplicar(plan: Plan<FilaHoja>, antes: Existente[]): Existente[] {
  const dsp = antes.map((e) => ({ ...e }));
  for (const a of plan.actualizar) {
    const e = dsp.find((x) => x.id === a.dbId)!;
    if (a.fila.idViaje) e.id_viaje = a.fila.idViaje;
    e.numero = a.fila.claveNatural; e.fecha = a.fila.fecha;
  }
  for (const f of plan.insertar) dsp.push({ id: nuevoId(), id_viaje: f.idViaje, numero: f.claveNatural, fecha: f.fecha });
  return dsp;
}

test('base vacía: todos los viajes son nuevos, incluso los que comparten número y fecha', () => {
  const hoja = [fila('V1', '4094', '2026-01-26'), fila('V2', '4094', '2026-01-26'), fila('V3', '4095', '2026-01-26')];
  const plan = planificarRemitos(hoja, []);
  assert.equal(plan.insertar.length, 3);
  assert.equal(plan.actualizar.length, 0);
});

test('primera corrida sobre filas viejas (sin ID): se adoptan una vez y los repetidos del grupo se crean', () => {
  // La base tenía UNA fila por grupo (la última). La planilla tiene dos viajes con el mismo remito y fecha.
  const antes: Existente[] = [
    { id: 'viejo-1', id_viaje: null, numero: '4094', fecha: '2026-01-26' },
    { id: 'viejo-2', id_viaje: null, numero: '4095', fecha: '2026-01-26' },
  ];
  const hoja = [fila('V1', '4094', '2026-01-26'), fila('V2', '4094', '2026-01-26'), fila('V3', '4095', '2026-01-26')];
  const plan = planificarRemitos(hoja, antes);
  assert.deepEqual(plan.actualizar.map((a) => [a.dbId, a.fila.idViaje, a.adopta]), [['viejo-1', 'V1', true], ['viejo-2', 'V3', true]]);
  assert.deepEqual(plan.insertar.map((f) => f.idViaje), ['V2']);
});

test('segunda corrida: todo se reconoce por ID, no se crea nada', () => {
  const antes: Existente[] = [{ id: 'viejo-1', id_viaje: null, numero: '4094', fecha: '2026-01-26' }];
  const hoja = [fila('V1', '4094', '2026-01-26'), fila('V2', '4094', '2026-01-26')];
  const despues1 = aplicar(planificarRemitos(hoja, antes), antes);
  assert.equal(despues1.length, 2);
  const plan2 = planificarRemitos(hoja, despues1);
  assert.equal(plan2.insertar.length, 0);
  assert.equal(plan2.actualizar.length, 2);
  assert.ok(plan2.actualizar.every((a) => !a.adopta));
  assert.equal(aplicar(plan2, despues1).length, 2);
});

test('si en la planilla se cambia el número o la fecha de un viaje, se actualiza (no se duplica)', () => {
  const antes: Existente[] = [{ id: 'x', id_viaje: 'V7', numero: '100', fecha: '2026-03-01' }];
  const plan = planificarRemitos([fila('V7', '101', '2026-03-02')], antes);
  assert.equal(plan.insertar.length, 0);
  assert.deepEqual(plan.actualizar.map((a) => a.dbId), ['x']);
});

test('viajes sin número de remito: se adoptan por la clave vieja (SR-…) y no se duplican', () => {
  const antes: Existente[] = [{ id: 'sr-1', id_viaje: null, numero: 'SR-aaaaaaaaaaaa', fecha: '2026-05-05' }];
  const hoja = [fila('V9', '', '2026-05-05', { claveNatural: 'SR-aaaaaaaaaaaa' })];
  const plan = planificarRemitos(hoja, antes);
  assert.equal(plan.insertar.length, 0);
  assert.equal(plan.actualizar[0].dbId, 'sr-1');
  assert.equal(plan.actualizar[0].adopta, true);
});

test('un viaje de una exportación anterior de la app (uuid) se reconoce por su id interno', () => {
  const antes: Existente[] = [{ id: 'uuid-1', id_viaje: null, numero: '55', fecha: '2026-06-01' }];
  const plan = planificarRemitos([fila(null, '56', '2026-06-02', { idDb: 'uuid-1' })], antes);
  assert.equal(plan.insertar.length, 0);
  assert.equal(plan.actualizar[0].dbId, 'uuid-1');
});

test('una fila de la base no se usa dos veces en la misma corrida', () => {
  const antes: Existente[] = [{ id: 'a', id_viaje: 'V1', numero: '10', fecha: '2026-01-01' }];
  const plan = planificarRemitos([fila('V1', '10', '2026-01-01'), fila('V1', '10', '2026-01-01')], antes);
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.insertar.length, 1);
});

test('un viaje nuevo con número y fecha iguales a uno que ya tiene ID es un viaje nuevo, no una adopción', () => {
  const antes: Existente[] = [{ id: 'a', id_viaje: 'V1', numero: '10', fecha: '2026-01-01' }];
  const plan = planificarRemitos([fila('V1', '10', '2026-01-01'), fila('V2', '10', '2026-01-01')], antes);
  assert.deepEqual(plan.insertar.map((f) => f.idViaje), ['V2']);
});
