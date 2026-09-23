'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/* Íconos porteados del tablero de FRAN (mismo trazo, mismo viewBox). */
const ICO: Record<string, string> = {
  viajes: '<path d="M1 4.5h8.5v6H1zM9.5 6.5h3l2 2v2h-5z"/><circle cx="4" cy="12" r="1.3"/><circle cx="11.5" cy="12" r="1.3"/>',
  fuel: '<path d="M2.5 14V3a1 1 0 0 1 1-1H7a1 1 0 0 1 1 1v11M1.5 14h8M3 6h4"/><path d="M10 6.5h1.8a1 1 0 0 1 1 1V11a1 1 0 0 0 2 0V7L13 5"/>',
  cert: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h3.5"/>',
  cli: '<circle cx="8" cy="5" r="2.6"/><path d="M2.8 14c0-2.7 2.3-4.4 5.2-4.4s5.2 1.7 5.2 4.4"/>',
  prov: '<path d="M2 5.5 8 2.5l6 3v5l-6 3-6-3z"/><path d="M2 5.5 8 8.5l6-3M8 8.5v6"/>',
  caja: '<rect x="1.5" y="4" width="13" height="8.5" rx="1.2"/><circle cx="8" cy="8.2" r="2"/><path d="M4 4V2.8h8V4"/>',
  chq: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.2"/><path d="M4 7h4M4 9.5h2.5M10 9.5l1.3 1.3L14 8.2"/>',
  cf: '<path d="M1.8 12.5 5.5 8l3 2.5 5-7"/><path d="M13.5 3.5h-3M13.5 3.5v3"/><path d="M1.8 14.2h12.4"/>',
  load: '<path d="M8 12.5V4M4.5 7.5 8 4l3.5 3.5M2.5 14h11"/>',
  sistema: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.1 1.3"/>',
};
function Icon({ id }: { id: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICO[id] ?? '' }} />
  );
}

interface Item { href: string; label: string; icon: string; badge?: number }
interface Group { titulo: string; items: Item[] }

type Modo = 'open' | 'mini' | 'off';

export function ShellClient({ pendientesCert, children }: { pendientesCert: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const [modo, setModo] = useState<Modo>('open');
  const [drawer, setDrawer] = useState(false);
  const [listo, setListo] = useState(false); // evita el parpadeo mientras se lee localStorage

  useEffect(() => {
    try {
      const guardado = localStorage.getItem('normov.side');
      if (guardado === 'mini' || guardado === 'off' || guardado === 'open') setModo(guardado);
    } catch { /* localStorage puede fallar en privado: seguimos con 'open' */ }
    setListo(true);
  }, []);

  useEffect(() => {
    const onToggle = () => {
      if (window.matchMedia('(max-width: 980px)').matches) setDrawer((d) => !d);
      else setModo((m) => (m === 'off' ? 'open' : 'off'));
    };
    window.addEventListener('normov:toggle-menu', onToggle);
    return () => window.removeEventListener('normov:toggle-menu', onToggle);
  }, []);

  useEffect(() => { setDrawer(false); }, [pathname]); // cerrar el cajón al navegar

  function cambiarModo(m: Modo) {
    setModo(m);
    try { localStorage.setItem('normov.side', m); } catch { /* no pasa nada si falla */ }
  }

  const GROUPS: Group[] = [
    { titulo: 'Operaciones', items: [
      { href: '/operaciones', label: 'Viajes', icon: 'viajes' },
      { href: '/combustible', label: 'Combustible', icon: 'fuel' },
    ] },
    { titulo: 'Certificados', items: [
      { href: '/certificados', label: 'Certificados', icon: 'cert', badge: pendientesCert || undefined },
    ] },
    { titulo: 'Cuentas', items: [
      { href: '/clientes', label: 'Clientes', icon: 'cli' },
      { href: '/proveedores', label: 'Proveedores', icon: 'prov' },
    ] },
    { titulo: 'Finanzas', items: [
      { href: '/caja', label: 'Caja diaria', icon: 'caja' },
      { href: '/cheques', label: 'Cheques', icon: 'chq' },
      { href: '/cashflow', label: 'Cash flow', icon: 'cf' },
    ] },
    { titulo: 'Cargar', items: [
      { href: '/cargar', label: 'Cargar datos', icon: 'load' },
    ] },
    { titulo: 'Sistema', items: [
      { href: '/sistema', label: 'Sistema', icon: 'sistema' },
    ] },
  ];

  const mini = modo === 'mini';
  return (
    <div className={`shell${listo && mini ? ' mini' : ''}${listo && modo === 'off' ? ' off' : ''}`}>
      <nav className={`side${mini ? ' mini' : ''}${drawer ? ' drawer' : ''}`} aria-label="Secciones">
        <div className="side-top">
          <button className="btn ghost sm" type="button" onClick={() => cambiarModo(mini ? 'open' : 'mini')}
            title={mini ? 'Ensanchar el menú' : 'Angostar el menú'} aria-label={mini ? 'Ensanchar el menú' : 'Angostar el menú'}>
            {mini ? '»' : '«'}
          </button>
        </div>
        {GROUPS.map((g) => (
          <div className="sgroup" key={g.titulo}>
            <h4>{g.titulo}</h4>
            {g.items.map((it) => {
              const activo = pathname === it.href || pathname.startsWith(it.href + '/');
              return (
                <Link key={it.href} href={it.href} className="sitem" aria-current={activo ? 'page' : undefined} title={it.label}>
                  <Icon id={it.icon} /><span className="t">{it.label}</span>
                  {!!it.badge && <span className="n">{it.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      {drawer && <div className="scrim on" onClick={() => setDrawer(false)} />}
      <div className="wrap">{children}</div>
    </div>
  );
}
