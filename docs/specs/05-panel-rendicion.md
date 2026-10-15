# 05 — Panel público y rendición

## Objetivo

Que cualquier socio vea en qué se usa la plata sin pedir permiso, y que la rendición mensual salga sola en la web y en un PDF con el formato de rendición.

Es lo que un juez ve primero, así que tiene que verse sobrio, claro y confiable. No tiene que parecer una app cripto.

## Archivos

**Le pertenecen:**
- `app/src/app/page.tsx`, que es el panel.
- `app/src/app/layout.tsx` y `app/src/app/globals.css`, que son el layout y los estilos globales de toda la app.
- `app/src/app/rendicion/**`.
- `app/src/app/api/reports/**`.
- `app/src/lib/report/**`.
- `app/src/components/**`, los componentes compartidos. Puede ofrecer a otros módulos, por ejemplo, `Money`, `Card` y `TxLink`.

**No toca:**
- Otros directorios.
- El esquema de la base, que se pide.
- No corre `npm install`. Están Tailwind 4 y `@react-pdf/renderer`.

## Datos

Lee solo de Postgres, de las tablas que llena el indexador del módulo 03:
- `contributions`, `payments`, `invoices`;
- `budget_lines`, `budget_index`;
- `proposals`, `approvals`, `chain_events`;
- `cooperadora`.

Para el saldo actual puede leer la cadena con `getTreasuryState()` de `@/lib/chain/treasury`. Esa función todavía se está construyendo: hay que abstraerla detrás de una función local que acepte un fallback (la suma de la base), para que el panel funcione igual.

Para los tests se usa `createTestDb()` con datos sembrados.

## Panel (`/`)

- **Encabezado:** nombre de la cooperadora, escuela, CUIT y nº RUCE. Saldo actual en pesos.
- **Banner** si alguna partida tiene `periodEnd` vencido: "Presupuesto 2026 vencido, en uso hasta la próxima asamblea".
- **Partidas:** asignado, gastado y disponible, con una barra simple. Si una partida está excedida, se marca en rojo.
- **Aportes por mes:** cantidad y total. **Nunca nombres.**
- **Egresos**, del más reciente al más viejo. De cada uno se muestra:
  - fecha, proveedor, CUIT y partida;
  - monto;
  - cómo se pagó: "Automático (dentro del tope)" o "Con firmas (2 de 3)";
  - link a la factura y a la transacción;
  - marcas de "excedió la partida" y de "presupuesto vencido".
- **Pagos pendientes de firma:** cuántas firmas tiene y cuántas faltan.
- **Cambios de presupuesto y configuración:** qué cambió, el motivo y quién firmó (rol, no dirección cruda, si se puede resolver).
- **Rendiciones publicadas:** links a cada una.

Server component con revalidación corta (30 a 60 segundos). Funciona en un celular a 360 px de ancho.

## Rendición

**`buildReport(db, period: "YYYY-MM")`** en `lib/report/`. Devuelve un objeto con:
- encabezado;
- saldo inicial y saldo final;
- ingresos por concepto: aportes de socios, aportes sin identificar, especie y trabajo (estos dos se cargan a mano);
- egresos con fecha, proveedor, CUIT, tipo y número de comprobante, concepto, partida, monto, regla y link;
- resumen por partida;
- cambios de presupuesto;
- bloque de firmas.

Tiene que ser determinista y testeado.

**Columnas:** usar el borrador de `docs/investigacion-cooperadoras.md`, sección 5. Cada columna se define en un solo lugar, para poder ajustarlas cuando se confirme el formato de la planilla CooperAr o de Jujuy.

**Ciclo de vida:**
- `POST /api/reports/close`, interno, protegido con `TICK_SECRET`. Lo llama el tick del módulo 06 al cerrar el mes. Crea el borrador en `reports`.
- `POST /api/reports/[period]/review`. El revisor confirma con un token de `sign_links` y el estado pasa a `revisada`, y de ahí a `publicada`.
- Al publicar se genera el PDF y se guarda en Vercel Blob, o en disco local si no hay `BLOB_READ_WRITE_TOKEN`. Ese storage va detrás de una función.

**Páginas:**
- `/rendicion/[period]`: la vista web. El borrador solo se ve con un token del revisor.
- `/rendicion/[period]/pdf`: descarga el PDF.

**PDF:**
- Se genera con `@react-pdf/renderer`, en A4 vertical.
- Lleva una tabla de egresos con todas sus columnas, totales y un espacio para firmas.
- El pie dice "Generado por Cooperadora Abierta. Verificable en <APP_URL>".

## Aceptación

- **Tests de `buildReport`** con datos sembrados:
  - totales cuadran: saldo inicial + ingresos − egresos = saldo final;
  - aportes sin nombres;
  - especie y trabajo incluidos;
  - pago excedido marcado;
  - mes sin movimientos.
- **Test del PDF:** se genera, pesa más de 0 bytes y contiene el texto de los totales, verificado extrayéndolo con `pdfjs-dist`.
- **Panel:** `npm run build` compila, y un test renderiza la página con una base sembrada sin romperse.
- `npx tsc --noEmit` sin errores en el módulo.

## Reporte

Archivos, componentes que ofrece a otros módulos, columnas o datos pedidos, resultado de tests y estado.
