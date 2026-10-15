# SDD — Cooperadora Segura

Agente tesorero para cooperadoras escolares. Versión 2, 14 de octubre de 2026, @Franco. Reemplaza al SDD del mismo día con las decisiones de la sesión de revisión.

Se presenta al track 1 (Stable Agents: LatAm, Ripio × Celo) del hackathon Agents on Open Rails. La entrega cierra el 9 de noviembre de 2026 a las 09:00 GMT.

## 1. Resumen

Cooperadora Segura cobra los aportes de los socios en wARS, paga a proveedores solo lo que el presupuesto votado permite y genera la rendición de cuentas sola. Las reglas viven en un contrato; el agente ejecuta lo que la comisión aprobó y no puede salirse de eso.

Son dos agentes con dos llaves: el **tesorero** propone los pagos y el **auditor** revisa cada uno antes de que pueda salir automático. El auditor puede frenar un pago, nunca empujarlo. Ver `docs/specs/08-auditor.md`.

**Problema.** La plata de una cooperadora la manejan una o dos personas con efectivo, un CBU y planillas Excel. Hay casos judiciales por desvío de fondos, y la rendición la hacen voluntarios a mano.

**Tesis.** Las reglas son firmes pero se pueden cambiar con firmas, y todo cambio queda público con su motivo. Nada se mueve sin que se vea, y nada grande se mueve sin una segunda persona.

**Diferencial frente a TesorerIA**, el competidor más cercano en este track: TesorerIA es el fondo de un grupo de amigos. Cooperadora Segura es para una institución con presupuesto votado en asamblea, facturas a su nombre, revisor de cuentas y rendición ante el Estado. Además la cuota es voluntaria por ley, así que el agente nunca cobra deudas.

## 2. Roles

El socio se identifica por su número de teléfono. Los datos de alumnos no entran al sistema.

| Rol | Quién es | Puede | No puede |
|---|---|---|---|
| Socio | Padre, madre, docente, exalumno | Aportar, ver el panel, recibir recibo | Aprobar pagos |
| Comisión directiva | Presidente, tesorero, secretario | Subir facturas, firmar pagos escalados y cambios de configuración, pausar | Pagar fuera de las reglas sin el umbral de firmas |
| Revisor de cuentas | Socio electo | Co-firmar, recibir aviso de cada pago automático, dar el visto bueno a la rendición | Cambiar la configuración solo |
| Asesor natural | Director o directora | Ver todo, recibir la rendición | Mover fondos |
| Proveedor | Librería, pintor, ferretería | Recibir pagos en su propia wallet y retirarlos a su CBU | Ver datos de socios |
| Agente tesorero | El tesorero automático | Conciliar aportes, validar facturas, proponer pagos, rendir | Cambiar reglas, cobrarse a sí mismo sin firmas, pagar a direcciones no habilitadas |
| Agente auditor | Un segundo agente, con su propia llave | Aprobar u observar cada pago antes de que salga automático, conciliar el saldo, publicar un informe por pago | Firmar, proponer, pausar, cobrar, o hacer salir un pago fuera de los topes |

Los firmantes son la comisión y el revisor. El umbral es, por ejemplo, 2 de 3.

## 3. Alcance del MVP

Una sola cooperadora, ficticia para la demo, configurada con un script.

**Entra**

- Aportes en pesos con el link de Ripio y un buzón único por aporte, con recibo por Telegram.
- Carga de facturas por Telegram, con lectura del QR de ARCA.
- Pago automático dentro del tope, de la partida y del tope mensual del proveedor.
- Pago escalado con firmas desde una Safe con passkey.
- Mover plata entre partidas con firmas y motivo público. Incluye una partida Imprevistos.
- Pausa de emergencia.
- Panel público de transparencia.
- Rendición mensual como página web y como PDF con el formato de la planilla CooperAr.
- Retiro del proveedor a su CBU con el off-ramp de Ripio.
- Identidad ERC-8004 del agente y tag ERC-8021 en todas las transacciones.

**Queda afuera**

