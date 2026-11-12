/* Constantes de permisos, seguras para usar tanto en el servidor como en el navegador
   (no importan nada de servidor). La lógica que consulta la base está en permisos.ts. */

/** Módulos sobre los que se dan permisos. Cada uno protege sus tablas en la base (ver 0005_permisos.sql). */
export const MODULOS = [
  { key: 'viajes', label: 'Viajes (Operaciones)', ruta: '/operaciones' },
  { key: 'pedidos', label: 'Pedidos', ruta: '/pedidos' },
  { key: 'combustible', label: 'Combustible', ruta: '/combustible' },
  { key: 'certificados', label: 'Certificados', ruta: '/certificados' },
  { key: 'clientes', label: 'Saldos de clientes', ruta: '/clientes' },
  { key: 'proveedores', label: 'Saldos de proveedores', ruta: '/proveedores' },
  { key: 'cheques', label: 'Cheques', ruta: '/cheques' },
  { key: 'sistema', label: 'Estado del sistema', ruta: '/sistema' },
] as const;

export type Modulo = (typeof MODULOS)[number]['key'];
export type Nivel = 'ninguno' | 'lectura' | 'escritura';
export type Rol = 'sin_acceso' | 'lector' | 'operador' | 'admin';

export const NIVELES: { key: Nivel; label: string }[] = [
  { key: 'ninguno', label: 'Sin acceso' },
  { key: 'lectura', label: 'Solo ver' },
  { key: 'escritura', label: 'Ver y cargar' },
];
