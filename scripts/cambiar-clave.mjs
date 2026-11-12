// Cambia la contraseña de un usuario usando la API de administración de Supabase (la misma que usa la pantalla Usuarios).
// Uso:  node scripts/cambiar-clave.mjs email@ejemplo.com NuevaClave123
// Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local. Muestra a qué proyecto apunta, para detectar si
// es otro distinto del que ves en el panel de Supabase.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Uso: node scripts/cambiar-clave.mjs email@ejemplo.com NuevaClave (8+ caracteres)');
  process.exit(1);
}
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local'); process.exit(1); }
console.log('Proyecto:', url);

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let usuario = null;
for (let page = 1; !usuario; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error(error.message); process.exit(1); }
  usuario = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
  if (data.users.length < 200) break;
}
if (!usuario) { console.error('No existe un usuario con ese email en ese proyecto.'); process.exit(1); }
const { error } = await db.auth.admin.updateUserById(usuario.id, { password, email_confirm: true, ban_duration: 'none' });
if (error) { console.error(error.message); process.exit(1); }
console.log('Listo: contraseña cambiada para', usuario.email);
