'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  ['/operaciones', 'Operaciones'],
  ['/certificados', 'Certificados'],
  ['/clientes', 'Saldos clientes'],
  ['/proveedores', 'Saldos proveedores'],
  ['/cheques', 'Cheques'],
  ['/combustible', 'Combustible'],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Módulos">
      {TABS.map(([href, txt]) => (
        <Link key={href} href={href} aria-current={path.startsWith(href) ? 'page' : undefined}>{txt}</Link>
      ))}
    </nav>
  );
}
