# NORMOV · app de gestión

Sistema paralelo e independiente del artifact "NOR MOV Tablero". Next.js (App Router) + Supabase (Postgres, Auth).

## Estado (etapa 1: puente)

Los administrativos siguen cargando en Google Sheets. Un script copia las planillas a Postgres y el tablero lee de la base.

```
Chofer → WhatsApp → Admin carga en Sheets → npm run import → Postgres → Tablero
```

| Pieza | Estado |
|---|---|
| Esquema SQL (remitos, certificados, proveedores, cheques, combustible, roles, RLS, vistas) | corrido en producción |
| Función `crear_certificado` (0002, atómica) | **falta correr** si armaste tu proyecto antes de este cambio |
| Importador de planillas (.xlsx) | probado con datos reales (planilla y combustible); falta la planilla "Diego" |
| Login con email y contraseña | funcionando |
| Login con Google | pendiente (necesita Client ID de Google Cloud) |
| Operaciones (con selector Día/Mes/Año/Rango y torta por cliente) | funcionando |
| Combustible (con período y torta por patente) | funcionando |
| Saldos de clientes y de proveedores, Cheques | funcionando (clientes y proveedores necesitan la planilla "Diego" importada) |
| Certificados (armar, guardar, aprobar/anular, imprimir a PDF) | funcionando; el Excel queda pendiente |
| Lectura de remitos desde foto | pendiente (etapa 2) |
| Sync automático desde Google Sheets (sin exportar a mano) | pendiente |

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
7. **Importar datos:** en Google Drive, *Archivo → Descargar → .xlsx* de las tres planillas, guardalas en `data/` y corré:
   ```bash
   npm run import -- --planilla data/planilla.xlsx --diego data/diego.xlsx --comb data/combustible.xlsx
   ```
   Se puede repetir sin duplicar datos.

## Supuestos y límites a tener en cuenta

- **Remitos:** la clave es el número de remito. Los que no tienen número se omiten y se informan; si un número está repetido, gana la última fila.
- **Borrados:** una fila que se borra de la planilla no se borra de la base (el importador solo agrega y actualiza).
- **Cheques y movimientos:** se identifican por un hash del contenido. Si se corrige en la planilla un importe o una fecha, el importador lo ve como una fila nueva y deja la anterior. Los cambios de *estado* de un cheque sí se actualizan, porque el estado no entra en el hash. Es una limitación de la etapa puente que desaparece cuando la carga pase a la app.
- **Semáforo de cheques:** "por vencer" = 7 días. Es una suposición mía; no la copié del artifact.
- **Saldos de clientes:** por ahora se guardan tal como los calculan las planillas (`saldos_clientes_planilla`).
- **Roles:** `lector` ve; `operador` ve y escribe; `admin` además aprueba certificados y promueve usuarios. Todo usuario nuevo entra sin acceso.
- **Numeración de certificados:** es una secuencia de la base. Si ya emitiste certificados con el artifact, ajustá el arranque, por ejemplo `alter table certificados alter column numero restart with 120;`.
- `xlsx` (SheetJS 0.18) se usa solo en el script local con archivos propios. No lo uses para leer archivos de terceros.

## Estructura

```
supabase/migrations/   esquema, triggers, vistas y políticas RLS
scripts/import-sheets.ts   importador (etapa puente)
src/lib/sheets/parsers.ts  lectura de las planillas (portado del artifact)
src/app/(app)/         pantallas protegidas
src/middleware.ts      exige sesión en todo salvo /login
```
