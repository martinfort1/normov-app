'use client';
import { useState, useTransition } from 'react';
import { MODULOS, NIVELES, type Modulo, type Nivel } from '@/lib/modulos';
import { guardarUsuario, crearUsuario, cambiarPassword, type Estado, type Preset } from './actions';

export interface UsuarioVista {
  id: string; email: string; nombre: string; estado: Estado; niveles: Record<Modulo, Nivel>; esYo: boolean;
}

const ESTADOS: { key: Estado; label: string }[] = [
  { key: 'sin_acceso', label: 'Sin acceso (pendiente o desactivado)' },
  { key: 'usuario', label: 'Usuario (permisos por sección)' },
  { key: 'admin', label: 'Administrador (todo, y aprueba certificados)' },
];

const todos = (n: Nivel) => Object.fromEntries(MODULOS.map((m) => [m.key, n])) as Record<Modulo, Nivel>;

function Aviso({ msg }: { msg: { tipo: 'good' | 'bad'; texto: string } | null }) {
  return msg ? <span className={`pill ${msg.tipo}`}>{msg.texto}</span> : null;
}

function Tarjeta({ u }: { u: UsuarioVista }) {
  const [nombre, setNombre] = useState(u.nombre);
  const [estado, setEstado] = useState<Estado>(u.estado);
  const [niveles, setNiveles] = useState<Record<Modulo, Nivel>>(u.niveles);
  const [clave, setClave] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'good' | 'bad'; texto: string } | null>(null);
  const [pending, start] = useTransition();

  function guardar() {
    setMsg(null);
    start(async () => {
      const r = await guardarUsuario({ id: u.id, nombre, estado, niveles });
      setMsg(r.error ? { tipo: 'bad', texto: r.error } : { tipo: 'good', texto: 'Guardado' });
    });
  }
  function nuevaClave() {
    setMsg(null);
    start(async () => {
      const r = await cambiarPassword(u.id, clave);
      if (!r.error) setClave('');
      setMsg(r.error ? { tipo: 'bad', texto: r.error } : { tipo: 'good', texto: 'Contraseña cambiada' });
    });
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" aria-label="Nombre" style={{ fontWeight: 600, minWidth: 220 }} />
          <span className="muted" style={{ fontSize: 13 }}>{u.email}{u.esYo ? ' · sos vos' : ''}</span>
        </div>
        <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)} aria-label="Tipo de cuenta" disabled={u.esYo}>
          {ESTADOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {estado === 'usuario' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, marginTop: 12 }}>
            {MODULOS.map((m) => (
              <label key={m.key} style={{ display: 'grid', gap: 3, fontSize: 12.5, color: 'var(--muted)' }}>
                {m.label}
                <select value={niveles[m.key]} onChange={(e) => setNiveles({ ...niveles, [m.key]: e.target.value as Nivel })} style={{ color: 'var(--ink)' }}>
                  {NIVELES.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>Atajos:</span>
            <button type="button" className="btn sm" onClick={() => setNiveles(todos('lectura'))}>Solo ver todo</button>
            <button type="button" className="btn sm" onClick={() => setNiveles(todos('escritura'))}>Ver y cargar todo</button>
            <button type="button" className="btn sm" onClick={() => setNiveles(todos('ninguno'))}>Quitar todo</button>
          </div>
        </>
      )}
      {estado === 'admin' && <p className="note" style={{ marginTop: 12 }}>Los administradores acceden a todas las secciones, aprueban certificados y gestionan usuarios.</p>}
      {estado === 'sin_acceso' && <p className="note" style={{ marginTop: 12 }}>No puede entrar a la app hasta que lo pases a &quot;Usuario&quot; o &quot;Administrador&quot;.</p>}

      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
        <div className="row">
          <button type="button" className="primary" onClick={guardar} disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</button>
          <Aviso msg={msg} />
        </div>
        <div className="row">
          <input type="text" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="Nueva contraseña" aria-label="Nueva contraseña" autoComplete="off" style={{ width: 170 }} />
          <button type="button" className="btn sm" onClick={nuevaClave} disabled={pending || clave.length < 8}>Cambiar contraseña</button>
        </div>
      </div>
    </div>
  );
}

export function NuevoUsuario() {
  const [f, setF] = useState({ nombre: '', email: '', password: '', preset: 'lectura' as Preset });
  const [msg, setMsg] = useState<{ tipo: 'good' | 'bad'; texto: string } | null>(null);
  const [pending, start] = useTransition();

  function crear() {
    setMsg(null);
    start(async () => {
      const r = await crearUsuario(f);
      if (r.error) { setMsg({ tipo: 'bad', texto: r.error }); return; }
      setMsg({ tipo: 'good', texto: `Usuario creado. Pasale el email y la contraseña a ${f.nombre}.` });
      setF({ nombre: '', email: '', password: '', preset: 'lectura' });
    });
  }

  return (
    <div className="panel">
      <h2 style={{ marginBottom: 10 }}>Nuevo usuario</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre" aria-label="Nombre" />
        <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" aria-label="Email" autoComplete="off" />
        <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Contraseña inicial (8+)" aria-label="Contraseña inicial" autoComplete="off" />
        <select value={f.preset} onChange={(e) => setF({ ...f, preset: e.target.value as Preset })} aria-label="Permisos iniciales">
          <option value="lectura">Empieza viendo todo (solo lectura)</option>
          <option value="completo">Empieza viendo y cargando todo</option>
          <option value="ninguno">Sin acceso hasta que lo active</option>
        </select>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="primary" onClick={crear} disabled={pending}>{pending ? 'Creando…' : 'Crear usuario'}</button>
        <Aviso msg={msg} />
      </div>
      <p className="note" style={{ marginTop: 8 }}>Después de crearlo, ajustá sus permisos sección por sección en su tarjeta, acá abajo.</p>
    </div>
  );
}

export function ListaUsuarios({ usuarios }: { usuarios: UsuarioVista[] }) {
  return <>{usuarios.map((u) => <Tarjeta key={u.id} u={u} />)}</>;
}
