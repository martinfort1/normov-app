# NORMOV · app de gestión

Sistema paralelo e independiente del artifact "NOR MOV Tablero". Next.js (App Router) + Supabase (Postgres, Auth).

## Estado (etapa 1: puente)

Los administrativos siguen cargando en Google Sheets. Un Apps Script instalado en cada planilla manda los datos solo
a la base, cada 15-30 minutos, sin que nadie tenga que exportar ni tocar nada. `npm run import` queda como respaldo manual.

```
Chofer → WhatsApp → Admin carga en Sheets → Apps Script (automático) → /api/sync → Postgres → Tablero
```

| Pieza | Estado |
|---|---|
| Esquema SQL (remitos, certificados, proveedores, cheques, combustible, roles, RLS, vistas) | corrido en producción |
| Función `crear_certificado` (0002, atómica) | **falta correr** si armaste tu proyecto antes de este cambio |
| Importador de planillas (.xlsx) | probado con datos reales (planilla y combustible); falta la planilla "Diego" |
| Login con email y contraseña | funcionando |
| Login con Google | pendiente (necesita Client ID de Google Cloud) |
| Operaciones (Día/Mes/Año/Rango, filtros por cliente/material/camión/chofer/cantera, torta por cliente) | funcionando |
| Combustible (con período y torta por patente) | funcionando |
| Saldos de clientes y de proveedores, Cheques (con filtro de período opcional, por vencimiento) | funcionando (clientes y proveedores necesitan la planilla "Diego" importada) |
| Certificados (armar, guardar, aprobar/anular, imprimir a PDF) | funcionando; el Excel queda pendiente |
| Lectura de remitos desde foto | pendiente (etapa 2) |
| Sync automático desde Google Sheets (`/api/sync` + Apps Script) | listo; **falta desplegar la app en algún lugar público e instalar el script en cada planilla** (ver abajo) |

Typecheck y build (`npm run typecheck`, `npm run build`) pasan sin errores. El funcionamiento en el navegador lo vas probando vos: si algo no anda o se ve raro, avisá con el error o una captura.

## Puesta en marcha

Requisitos: Node 20.6 o superior y una cuenta de Supabase.

1. **Proyecto Supabase:** crealo y copiá la URL, la `anon key` (o *publishable*) y la `service_role key` (o *secret*) desde Project Settings → API.
2. **Base:** pegá y ejecutá en el SQL Editor, en este orden, `supabase/migrations/0001_schema.sql` y después `0002_certificados_rpc.sql` (requiere Postgres 15 o superior, el default de Supabase).
3. **Primer usuario (email y contraseña):** en Supabase, Authentication → Users → *Add user* → *Create new user*. Ingresá email y contraseña y tildá *Auto Confirm User*.
   *Google (opcional, más adelante):* Authentication → Sign In / Providers → Google requiere un Client ID y Secret de Google Cloud. Al activarlo, poné `NEXT_PUBLIC_GOOGLE_LOGIN=1` en `.env.local` para que aparezca el botón.
4. **Variables:** `cp .env.example .env.local` y completalo.
5. **Instalar y correr:**
   ```bash
   npm install
   npm run dev
   ```
6. **Habilitarte:** el usuario del paso 3 queda como `sin_acceso`. En el SQL Editor:
   ```sql
   update profiles set rol = 'admin' where email = 'tu@mail.com';
   ```
7. **Primera carga (manual, mientras no está el sync andando):** en Google Drive, *Archivo → Descargar → .xlsx* de las tres planillas, guardalas en `data/` y corré:
   ```bash
   npm run import -- --planilla data/planilla.xlsx --diego data/diego.xlsx --comb data/combustible.xlsx
   ```
   Se puede repetir sin duplicar datos. Sirve como respaldo aunque el sync automático ya esté funcionando.

## Sync automático desde Google Sheets

Una vez que esto está armado, nadie vuelve a exportar ni a tocar `npm run import` a mano: cada planilla se sincroniza sola.

