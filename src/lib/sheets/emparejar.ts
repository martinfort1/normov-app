/* Decide, para cada viaje de la planilla, si ya existe en la base (y hay que actualizarlo) o es nuevo (y hay que crearlo).
   Función pura, sin base de datos: se prueba aparte (emparejar.test.ts).

   Cada viaje se reconoce por su ID (columna ID VIAJE). Las filas que la base ya tenía de antes de que existieran los IDs
   (sin id_viaje) se "adoptan" una sola vez: se emparejan por clave natural (número de remito y fecha) y se les pone su ID.
   Desde la segunda corrida todo se reconoce por ID. */

export interface FilaHoja {
  idViaje: string | null;
  idDb: string | null;
  /** Número de remito, o la clave "SR-…" que se le armaba antes a los viajes sin número: sirve solo para adoptar */
  claveNatural: string;
  fecha: string;
}
export interface Existente { id: string; id_viaje: string | null; numero: string; fecha: string }

export interface Plan<T> {
  /** Viajes que ya estaban: se actualizan por su id interno. adopta=true si recién se les pone el ID de la planilla. */
  actualizar: { dbId: string; fila: T; adopta: boolean }[];
  /** Viajes nuevos */
  insertar: T[];
}

export function planificarRemitos<T extends FilaHoja>(filas: T[], existentes: Existente[]): Plan<T> {
  const porIdViaje = new Map<string, string>();
  const idsDb = new Set<string>();
  const libres = new Map<string, string[]>(); // filas viejas sin ID, por número y fecha
  for (const e of existentes) {
    idsDb.add(e.id);
    if (e.id_viaje) porIdViaje.set(e.id_viaje, e.id);
    else {
      const k = `${e.numero}|${e.fecha}`;
      (libres.get(k) ?? libres.set(k, []).get(k)!).push(e.id);
    }
  }

  const usados = new Set<string>();
  const plan: Plan<T> = { actualizar: [], insertar: [] };
  for (const fila of filas) {
    let dbId: string | undefined;
    let adopta = false;
    if (fila.idDb && idsDb.has(fila.idDb)) dbId = fila.idDb;                       // exportación anterior de la app
    else if (fila.idViaje && porIdViaje.has(fila.idViaje)) dbId = porIdViaje.get(fila.idViaje);
    else {
      const cola = libres.get(`${fila.claveNatural}|${fila.fecha}`);
      while (cola?.length) {
        const candidato = cola.shift()!;
        if (!usados.has(candidato)) { dbId = candidato; adopta = !!fila.idViaje; break; }
      }
    }
    if (dbId && !usados.has(dbId)) { usados.add(dbId); plan.actualizar.push({ dbId, fila, adopta }); }
    else plan.insertar.push(fila);
  }
  return plan;
}
