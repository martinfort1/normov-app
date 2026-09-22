'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Checkbox que prende/apaga el filtro por período (ej.: cheques, filtrados por defecto solo por estado). */
export function TogglePeriodo({ label }: { label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const activo = sp.get('conPeriodo') === '1';

  function cambiar(v: boolean) {
    const params = new URLSearchParams(sp.toString());
    v ? params.set('conPeriodo', '1') : params.delete('conPeriodo');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="row" style={{ gap: 6, fontSize: 13.5, cursor: 'pointer' }}>
      <input type="checkbox" checked={activo} onChange={(e) => cambiar(e.target.checked)} style={{ minHeight: 'auto' }} />
      {label}
    </label>
  );
}