- Caja chica.
- Recordatorios de aporte.
- Exportación a Excel.
- WhatsApp, que va al roadmap.
- x402.
- Pantallas de configuración.
- Varias cooperadoras por instancia.
- Aportes en especie o en trabajo: se cargan a mano en la rendición.
- Validación de facturas contra los servicios web de ARCA.
- Rendimientos.
- Reemplazar los libros rubricados.

**Extra si sobra tiempo:** reputación ERC-8004, con una calificación del revisor por cada rendición.

## 4. Requisitos funcionales

| ID | Requisito | Criterio de aceptación |
|---|---|---|
| RF-01 | Configuración inicial por script: firmantes, umbral, tope por pago, tope mensual por proveedor, partidas, proveedores, CUIT de la cooperadora, número RUCE, hash del acta | Todo queda en el contrato o en la base. El hash del acta queda en el contrato |
| RF-02 | Padrón de socios por teléfono | El bot identifica al socio cuando comparte su contacto en Telegram. No se pide wallet |
| RF-03 | Link de aporte con monto libre y montos sugeridos | Cada aporte genera un buzón nuevo y un link de Ripio que deposita en ese buzón |
| RF-04 | Conciliación y recibo | El socio recibe el recibo en menos de 1 minuto desde que el wARS llega al buzón |
| RF-05 | Presupuesto por partidas con monto y período | Mover plata entre partidas requiere el umbral de firmas y un motivo, que se ve en el panel. Cuando vence el período, se sigue usando el presupuesto anterior y el panel lo avisa |
| RF-06 | Proveedores habilitados | Alta y baja solo con el umbral de firmas. El contrato guarda la dirección y el CUIT de cada proveedor |
| RF-07 | Carga de factura por Telegram, en foto o PDF | Primero se lee el QR de ARCA. Si no hay QR, el LLM extrae los datos. Si el receptor no es la cooperadora o el tipo no es B ni C, se rechaza con el motivo |
| RF-08 | Pago automático | Se paga solo si la factura es válida, el proveedor está habilitado, la factura no se pagó antes y el monto entra en el tope por pago, en la partida, en el tope mensual del proveedor y en el saldo |
| RF-09 | Pago escalado | Si no cumple RF-08, queda pendiente y los firmantes reciben un link para firmar con passkey. Se ejecuta al llegar al umbral, aunque exceda la partida, y el exceso se marca en el panel |
| RF-10 | Aviso al revisor | Cada pago automático le llega al revisor por Telegram en el momento |
| RF-11 | Pausa | Cualquier firmante pausa. Reanudar requiere el umbral |
| RF-12 | Rendición mensual | Al cierre del mes se arma un borrador con ingresos, egresos por partida, comprobantes y cambios de presupuesto. Se publica como página y como PDF con el formato CooperAr cuando el revisor da el visto bueno |
| RF-13 | Panel público | Muestra el saldo, los aportes por mes sin nombres, cada egreso con su factura y la regla aplicada, los cambios de presupuesto con su motivo y el estado del presupuesto |
| RF-14 | Retiro del proveedor | Desde su página, el proveedor abre el off-ramp de Ripio con la dirección y el monto ya cargados |
| RF-15 | Identidad del agente | El agente está registrado en el Identity Registry de ERC-8004 en Celo mainnet |

## 5. Restricciones normativas y no funcionales

**Normativas**

- **RN-01 Cuota voluntaria** (Jujuy, Ley 5518, art. 13): el agente no recuerda, no exige ni bloquea. No hay saldo deudor por socio.
- **RN-02** Los aportes en especie o en trabajo se cargan a mano y aparecen en la rendición.
- **RN-03** Las cuotas extraordinarias solo valen con un acta de asamblea cargada.
- **RN-04** Los comprobantes tienen que estar a nombre de la cooperadora y ser tipo B o C. Falta confirmar la regla de Jujuy (ver `docs/investigacion-cooperadoras.md`).
- **RN-05** Se guarda el número RUCE.
- **RN-06** No reemplaza los libros rubricados ni la asamblea.

**No funcionales**

