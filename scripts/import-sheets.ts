/* Importa las planillas (.xlsx exportadas de Google Drive) a Supabase, a mano.
   Es idempotente: se puede correr todas las veces que haga falta.
   Con el sync automático (ver src/app/api/sync/route.ts) esto queda como respaldo manual.

   Uso:
     npm run import -- --planilla data/planilla.xlsx --diego data/diego.xlsx --comb data/combustible.xlsx
   Cada archivo es opcional. */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { importarPlanilla, importarDiego, importarCombustible } from '../src/lib/sheets/importar';
import type { Libro, Row } from '../src/lib/sheets/parsers';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
const db = createClient(url, key, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };

function libroDe(path: string): Libro {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: false });
  const libro: Libro = {};
  for (const name of wb.SheetNames) {
    libro[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }) as Row[];
  }
  return libro;
}

async function main() {
  const [p, d, c] = [arg('planilla'), arg('diego'), arg('comb')];
  if (!p && !d && !c) { console.log('Nada para importar. Ver el encabezado de este archivo.'); return; }
  if (p) console.log(await importarPlanilla(libroDe(p), db));
  if (d) console.log(await importarDiego(libroDe(d), db));
  if (c) console.log(await importarCombustible(libroDe(c), db));
  console.log('Listo.');
}
main().catch((e) => { console.error('ERROR:', e.message ?? e); process.exit(1); });
