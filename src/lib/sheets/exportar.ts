/* Arma los Excel de exportación con las mismas hojas y columnas que las planillas de Google Sheets
   (encabezados leídos de las planillas vivas), más una columna ID al final que usa la importación para
   reconocer la fila aunque se cambie su número, fecha o contenido. Las columnas que en la planilla son
   fórmulas (Saldo Acumulado, Días para Vto., IDC, ICL…) salen vacías. */
import * as XLSX from 'xlsx';
import { MESES } from '@/lib/periodo';

type Tipo = 'texto' | 'fecha' | 'plata' | 'numero' | 'entero';
interface Col<T> { h: string; w: number; tipo: Tipo; v: (r: T) => string | number | null | undefined }

const FORMATO: Partial<Record<Tipo, string>> = { fecha: 'dd/mm/yyyy', plata: '"$" #,##0.00', numero: '#,##0.00', entero: '0' };

/** Fecha ISO (AAAA-MM-DD) → número de serie de Excel, sin husos horarios. */
export function serialExcel(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}
const semanaDe = (iso: string) => {
  const f = new Date(iso.slice(0, 10) + 'T12:00:00');
  const inicio = new Date(f.getFullYear(), 0, 1);
  return Math.ceil(((f.getTime() - inicio.getTime()) / 86400000 + inicio.getDay() + 1) / 7);
};
function construir<T>(hoja: string, cols: Col<T>[], filas: T[]): Buffer {
  const aoa: (string | number | null)[][] = [cols.map((c) => c.h)];
  for (const f of filas) {
    aoa.push(cols.map((c) => {
      const v = c.v(f);
      if (v == null || v === '') return null;
      return c.tipo === 'fecha' && typeof v === 'string' ? serialExcel(v) : v;
    }));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  cols.forEach((c, j) => {
    const z = FORMATO[c.tipo];
    if (!z) return;
    for (let i = 1; i < aoa.length; i++) {
      const celda = ws[XLSX.utils.encode_cell({ r: i, c: j })];
      if (celda && typeof celda.v === 'number') celda.z = z;
    }
  });
  ws['!cols'] = cols.map((c) => ({ wch: c.w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ───────────── viajes · hoja PRINCIPAL ─────────────
export interface ViajeExp {
  /** id interno de la base; id_viaje es el ID visible (V000123 de la planilla, A000045 de la app) */
  id: string; id_viaje?: string | null; numero: string; fecha: string; camion: string | null; chofer: string | null; cantera: string | null;
  cantidad: number; precio: number; total: number; neto: number; costo: number;
  clientes: { razon_social: string } | null; obras: { nombre: string } | null; materiales: { nombre: string; unidad: string } | null;
  /** Estado del certificado que contiene el viaje (solo si se pudo consultar) */
  certEstado?: string | null; certNumero?: number | null;
}
const ESTADO_VIAJE: Record<string, string> = { pendiente: 'Pendiente de aprobación', aprobado: 'Aprobado' };

export const COLS_VIAJES: Col<ViajeExp>[] = [
  { h: 'AÑO', w: 7, tipo: 'entero', v: (r) => +r.fecha.slice(0, 4) },
  { h: 'MES', w: 12, tipo: 'texto', v: (r) => MESES[+r.fecha.slice(5, 7) - 1] },
  { h: 'FECHA', w: 12, tipo: 'fecha', v: (r) => r.fecha },
  { h: 'Sem', w: 6, tipo: 'entero', v: (r) => semanaDe(r.fecha) },
  { h: 'CLIENTE', w: 30, tipo: 'texto', v: (r) => r.obras?.nombre },
  { h: 'RAZON SOCIAL', w: 28, tipo: 'texto', v: (r) => r.clientes?.razon_social },
  { h: 'CUIT', w: 14, tipo: 'texto', v: () => null },
  { h: 'REMITO', w: 10, tipo: 'texto', v: (r) => (r.numero.startsWith('SR-') ? null : r.numero) },
  { h: 'CAMION', w: 10, tipo: 'texto', v: (r) => r.camion },
  { h: 'MT3 CAN', w: 9, tipo: 'numero', v: (r) => r.cantidad },
  { h: 'MT3', w: 9, tipo: 'numero', v: (r) => r.cantidad },
  { h: 'CANTERA', w: 14, tipo: 'texto', v: (r) => r.cantera },
  { h: 'GUSTA', w: 8, tipo: 'texto', v: () => null },
  { h: 'RAZON SOCIAL', w: 12, tipo: 'texto', v: () => null },
  { h: 'MATERIAL', w: 18, tipo: 'texto', v: (r) => r.materiales?.nombre },
  { h: 'COSTO MATERIAL', w: 14, tipo: 'plata', v: (r) => (r.costo > 0 && r.cantidad > 0 ? Math.round((r.costo / r.cantidad) * 100) / 100 : null) },
  { h: 'CHOFER', w: 18, tipo: 'texto', v: (r) => r.chofer },
  { h: 'PRECIO VTA', w: 13, tipo: 'plata', v: (r) => r.precio },
  { h: 'NETO', w: 14, tipo: 'plata', v: (r) => r.neto },
  { h: 'IVA', w: 13, tipo: 'plata', v: (r) => (r.total > r.neto ? Math.round((r.total - r.neto) * 100) / 100 : null) },
  { h: 'TOTAL', w: 14, tipo: 'plata', v: (r) => r.total },
  { h: 'COSTO MAT.', w: 14, tipo: 'plata', v: (r) => r.costo || null },
  { h: 'estado cantera', w: 12, tipo: 'texto', v: () => null },
  { h: 'saldo', w: 10, tipo: 'plata', v: () => null },
  { h: 'ESTADO', w: 22, tipo: 'texto', v: (r) => (r.certEstado === undefined ? null : ESTADO_VIAJE[r.certEstado ?? ''] ?? 'Realizado') },
  { h: 'COSTO CAMION', w: 13, tipo: 'plata', v: () => null },
  { h: 'cargado', w: 9, tipo: 'texto', v: () => null },
  // El ID del viaje; si el viaje todavía no tiene (filas viejas), el id interno, que la importación también reconoce.
  { h: 'ID VIAJE', w: 14, tipo: 'texto', v: (r) => r.id_viaje ?? r.id },
  { h: 'CERTIFICADO N°', w: 14, tipo: 'texto', v: (r) => (r.certNumero ? String(r.certNumero).padStart(4, '0') : null) },
];
export const exportarViajes = (filas: ViajeExp[]) => construir('PRINCIPAL', COLS_VIAJES, filas);

// ───────────── combustible · hoja Cargas ─────────────
export interface CargaExp {
  id: string; fecha: string | null; remito: string | null; patente: string; litros: number; tipo: string | null;
  precio_litro: number | null; estacion: string | null; chofer: string | null;
}
export const COLS_CARGAS: Col<CargaExp>[] = [
  { h: 'MES', w: 12, tipo: 'texto', v: (r) => (r.fecha ? MESES[+r.fecha.slice(5, 7) - 1] : null) },
  { h: 'FECHA', w: 12, tipo: 'fecha', v: (r) => r.fecha },
  { h: 'REMITO', w: 12, tipo: 'texto', v: (r) => r.remito },
  { h: 'PATENTE', w: 11, tipo: 'texto', v: (r) => r.patente },
  { h: 'LITROS', w: 10, tipo: 'numero', v: (r) => r.litros },
  { h: 'TIPO', w: 14, tipo: 'texto', v: (r) => (r.tipo === '—' ? null : r.tipo) },
  { h: 'PRECIO LITRO', w: 13, tipo: 'plata', v: (r) => r.precio_litro },
  { h: 'ESTACION', w: 16, tipo: 'texto', v: (r) => (r.estacion === '—' ? null : r.estacion) },
  { h: 'CHOFER', w: 18, tipo: 'texto', v: (r) => (r.chofer === '—' ? null : r.chofer) },
  { h: 'NETO', w: 12, tipo: 'plata', v: () => null },
  { h: 'IDC', w: 10, tipo: 'plata', v: () => null },
  { h: 'ICL', w: 10, tipo: 'plata', v: () => null },
  { h: 'IVA', w: 10, tipo: 'plata', v: () => null },
  { h: 'TOTAL', w: 12, tipo: 'plata', v: () => null },
  { h: 'CENTRO DE COSTOS', w: 16, tipo: 'texto', v: () => null },
  { h: 'CENTRO (EXCEPCIÓN)', w: 16, tipo: 'texto', v: () => null },
  { h: 'ID', w: 38, tipo: 'texto', v: (r) => r.id },
];
export const exportarCargas = (filas: CargaExp[]) => construir('Cargas', COLS_CARGAS, filas);

// ───────────── proveedores · hoja Cta Cte Proveedores ─────────────
export interface MovProvExp {
  id: string; fecha: string | null; proveedores: { nombre: string } | null; unidad_negocio: string | null; centro_costo: string | null;
  rubro: string | null; subrubro: string | null; detalle: string | null; nro_factura: string | null; debe: number; haber: number;
  forma_pago: string | null; nro_cheque: string | null; fecha_pago: string | null; observaciones: string | null;
}
export const COLS_PROVEEDORES: Col<MovProvExp>[] = [
  { h: 'Fecha', w: 12, tipo: 'fecha', v: (r) => r.fecha },
  { h: 'Proveedor', w: 30, tipo: 'texto', v: (r) => r.proveedores?.nombre },
  { h: 'Unidad de Negocio', w: 24, tipo: 'texto', v: (r) => r.unidad_negocio },
  { h: 'Centro de Soporte', w: 22, tipo: 'texto', v: (r) => r.centro_costo },
  { h: 'Rubro', w: 20, tipo: 'texto', v: (r) => r.rubro },
  { h: 'Sub-rubro', w: 22, tipo: 'texto', v: (r) => r.subrubro },
  { h: 'Detalle', w: 34, tipo: 'texto', v: (r) => r.detalle },
  { h: 'N° Factura', w: 16, tipo: 'texto', v: (r) => r.nro_factura },
  { h: 'Debe\n(Compra/Gasto)', w: 16, tipo: 'plata', v: (r) => r.debe || null },
  { h: 'Haber\n(Pagado)', w: 16, tipo: 'plata', v: (r) => r.haber || null },
  { h: 'Forma de Pago', w: 16, tipo: 'texto', v: (r) => r.forma_pago },
  { h: 'N° Cheque', w: 14, tipo: 'texto', v: (r) => r.nro_cheque },
  { h: 'Fecha Cobro/Pago', w: 16, tipo: 'fecha', v: (r) => r.fecha_pago },
  { h: 'Observaciones', w: 30, tipo: 'texto', v: (r) => r.observaciones },
  { h: 'Saldo Acumulado', w: 16, tipo: 'plata', v: () => null },
  { h: 'ID', w: 38, tipo: 'texto', v: (r) => r.id },
];
export const exportarProveedores = (filas: MovProvExp[]) => construir('Cta Cte Proveedores', COLS_PROVEEDORES, filas);

// ───────────── cheques · hoja Cheques ─────────────
export interface ChequeExp {
  id: string; emision: string | null; tipo: string; contraparte: string | null; numero: string | null; banco: string | null;
  librador: string | null; cuit: string | null; monto: number; vencimiento: string | null; estado: string;
  endosado_a: string | null; observaciones: string | null;
}
export const COLS_CHEQUES: Col<ChequeExp>[] = [
  { h: 'Fecha Emisión', w: 14, tipo: 'fecha', v: (r) => r.emision },
  { h: 'Tipo\n(Propio/Tercero)', w: 16, tipo: 'texto', v: (r) => r.tipo },
  { h: 'Cliente/Proveedor', w: 28, tipo: 'texto', v: (r) => r.contraparte },
  { h: 'N° Cheque', w: 14, tipo: 'texto', v: (r) => r.numero },
  { h: 'Banco', w: 16, tipo: 'texto', v: (r) => r.banco },
  { h: 'Librador/Emisor', w: 26, tipo: 'texto', v: (r) => r.librador },
  { h: 'CUIT', w: 14, tipo: 'texto', v: (r) => r.cuit },
  { h: 'Monto', w: 16, tipo: 'plata', v: (r) => r.monto },
  { h: 'Fecha Vencimiento', w: 17, tipo: 'fecha', v: (r) => r.vencimiento },
  { h: 'Estado', w: 14, tipo: 'texto', v: (r) => (r.estado === '—' ? null : r.estado) },
  { h: 'Endosado A', w: 22, tipo: 'texto', v: (r) => r.endosado_a },
  { h: 'Observaciones', w: 30, tipo: 'texto', v: (r) => r.observaciones },
  { h: 'Días para Vto.', w: 14, tipo: 'entero', v: () => null },
  { h: 'ID', w: 38, tipo: 'texto', v: (r) => r.id },
];
export const exportarCheques = (filas: ChequeExp[]) => construir('Cheques', COLS_CHEQUES, filas);