- **RNF-01 Privacidad:**
  - En la cadena solo hay direcciones, montos, hashes y CUIT de proveedores, que son públicos.
  - Los aportes llegan desde buzones de un solo uso, sin dirección del socio.
  - Nombres y teléfonos viven en Postgres.
- **RNF-02 UX:**
  - El socio paga en pesos y nunca ve una wallet.
  - Firmantes y proveedores usan passkey, sin frase semilla.
  - No se usa la palabra "gas".
- **RNF-03 Costos:**
  - El agente paga comisiones en USDT o USDC con fee abstraction (CIP-64). wARS no es fee currency.
  - Las operaciones de firmantes y proveedores las patrocina Pimlico.
  - Durante el hackathon las comisiones las pone el equipo.
- **RNF-04 Seguridad:**
  - La clave del agente solo puede llamar a `proposePayment` y a la creación de buzones.
  - El LLM no participa del camino del dinero (ver 7.1).
- **RNF-05 Auditabilidad:** cada pago emite en un evento el ID de la factura, el hash del archivo, la partida y la regla aplicada.
- **RNF-06 Disponibilidad:** si el agente se cae, los fondos siguen en el contrato y los firmantes pueden operar desde la página de firma.
- **RNF-07 Atribución:** toda transacción lleva el tag ERC-8021 del proyecto desde la primera, incluidas las UserOperations, donde el tag va dentro del `callData`.

## 6. Arquitectura

```
Socio ──Telegram──▶ Bot ─┐                                  ┌─▶ Panel público
Comisión ─Telegram─▶ Bot ─┤                                  │
                          ▼                                  │
                 Next.js en Vercel ──viem + tag 8021──▶ TreasuryPolicy (Celo)
                 (orquestador, webhooks,                     ▲      │
                  página de firma, panel, PDF)               │      ▼
                          │                         BoxFactory   Proveedor (Safe)
                          ▼                              ▲            │
                 Neon Postgres · Vercel Blob             │            ▼
                          ▲                     Ripio on-ramp    Ripio off-ramp → CBU
                 Cloudflare cron cada 1 min              ▲
                 → /api/tick (tesorero)            Socio paga pesos
                 → /api/auditor (auditor, otra llave → auditPayment)
```

**Stack**

- **Contratos:** Solidity con Foundry. Tests de invariantes y fuzzing.
- **App:** un solo proyecto Next.js en Vercel, en TypeScript, que contiene:
  - El webhook del bot de Telegram.
  - Los webhooks de Ripio, para cuando se use la API B2B.
  - El orquestador del agente.
  - La página de firma.
  - El panel público.
  - El PDF, con `@react-pdf/renderer` o similar.
- **Cadena:**
  - viem con `@celo/attribution-tags`.
  - permissionless y Pimlico (EntryPoint v0.7) para las Safe 1.4.1 con passkey.
- **Datos:** Neon Postgres para personas, índice de eventos y facturas. Vercel Blob para los archivos.
- **LLM:** Claude con el SDK de Anthropic. Solo extrae facturas sin QR y redacta mensajes.
- **Tareas periódicas:** un cron de Cloudflare Workers llama a `/api/tick` cada minuto. Ese tick:
  - Revisa los buzones con saldo y los barre.
  - Indexa eventos.
  - Hace el cierre de mes.
  - Reintenta lo pendiente.

  Un lock en Postgres evita dos ticks en paralelo.
- **Passkeys en Telegram:** el navegador interno de Telegram no soporta WebAuthn. Los links de firma se abren en el navegador del teléfono.

## 7. Contratos

### TreasuryPolicy

Custodia los wARS (`0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D` en mainnet; en Celo Sepolia se usa un ERC-20 propio que lo imita, porque wARS no existe ahí).

**Estado**