**1. Desplegar la app en algún lugar público.** El endpoint `/api/sync` tiene que tener una URL a la que Google pueda
llegar por internet; `localhost` no sirve. Lo más simple es [Vercel](https://vercel.com) (gratis para este tamaño de
proyecto): conectá el repositorio de GitHub y cargá ahí las mismas variables que tenés en `.env.local`
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET`). Si querés,
te ayudo con este paso cuando llegues.

**2. Por cada una de las tres planillas** (Planilla NORMOV 2026, NORMOV Diego 2026, Planilla Combustible):

> ⚠️ Si la planilla ya tiene un script instalado (por ejemplo el que hace que el artifact pueda escribir remitos,
> cheques o pagos de vuelta en la hoja), **no lo borres ni lo reemplaces**. Es un mecanismo aparte, en el sentido
> contrario (app → planilla en vez de planilla → app), y no comparte ningún nombre de función con lo de acá abajo:
> conviven sin problema en el mismo proyecto de Apps Script.

   1. Abrí la planilla → **Extensiones → Apps Script**.
   2. Sin tocar los archivos que ya haya, creá uno nuevo (ícono `+` junto a "Archivos"). Apps Script agrega la
      extensión `.gs` solo, así que al nombrarlo escribí **`comun`**, sin extensión (queda `comun.gs`). Pegá ahí
      el contenido de `apps-script/_comun.gs.js` (de este proyecto).
   3. Creá otro archivo nuevo, esta vez nombrándolo (también sin extensión) `sync-planilla`, `sync-diego` o
      `sync-combustible` según la planilla, y pegá el contenido del `.gs.js` que corresponda.
   4. **Configuración del proyecto** (ícono de engranaje) → **Propiedades del script** → agregá:
      - `SYNC_URL` = `https://tu-dominio/api/sync` (la URL de Vercel del paso 1)
      - `SYNC_SECRET` = el mismo valor que `SYNC_SECRET` en Vercel/`.env.local` (guardalo también en tu gestor de contraseñas: en Vercel, marcado como *Sensitive*, no se puede volver a ver)
      - `AVISO_EMAIL` (opcional) = tu email, para que te avise si el sync falla
   5. Seleccioná la función `sincronizar` en el desplegable de arriba y ejecutala una vez a mano (▶) para probarla y aceptar los permisos que pida Google.
   6. **Activadores** (ícono del reloj) → **Agregar activador** → función `sincronizar`, origen del evento *Basado en tiempo*, cada 15 o 30 minutos. Esto no toca los activadores que ya tenga el script existente de esa planilla.

Listo: desde ahí, los cambios en cada planilla llegan solos a la base, sin que nadie exporte nada.

## Supuestos y límites a tener en cuenta

- **El endpoint `/api/sync` es la puerta de entrada desde afuera.** Solo acepta pedidos con el `SYNC_SECRET` correcto; guardalo como guardarías una contraseña (no lo subas a GitHub, ya está en `.gitignore` por estar en `.env.local`).
- **Tamaño:** cada sync manda la hoja entera. Con el volumen actual de NORMOV no debería haber problema, pero si algún día una hoja crece mucho (varias decenas de miles de filas), puede llegar a chocar con el límite de tamaño de pedido de Vercel; en ese caso habría que mandar solo las filas nuevas en vez de la hoja completa.

- **Remitos:** la clave es (número, fecha) — el número de remito se reutiliza con el tiempo, no es un identificador global. Si la misma combinación número+fecha se repite dentro de la planilla, gana la última fila. Los viajes sin número propio se guardan igual, con una clave interna ("SR-…") armada a partir de sus otros datos; en la interfaz se muestran como "(sin número)" y no entran como candidatos a certificar salvo que se tilde esa opción explícitamente al armar el certificado.
- **Borrados:** una fila que se borra de la planilla no se borra de la base (el importador solo agrega y actualiza).
- **Cheques y movimientos:** se identifican por un hash del contenido. Si se corrige en la planilla un importe o una fecha, el importador lo ve como una fila nueva y deja la anterior. Los cambios de *estado* de un cheque sí se actualizan, porque el estado no entra en el hash. Es una limitación de la etapa puente que desaparece cuando la carga pase a la app.
- **Semáforo de cheques:** "por vencer" = 7 días. Es una suposición mía; no la copié del artifact.
- **Saldos de clientes:** por ahora se guardan tal como los calculan las planillas (`saldos_clientes_planilla`).
- **Roles:** `lector` ve; `operador` ve y escribe; `admin` además aprueba certificados y promueve usuarios. Todo usuario nuevo entra sin acceso.
- **Numeración de certificados:** es una secuencia de la base. Si ya emitiste certificados con el artifact, ajustá el arranque, por ejemplo `alter table certificados alter column numero restart with 120;`.
- `xlsx` (SheetJS 0.18) se usa solo en el script local con archivos propios. No lo uses para leer archivos de terceros.

## Estructura

```
supabase/migrations/       esquema, triggers, vistas y políticas RLS
apps-script/                scripts a instalar en cada Google Sheet (sync automático)
src/app/api/sync/route.ts   recibe el push del Apps Script y lo sube a la base
scripts/import-sheets.ts    importador manual (.xlsx), respaldo de la etapa puente
src/lib/sheets/parsers.ts   lectura de las hojas (filas → objetos)
src/lib/sheets/importar.ts  las mismas subidas a Supabase, compartidas por el script y /api/sync
src/app/(app)/               pantallas protegidas
src/middleware.ts            exige sesión en todo salvo /login
```
