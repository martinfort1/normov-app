import type { Metadata } from 'next';
import Link from 'next/link';
import { EMPRESA } from '@/lib/empresa';
import './home.css';

export const metadata: Metadata = {
  title: `${EMPRESA.nombre} · ${EMPRESA.razonSocial}`,
  description: EMPRESA.bajada,
};

const PASOS = [
  { t: 'Nos pedís', d: 'Nos decís qué material necesitás, cuántos metros y para cuándo.' },
  { t: 'Planificamos', d: 'Armamos el recorrido de los camiones del día según tu fecha de entrega.' },
  { t: 'Entregamos', d: 'Cada viaje sale con su remito y queda registrado.' },
  { t: 'Certificamos', d: 'Cerramos el período con un certificado claro de lo entregado.' },
];

const VENTAJAS = [
  { t: 'Flota propia', d: 'Camiones con capacidad conocida: sabemos cuánto llevamos en cada viaje.' },
  { t: 'Seguimiento de tu pedido', d: 'Controlamos cuánto se entregó y cuánto falta de cada material.' },
  { t: 'Remitos y certificados', d: 'Todo respaldado, sin planillas sueltas ni diferencias al cierre.' },
];

export default function Home() {
  const wa = EMPRESA.whatsapp && `https://wa.me/${EMPRESA.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, quería consultar por un pedido de material.')}`;
  const hayContacto = !!(wa || EMPRESA.email || EMPRESA.telefono || EMPRESA.zona);

  return (
    <div className="lp">
      <header className="lp-top">
        <span className="lp-logo">{EMPRESA.nombre}</span>
        <nav aria-label="Principal">
          <a href="#como">Cómo trabajamos</a>
          {hayContacto && <a href="#contacto">Contacto</a>}
          <Link className="lp-acceso" href="/login">Acceso del personal</Link>
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <p className="lp-eyebrow">{EMPRESA.razonSocial}</p>
          <h1>Materiales a tu obra, en tiempo y forma.</h1>
          <p className="lp-lede">{EMPRESA.bajada}</p>
          <div className="lp-cta">
            {wa ? <a className="lp-btn" href={wa} target="_blank" rel="noopener noreferrer">Pedir por WhatsApp</a>
              : hayContacto ? <a className="lp-btn" href="#contacto">Contactanos</a> : null}
            <a className="lp-btn ghost" href="#como">Cómo trabajamos</a>
          </div>
        </section>

        <section className="lp-sec" id="como">
          <h2>Cómo trabajamos</h2>
          <ol className="lp-pasos">
            {PASOS.map((p, i) => (
              <li key={p.t}><span className="lp-n">{i + 1}</span><h3>{p.t}</h3><p>{p.d}</p></li>
            ))}
          </ol>
        </section>

        <section className="lp-sec alt">
          <h2>Por qué elegirnos</h2>
          <div className="lp-cards">
            {VENTAJAS.map((v) => <div key={v.t} className="lp-card"><h3>{v.t}</h3><p>{v.d}</p></div>)}
          </div>
        </section>

        {hayContacto && (
          <section className="lp-sec" id="contacto">
            <h2>Contacto</h2>
            <ul className="lp-contacto">
              {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>}
              {EMPRESA.telefono && <li><a href={`tel:${EMPRESA.telefono.replace(/[^\d+]/g, '')}`}>{EMPRESA.telefono}</a></li>}
              {EMPRESA.email && <li><a href={`mailto:${EMPRESA.email}`}>{EMPRESA.email}</a></li>}
              {EMPRESA.zona && <li>{EMPRESA.zona}</li>}
            </ul>
          </section>
        )}
      </main>

      <footer className="lp-foot">
        <span>© {new Date().getFullYear()} {EMPRESA.razonSocial}</span>
        <Link href="/login">Acceso del personal</Link>
      </footer>
    </div>
  );
}
