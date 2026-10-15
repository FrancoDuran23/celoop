# 08 — Agente auditor

## Objetivo

Que ningún pago salga sin que lo mire alguien que no lo propuso. El auditor es un segundo agente, con su propia llave y su propia identidad ERC-8004. Revisa cada pago que propone el tesorero antes de que pueda salir automático.

Es la separación de funciones de la contabilidad de siempre: el que paga no es el que controla.

**Regla de oro:** el auditor puede frenar un pago, nunca empujarlo. En el contrato solo tiene una acción, `auditPayment`, y con ella:

- **Aprueba un pago:** el pago sale si entra en los topes automáticos.
- **Observa un pago:** el pago queda para que lo firmen o lo rechacen las personas.

No firma, no propone, no pausa y no cobra.

## Por qué dos llaves

Sin auditor, un pago chico sale apenas el tesorero lo propone. Si alguien roba la llave del tesorero, puede vaciar el tesoro de a poco, en pagos chicos a proveedores habilitados. Hasta ahora lo limitaban solo los topes.

Con auditor, ese ladrón necesita también la llave del auditor. Además el auditor relee el archivo de la factura por su cuenta: un pago sin factura cargada, o con un archivo o un monto distintos, se observa y va a firmas.

## Contrato (`TreasuryPolicy`)

- `auditor`: lo fija el constructor. `address(0)` significa sin auditor, y entonces todo funciona como antes.
  - Se cambia con la propuesta `SetAuditor`, que va al final del enum para no mover los índices que ya existían.
  - No puede ser el agente, un firmante, el token ni el propio contrato. Las mismas reglas se aplican en `SetSigners` y `SetAgent`, y el error es `AuditorConflict`.
- `proposePayment`: con auditor, nunca paga en el acto. El pago siempre queda pendiente.
- `auditPayment(paymentId, cleared, reportHash)`:
  - **Condiciones:** solo la llama el auditor, una vez por pago, sobre un pago pendiente y con el contrato sin pausar. `reportHash` no puede ser cero.
  - **Evento:** emite `PaymentAudited`.
  - **Si `cleared` es verdadero:** vuelve a chequear los topes en ese momento y, si entra, paga con `Rule.Auto`.
  - **En cualquier otro caso:** el pago sigue pendiente para los firmantes.
- **Los firmantes pueden aprobar o rechazar antes del veredicto.** Las personas siempre mandan por encima del auditor.
- **Un pago al auditor nunca es automático**, igual que un pago al agente.
- **Vistas:** `auditor()` y `paymentAudit(id)`, que devuelve `(None | Cleared | Flagged, reportHash)`.

**Invariante 10:** con auditor, ningún pago sale automático sin su aprobación. Además, el auditor nunca firma, nunca recibe un pago automático y nunca es el agente.

**Tests:** `contracts/test/Auditor.t.sol` (21 tests) y el handler de invariantes, que incluye `auditPayment` y `SetAuditor`.

## App

**Archivos**

| Ruta | Qué hace |
|---|---|
| `app/src/lib/auditor/checks.ts` | Los chequeos. Son puros, sin LLM ni red |
| `app/src/lib/auditor/report.ts` | El informe en JSON con orden de claves fijo; su keccak256 es el `reportHash` |
| `app/src/lib/auditor/index.ts` | `runAuditor` (la ronda) y `reconcileBalance` (la conciliación diaria) |
| `app/src/lib/auditor/deps.ts` | Los puertos: cadena con la llave del auditor, archivos y lector de QR |
| `app/src/lib/auditor/view.ts` | Los datos de la página pública |
| `app/src/lib/chain/auditor.ts` | El envío de `auditPayment` por el mismo camino que el agente: tag ERC-8021, CIP-64 e idempotencia en `agent_txs`. Firma con `AUDITOR_PRIVATE_KEY` |
| `app/src/app/api/auditor/route.ts` | La ronda del auditor. La llama el cron cada minuto, junto con `/api/tick`, con `TICK_SECRET` |
| `app/src/app/auditoria/[paymentId]/` | El informe público, y en `/json` el texto exacto que se hashea |

**Ronda** (lock `auditor`; los envíos van con el lock `auditor-tx`, separado del `agent-tx` del tesorero porque tienen nonces distintos):

1. Comprueba que el contrato reconoce su llave como auditor. Si no, avisa al operador y no hace nada.
2. Arma la lista de candidatos: los pagos indexados que están pendientes y sin veredicto, más todos los IDs que el contrato emitió después del último indexado. Así ve un pago recién propuesto aunque el indexador no haya pasado todavía.
3. Para cada candidato:
   - lee el pago **de la cadena**;
   - carga el archivo guardado y relee el QR él mismo, sin LLM;
   - mira el historial del proveedor;
   - arma las observaciones y el informe;
   - **guarda el informe antes de enviar**, así un reintento manda el mismo veredicto y el mismo hash;
   - llama a `auditPayment`.
