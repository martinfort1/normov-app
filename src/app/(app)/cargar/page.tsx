import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAcceso, type Modulo } from '@/lib/permisos';
import { hoyAR } from '@/lib/periodo';
import { SinAcceso } from '@/components/sin-acceso';
import { catalogoViaje, catalogoCombustible, catalogoProveedor, catalogoCheque, historial } from './datos';
import { FormViaje, FormCombustible, FormProveedor, FormCheque } from './forms';
import { Historial } from './historial';
import { ExcelPanel, type TipoExcel } from './excel-panel';

export const dynamic = 'force-dynamic';

type Id = 'viaje' | 'combustible' | 'proveedor' | 'cheque';
const TIPOS: { id: Id; label: string; titulo: string; modulo: Modulo; excel: TipoExcel }[] = [
  { id: 'viaje', label: 'Viaje', titulo: 'Nuevo viaje / remito', modulo: 'viajes', excel: { id: 'viajes', titulo: 'Viajes', hoja: 'PRINCIPAL', rango: true } },
  { id: 'combustible', label: 'Combustible', titulo: 'Carga de combustible', modulo: 'combustible', excel: { id: 'combustible', titulo: 'Combustible', hoja: 'Cargas', rango: true } },
  { id: 'proveedor', label: 'Proveedor', titulo: 'Gasto o pago a proveedor', modulo: 'proveedores', excel: { id: 'proveedores', titulo: 'Movimientos de proveedores', hoja: 'Cta Cte Proveedores', rango: true } },
  { id: 'cheque', label: 'Cheque', titulo: 'Cheque nuevo', modulo: 'cheques', excel: { id: 'cheques', titulo: 'Cheques', hoja: 'Cheques', rango: true } },
];

export default async function Cargar({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const acceso = await getAcceso();
  const permitidos = acceso ? TIPOS.filter((t) => acceso.puedeEscribir(t.modulo)) : [];
  if (!acceso || !permitidos.length) return <SinAcceso seccion="Cargar datos" />;

  const { tipo: pedido } = await searchParams;
  const enExcel = pedido === 'excel';
  const actual = permitidos.find((t) => t.id === pedido) ?? permitidos[0];
  const hoy = hoyAR();
  const db = await createClient();

  let cuerpo: React.ReactNode;
  if (enExcel) {
    cuerpo = (
      <ExcelPanel
        hoy={hoy}
        exportables={TIPOS.filter((t) => acceso.puedeVer(t.modulo)).map((t) => t.excel)}
        importables={permitidos.map((t) => t.excel)}
      />
    );
  } else {
    const [formulario, items] = await Promise.all([
      actual.id === 'viaje' ? catalogoViaje(db).then((c) => <FormViaje catalogo={c} hoy={hoy} />)
        : actual.id === 'combustible' ? catalogoCombustible(db).then((c) => <FormCombustible catalogo={c} hoy={hoy} />)
        : actual.id === 'proveedor' ? catalogoProveedor(db).then((c) => <FormProveedor catalogo={c} hoy={hoy} />)
        : catalogoCheque(db).then((c) => <FormCheque catalogo={c} hoy={hoy} />),
      historial(db, actual.id).catch(() => []),
    ]);
    cuerpo = (
      <>
        <div className="panel">
          <h2 style={{ marginBottom: 12 }}>{actual.titulo}</h2>
          {formulario}
        </div>
        <div className="panel">
          <h2 style={{ marginBottom: 4 }}>Lo que cargaste desde la app</h2>
          <p className="note" style={{ marginBottom: 10 }}>Podés anular lo cargado por error. Lo que vino de la planilla no aparece acá: se corrige en la planilla.</p>
          <Historial tipo={actual.id} items={items} />
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Cargar datos</h1>
      <p className="lede">
        Cargá directo en el sistema, con las mismas columnas de tus planillas. Los menús desplegables ofrecen lo que ya usás (lo más frecuente
        primero) y también dejan escribir uno nuevo. Podés adjuntar una foto o PDF a cada registro. Con <strong>Excel</strong> exportás e
        importás con el formato de las planillas.
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="seg">
          {permitidos.map((t) => (
            <Link key={t.id} href={`/cargar?tipo=${t.id}`} aria-pressed={!enExcel && actual.id === t.id}>{t.label}</Link>
          ))}
          <Link href="/cargar?tipo=excel" aria-pressed={enExcel}>Excel</Link>
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>Cobranzas de clientes y caja diaria: próximamente.</span>
      </div>
      {cuerpo}
    </>
  );
}