- `token`
- `signers[]`, `threshold`
- `agent`
- `auditor`: segundo agente. Con auditor, un pago automático necesita su aprobación (`auditPayment`). `address(0)` = sin auditor.
- `perTxCap`: tope por pago automático.
- `vendorMonthlyCap`: tope acumulado de pagos automáticos por proveedor y mes.
- `budgets[lineId]`: `{allocated, spent, periodEnd}`. `periodEnd` es informativo: al vencer no bloquea, solo se marca en los eventos y en el panel.
- `vendors[address]`: `{enabled, cuit}`.
- `vendorMonthSpent[address][yyyymm]`
- `paidInvoice[invoiceId]`
- `payments[id]`: `{vendor, amount, lineId, invoiceId, fileHash, status, approvals}`.
- `proposals[id]`: cambios de configuración pendientes de firmas.
- `configHash`: hash del acta vigente.
- `paused`

**Funciones**

| Función | Quién | Qué hace |
|---|---|---|
| `contribute(amount, ref)` | Cualquiera, en la práctica los buzones | `transferFrom` de wARS al contrato y evento `Contribution(ref, amount)` |
| `proposePayment(vendor, cuit, tipo, ptoVta, nro, amount, lineId, fileHash, rule)` | Agente | Calcula `invoiceId = keccak256(cuit, tipo, ptoVta, nro)` y lo rechaza si ya se pagó. Exige `vendors[vendor].enabled` y `vendors[vendor].cuit == cuit`, y revierte si está pausado. Paga en el acto si el monto entra en `perTxCap`, en el saldo de la partida, en `vendorMonthlyCap` y en el saldo del contrato, y si `vendor != agent`. Si no, queda pendiente |
| `approve(paymentId)` | Firmante | Un voto por firmante. Al llegar al umbral ejecuta, si el proveedor sigue habilitado, la factura no se pagó y hay saldo. Puede exceder la partida, y el evento lo marca |
| `reject(paymentId)` | Firmante | Cancela un pago pendiente |
| `propose(action)`, `approveProposal(id)` | Firmantes | Cambios de configuración que se ejecutan al llegar al umbral. Las acciones son `setBudget`, `moveBudget(from, to, amount, reasonHash)`, `setVendor(address, cuit, enabled)`, `setCaps`, `setSigners`, `setAgent`, `setConfigHash` y `unpause` |
| `auditPayment(paymentId, cleared, reportHash)` | Auditor | Una vez por pago pendiente. Si aprueba y el pago entra en los topes, paga en el acto (`Rule.Auto`). Si observa, queda para los firmantes. `reportHash` es el keccak256 del informe público |
| `pause()` | Cualquier firmante | Congela todos los pagos |

Los pagos al propio agente, que corresponden a la partida "Gastos operativos" para reintegrar comisiones, siempre se escalan.

### BoxFactory y DepositBox

Cada aporte usa un buzón de un solo uso.

- El backend genera un `ref` aleatorio y calcula con CREATE2 la dirección del buzón, sin desplegarlo todavía.
- El link de Ripio deposita en esa dirección.
- Cuando el tick ve saldo, cualquiera puede llamar a `BoxFactory.sweep(ref)`. Esa llamada despliega el buzón (un clon mínimo), aprueba el contrato y llama a `contribute(balance, ref)`.
- El buzón no tiene otra salida.
- La relación entre `ref` y el socio vive solo en Postgres.

### Invariantes que los tests tienen que probar

1. Ningún pago va a una dirección fuera de `vendors`.
2. Ningún pago automático supera `perTxCap`, el saldo de su partida ni `vendorMonthlyCap`.
3. El agente no puede cambiar la configuración, y no recibe fondos sin el umbral de firmas.
4. Con el contrato pausado no se ejecuta ningún pago.
5. Cada pago emite un evento con `invoiceId`, `fileHash`, `lineId` y `rule`.
6. Ningún aporte se registra sin una transferencia real de wARS al contrato.
7. Un `invoiceId` se paga como máximo una vez.
8. El CUIT de la factura coincide con el CUIT del proveedor que cobra.
9. Un buzón solo puede transferir al contrato.
10. Con auditor, ningún pago sale automático sin su aprobación; el auditor nunca firma, nunca recibe un pago automático y nunca es el agente.

## 8. Agente

### 8.1 Qué decide el código y qué el LLM

