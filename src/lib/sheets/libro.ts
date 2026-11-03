import * as XLSX from 'xlsx';
import type { Libro, Row } from './parsers';

/** Lee un .xlsx y devuelve { hoja → filas }. Si se pasan nombres de hojas, solo convierte esas (más rápido);
 *  si ninguna existe, convierte todas para que el parser busque por encabezados. */
export function libroDeBuffer(buf: Buffer | ArrayBuffer | Uint8Array, soloHojas?: string[]): Libro {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const nombres = soloHojas?.some((n) => wb.SheetNames.includes(n)) ? wb.SheetNames.filter((n) => soloHojas.includes(n)) : wb.SheetNames;
  const libro: Libro = {};
  for (const name of nombres) {
    libro[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }) as Row[];
  }
  return libro;
}
