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
| Migraciones 0002 (certificados atómicos), 0003 (clave de remito por fecha) | corridas en producción |
| Migración 0004 (`sync_log`, pantalla Sistema) | **falta correr** si la pantalla Sistema avisa que falta la tabla; va ANTES que la 0005 |
| Migración 0005 (permisos por usuario y por sección, pantalla Usuarios) | corrida |
| Migraciones 0008 y 0009 (sección **Pedidos**: tablero Pendientes / Realizado, vínculo con viajes) | **nuevas — falta correr, en ese orden** (la 0008 sola, después la 0009). Los usuarios existentes heredan su nivel de Viajes. Hace falta además la 0007 |
| Migración 0007 (ID único por viaje; permite remitos repetidos) | **nueva — falta correr**, después de 0005 y 0006 y de desplegar el código; luego `sincronizar` la Planilla |
| Migración 0006 (carga de datos: columnas nuevas, quién cargó, adjuntos) | **nueva — falta correr**, después de la 0005 (el sync sigue andando sin ella; Cargar datos no funciona hasta correrla) |
| Importador de planillas (.xlsx) | respaldo manual; el sync automático ya cubre las tres planillas |
| Login con email y contraseña | funcionando, en producción (Vercel) |
| Login con Google | pendiente (necesita Client ID de Google Cloud) |
| Operaciones (Día/Mes/Año/Rango, filtros por cliente/material/camión/chofer/cantera, torta por cliente) | funcionando |
| Combustible (con período y torta por patente) | funcionando |
| Saldos de clientes y de proveedores, Cheques (con filtro de período opcional, por vencimiento) | funcionando |
| Certificados (armar, guardar, aprobar/anular, imprimir a PDF, exportar Excel) | funcionando |
| Pantalla "Sistema" (estado del sync, historial) | funcionando |
| Pantalla "Usuarios" (crear cuentas, permisos por sección) | funcionando |
| Cargar datos: viaje, combustible, proveedor, cheque (menús desplegables, adjunto de foto o PDF, anular lo cargado por error) | nuevo — necesita la migración 0006 |
| Excel: exportar con las columnas de las planillas e importar (con revisión previa) | nuevo — necesita la migración 0006 |
| Cargar datos: cobranzas de clientes y caja diaria | pendiente (necesitan tablas nuevas) |
| Lectura de remitos desde foto | pendiente (etapa 2) |
| Sync automático desde Google Sheets (`/api/sync` + Apps Script) | **en producción**, con activadores cada 15-30 min en las tres planillas |

Typecheck y build (`npm run typecheck`, `npm run build`) pasan sin errores. El funcionamiento en el navegador lo vas probando vos: si algo no anda o se ve raro, avisá con el error o una captura.

## Hacia el reemplazo de las planillas

Hoy las planillas siguen siendo la fuente de verdad y la app las lee. La meta es la inversa: que se cargue todo
en la app, con cada persona viendo y cargando solo lo suyo, y que las planillas queden como archivo. En orden:

1. **Permisos por usuario y sección** — hecho (migración 0005, pantalla Usuarios).
2. **Carga directa a la base**, cada formulario protegido por el permiso de su sección. Hecho: viaje, combustible, movimiento de proveedor y cheque (alta), con anulación de lo cargado por error, adjunto de foto/PDF y Excel de ida y vuelta. Falta: cobro / certificación de cliente, caja diaria y cambio de estado de cheques. Es lo que hace la pestaña "Cargar" del tablero de FRAN, pero escribiendo en la base en vez de en Drive.
3. **Lo que hoy solo existe en las planillas**: cuenta corriente de clientes con imputación de cobros (para "certificado sin cobrar / cobrado" y "viajes sin certificar"), caja diaria con saldos por cuenta, y cash flow proyectado.
4. **Corte**: cuando una sección ya se carga en la app, se apaga el sync de esa planilla (si no, el sync pisaría las correcciones hechas en la app con lo que dice la planilla). Antes del corte conviene un respaldo completo en Excel.

## Puesta en marcha

Requisitos: Node 20.6 o superior y una cuenta de Supabase.

1. **Proyecto Supabase:** crealo y copiá la URL, la `anon key` (o *publishable*) y la `service_role key` (o *secret*) desde Project Settings → API.
2. **Base:** pegá y ejecutá en el SQL Editor, en orden, los archivos de `supabase/migrations/` (0001, 0002, 0003, 0004…). Requiere Postgres 15 o superior, el default de Supabase.
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