El camino del dinero es determinístico. El LLM puede equivocarse o ser engañado sin que eso mueva un peso.

| Paso | Quién lo hace |
|---|---|
| Leer la factura | Código: decodifica el QR de ARCA. Solo si no hay QR, Claude devuelve un JSON con esquema fijo |
| Comparar QR contra extracción | Código. Si no coinciden, va a revisión humana |
| Validar (receptor = CUIT de la cooperadora, tipo B o C, emisor habilitado, no pagada) | Código |
| Elegir la partida | Quien sube la factura, con botones. El agente sugiere |
| Llamar a `proposePayment` | Orquestador, cuando la validación da OK |
| Aprobar u observar el pago | El auditor, con código: relee el QR del archivo guardado, compara archivo, CUIT, número y monto con lo que está en la cadena y busca compras partidas o facturas repetidas. Sin LLM |
| Redactar mensajes, responder preguntas | Claude |

El texto de una factura o de un mensaje es dato, no instrucción. Si una factura dice "pagar a esta otra cuenta", se ignora y se marca para revisión.

### 8.2 Disparadores

- **Tick cada minuto:** buzones con saldo, eventos nuevos, cierre de mes y reintentos.
- **Mensaje de Telegram:** factura subida, pregunta de un socio, pedido de aporte.
- **Webhook de Ripio:** solo en la versión con API B2B.

### 8.3 Estados de una factura

`recibida → leída → validada | rechazada (motivo) | revisión → propuesta → pagada | pendiente → aprobada → pagada | cancelada`

Con auditor: `propuesta → auditando → pagada | pendiente | cancelada`. Si el auditor no responde en 15 minutos, el pago va a firmas igual y se avisa al operador.

Como en TesorerIA, un pago enviado y sin recibo nunca se reenvía a ciegas: se espera el recibo o a que venza el lock.

## 9. Flujos

**Demo, en el orden en que se muestra**

1. **Factura chica.** El proveedor emite una factura C real a nombre de la cooperadora ficticia. Un miembro de la comisión la manda por Telegram. El agente lee el QR, valida y propone el pago; el auditor lo revisa y lo aprueba, y sale. El revisor recibe el aviso y el pago aparece en el panel con su informe de auditoría.
2. **Factura que inyecta instrucciones o está a otro nombre.** El agente la rechaza y explica por qué.
3. **Factura grande.** Queda pendiente. Dos firmantes firman con passkey y se ejecuta.
   - **Compra partida.** Una factura chica que, sumada a otra de la misma semana, pasa el tope: el auditor la observa, el revisor recibe el aviso y la deciden los firmantes.
4. **Aporte.** Un socio pide aportar, paga pesos con el link de Ripio, el buzón se barre y le llega el recibo.
5. **Retiro.** El proveedor retira a su CBU.
6. **Cierre de mes.** Se genera el borrador, el revisor da el visto bueno y se publican la página y el PDF CooperAr.

**Aporte en producción:** la cooperadora es cliente BUSINESS de la API de Ripio. El padre transfiere al CVU de la cooperadora, como hoy. El webhook trae el nombre de quien transfirió, el agente lo busca en el padrón y manda el recibo. Si el nombre viene vacío, le pregunta por chat. Esto reemplaza a los buzones y depende de lo que Ripio confirme (ver sección 12).

## 10. Modelo de datos

| Entidad | Campos clave | Dónde vive |
|---|---|---|
| Cooperadora | nombre, escuela, CUIT, nº RUCE, dirección del contrato, hash del acta | Postgres y contrato |
| Socio | nombre, teléfono, Telegram ID, tipo | Postgres |
| Aporte | socio, monto, ref del buzón, tx hash, tipo (dinero, especie, trabajo) | Evento e índice |
| Partida | nombre, asignado, gastado, período | Contrato |
| Movimiento de partida | origen, destino, monto, motivo, firmas | Contrato y Postgres (texto del motivo) |
| Proveedor | razón social, CUIT, dirección de la Safe, habilitado | Postgres y contrato |
| Factura | emisor, tipo, punto de venta, número, monto, fecha, receptor, CAE, archivo, hash, origen (QR o LLM), estado | Postgres y Blob; `invoiceId` y hash en la cadena |
| Pago | factura, partida, monto, regla, estado, tx hash | Contrato e índice |
| Aprobación | pago o propuesta, firmante, tx hash | Contrato |
| Rendición | período, totales, PDF, estado (borrador, revisada, publicada) | Postgres y Blob |