4. Si observa un pago, le avisa al revisor de cuentas una sola vez, con el link al informe.
5. Si no puede cargar el archivo, no adivina: lo reintenta en la ronda siguiente.

**Chequeos.** Una **observación** frena el pago y lo manda a firmas. Una **nota** solo informa.

| Código | Nivel | Cuándo |
|---|---|---|
| `SIN_FACTURA` | observación | No hay una factura cargada con ese `invoiceId` |
| `ARCHIVO_DISTINTO` | observación | El keccak256 del archivo guardado no es el `fileHash` del pago |
| `SIN_QR` | observación | El archivo no tiene QR de ARCA legible: los datos los leyó la IA |
| `QR_DISTINTO` | observación | El QR da otro CUIT, tipo, punto de venta o número |
| `MONTO_DISTINTO` | observación | El importe del QR no es el monto del pago |
| `RECEPTOR_INCORRECTO` | observación | Según el QR, la factura no está a nombre de la cooperadora |
| `POSIBLE_COMPRA_PARTIDA` | observación | Pagos chicos (bajo el tope) al mismo proveedor en 7 días que, sumados a este, pasan el tope por pago |
| `POSIBLE_FACTURA_REPETIDA` | observación | Otro pago al mismo proveedor por el mismo monto en 30 días |
| `PROVEEDOR_NUEVO` | nota | Primer pago a ese proveedor |
| `SIN_RECEPTOR_EN_QR` | nota | El QR no trae el receptor |
| `FACTURA_VIEJA` | nota | La factura tiene más de 60 días |

**Conciliación diaria.** Una vez por día compara el saldo de wARS del tesoro en la cadena con lo registrado: aportes en dinero menos pagos ejecutados, ambos hasta el último bloque indexado. Si no coinciden, avisa al revisor y al operador.

**Tesorero** (`lib/orchestrator/invoice.ts`):

- **Estado nuevo:** `propuesta → auditando`. El tesorero avisa "lo revisa el auditor" y, si tiene `auditNow`, le pide al auditor que lo revise en el momento. El auditor corre con sus propios deps y su propia llave.
- **Después del veredicto,** según lo que dice el contrato, no lo que reporta el auditor:
  - aprobado y dentro de los topes: pagado ("El auditor la revisó…"), con aviso al revisor;
  - aprobado pero fuera de los topes: a firmas ("no encontró problemas");
  - observado: a firmas, con las observaciones en el pedido de firma y en el mensaje a quien cargó la factura.
- **Si el auditor no responde** en 15 minutos (`AUDIT_TIMEOUT_MS`), el pago va a firmas igual y se avisa al operador. Si después el auditor lo aprueba y entra en los topes, se paga automático, y se les avisa a los firmantes que no hizo falta firmar.

**Panel, firma y rendición:**

- **Panel:** cada pago lleva la marca "Revisado por el auditor" u "Observado por el auditor", con el link al informe.
- **Página de firma:** muestra las observaciones antes de firmar.
- **Rendición:** suma la columna "Auditor".

**ERC-8004.** `register-agent.ts --auditor` registra una segunda identidad con `AUDITOR_PRIVATE_KEY` y escribe `public/auditor-registration.json`.

**Setup:**

- Toma `AUDITOR_PRIVATE_KEY` o `AUDITOR_ADDRESS`. En local, por defecto usa la cuenta #6 de anvil.
- Rechaza un auditor que sea el agente, un firmante o un proveedor.
- Sin auditor, avisa que los pagos chicos salen sin una segunda revisión.

## Aceptación

- Contratos: `forge test` completo, incluido el invariante 10.
- App:
  - `src/lib/auditor/auditor.test.ts`: los chequeos, el informe, la ronda (reintento con el mismo hash y locks separados) y la conciliación;
  - `src/lib/orchestrator/auditando.test.ts`: el flujo del tesorero;
  - e2e sobre el fork: el auditor aprueba la factura chica, aprueba la grande (que va a firmas), observa una compra partida (los firmantes la rechazan), registra su propia identidad ERC-8004, y todas sus transacciones llevan el tag.

## Fuera de alcance por ahora

- Consultar el comprobante en ARCA con el servicio de constatación, que necesita certificado.
- Publicar la reputación del tesorero en el Reputation Registry de ERC-8004.
- Correr el auditor en otra infraestructura. Hoy vive en el mismo proyecto de Vercel. Su independencia está en la llave, en lo que el contrato le permite hacer y en que relee todo por su cuenta.