- **Remitos / viajes:** cada viaje tiene su propio **ID** (columna `ID VIAJE` de la planilla, `V000123`; los cargados desde la app reciben `A000001…`). El número de remito y la fecha ya no identifican nada: pueden repetirse y todos los viajes se conservan (la interfaz marca "repetido" como advertencia; evitar duplicados es responsabilidad de quien carga). Los viajes sin número se muestran como "(sin número)" y no entran como candidatos a certificar salvo que se tilde esa opción al armar el certificado. Cada viaje puede estar en un solo certificado vigente.
- **Orden de despliegue de la migración 0007 (ID de viaje):** primero subir el código (funciona antes y después de la migración), después correr `0007_id_viaje.sql`, y por último ejecutar `sincronizar` de la Planilla: esa primera vez los viajes viejos adoptan su ID y se crean los que faltaban.
- **Borrados:** una fila que se borra de la planilla no se borra de la base (el importador solo agrega y actualiza).
- **Cheques y movimientos:** se identifican por un hash del contenido. Si se corrige en la planilla un importe o una fecha, el importador lo ve como una fila nueva y deja la anterior. Los cambios de *estado* de un cheque sí se actualizan, porque el estado no entra en el hash. Es una limitación de la etapa puente que desaparece cuando la carga pase a la app.
- **Semáforo de cheques:** "por vencer" = 7 días. Es una suposición mía; no la copié del artifact.
- **Saldos de clientes:** por ahora se guardan tal como los calculan las planillas (`saldos_clientes_planilla`).
- **Permisos:** cada usuario tiene un nivel por sección (Viajes, Combustible, Certificados, Saldos de clientes, Saldos de proveedores, Cheques, Sistema): *sin acceso*, *solo ver* o *ver y cargar*. El rol `admin` accede a todo, es el único que aprueba certificados y gestiona usuarios (pantalla Usuarios). `sin_acceso` es una cuenta pendiente o desactivada. Los permisos los hace cumplir la base de datos (RLS, migración 0005), no solo las pantallas; la pantalla además oculta lo que no corresponde. Armar un certificado necesita *ver y cargar* en Certificados y *ver* en Viajes (los remitos salen de ahí).
- **Pruebas de la base:** `cd supabase/tests && npm install && npm test` corre todas las migraciones sobre un Postgres en memoria (PGlite) y comprueba que cada tipo de usuario vea y cambie solo lo que debe. No toca ninguna base real. Conviene correrlas antes de aplicar una migración nueva.
- **Numeración de certificados:** es una secuencia de la base. Si ya emitiste certificados con el artifact, ajustá el arranque, por ejemplo `alter table certificados alter column numero restart with 120;`.
- **Excel (SheetJS):** la importación desde la app lee archivos subidos por usuarios con permiso de carga (máx. 4 MB). La versión instalada, `xlsx` 0.18.5, tiene vulnerabilidades conocidas con archivos de terceros; para el uso interno actual el riesgo es bajo, pero conviene actualizar a la 0.20.x, que SheetJS publica solo en su sitio y no en npm: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **Adjuntos:** se guardan en el almacenamiento privado `adjuntos` de Supabase, en una carpeta por sección (`viajes/`, `combustible/`, `proveedores/`, `cheques/`). Ver un adjunto exige poder ver esa sección; subirlo o borrarlo, poder cargar en ella (políticas de la migración 0006). Las fotos se achican a ~1600 px antes de subir. Los links para verlos son temporales (2 minutos).
- **Cargas desde la app vs. planilla:** lo cargado desde la app queda marcado (`origen`, autor) y solo eso se puede anular desde la app. Mientras el sync de las planillas siga activo, algo cargado en la app *y* en la planilla se reconoce como la misma fila (comparten la misma clave) en viajes con remito, combustible, proveedores y cheques; si se corrige un dato en un lado, el sync lo trata como una fila nueva (limitación ya conocida de la etapa puente).
- **Excel de ida y vuelta:** la exportación trae una columna ID (`ID VIAJE` en Viajes). Al importar, las filas con ID se actualizan en su lugar aunque cambies su número, fecha o contenido; las filas sin ID (por ejemplo, una descarga directa de Google Sheets) se reconocen por su clave natural. Las columnas que en la planilla son fórmulas (Saldo Acumulado, IDC, ICL…) salen vacías.

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