## 11. Requisitos del hackathon

| Requisito | Cómo se cumple |
|---|---|
| Mainnet con wFIAT real | Contrato con wARS en Celo mainnet y el ciclo de la demo con montos chicos |
| Uso real de wFIAT y del stack de Celo | wARS de punta a punta, fee abstraction, ERC-8004 y on-ramp y off-ramp de Ripio |
| Agente autónomo y útil | Concilia, valida, paga, escala y rinde sin intervención |
| Una persona real puede usarlo | Telegram, pesos y passkey. Sin wallet para el socio |
| Impacto en LatAm | Cada escuela pública tiene una cooperadora, y en la región hay figuras parecidas |
| ERC-8004 (obligatorio) | Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Tag ERC-8021 (obligatorio) | En todas las transacciones desde la primera. El tag ya está asignado y Franco lo pasa |
| Repo público con código escrito durante el hackathon | Este repo |

En la entrega hay que declarar que el gas de firmantes y proveedores lo patrocina Pimlico.

## 12. Pendientes

**Decisiones**

- [ ] Roles de la demo: quién emite la factura y qué CUIT usa la cooperadora ficticia. Hay dos monotributistas disponibles. El emisor y el receptor tienen que ser CUIT distintos.

**Ripio** (detalle y fuentes en `docs/research/ripio.md`; consultas a b2b@ripio.com o a las Office Hours del hackathon)

- [ ] ¿Acepta como cliente BUSINESS a una asociación civil? No está documentado. La UIF 49/2024 pide estatuto, CUIT, inscripción registral, autoridades y beneficiario final.
- [ ] Los T&C del ramp exigen que sea para "fines personales, no comerciales". ¿Eso aplica a un cliente BUSINESS?
- [ ] ¿Acepta transferencias de terceros al CVU de la cooperadora? Probablemente sí: los T&C de Digipayments las permiten y la UIF solo las marca como alerta. Falta confirmarlo para BUSINESS.
- [ ] ¿Permite off-ramp al CBU de un tercero? Probablemente sí en Argentina, según el agents-toolkit de Ripio. Falta confirmarlo contractualmente.
- [ ] ¿Cuánto tarda el on-ramp desde que el padre transfiere? No está documentado.
- Costos del ramp público: USD 1 la primera operación y 0,1% por compra o venta. El precio B2B se negocia.

**Validación en campo** (ver `docs/investigacion-cooperadoras.md`)

- [ ] Formato de rendición que se exige en Jujuy y tipos de comprobante aceptados.
- [ ] Al menos una carta de interés de una cooperadora.

**Técnicos**

- [ ] Confirmar que el decodificador del QR de ARCA cubre los formatos que emiten los monotributistas (PDF de "Comprobantes en línea", tickets).

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| TesorerIA ya está en mainnet con una arquitectura parecida | La demo abre con la factura y la rendición, que ellos no tienen. El pitch se centra en la institución, no en el grupo |
| El link de Ripio tiene unos 9 pasos para el padre | Aceptado en la demo. En producción se usa el CVU de la cooperadora |
| Ripio usa una dirección guardada del usuario en lugar del buzón | En la demo, socios sin dirección guardada. En producción no hay buzón |
| Un tesorero con un proveedor amigo carga facturas chicas | Tope mensual por proveedor, aviso inmediato al revisor y panel público |
| Error en el contrato con fondos reales | Tests de invariantes y fuzzing, montos chicos y pausa |
| Inyección en facturas o mensajes | El LLM no participa del camino del dinero. Proveedores con CUIT en la cadena |
| La comisión no se anima a operar en stablecoin | Presentarlo como medio de pago y registro, con libros y asamblea intactos |
