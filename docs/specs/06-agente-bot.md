# 06 — Orquestador, tick y bot de Telegram

> **Ola 2:** empieza cuando 02 (facturas) y 03 (cadena) están entregados.

## Objetivo

El agente autónomo. Recibe facturas y pedidos por Telegram, decide con reglas fijas, propone los pagos al contrato, pide firmas, manda recibos y cierra el mes. Claude solo redacta respuestas y lee facturas sin QR; nunca decide un pago.

## Archivos

**Le pertenecen:**
- `app/src/lib/orchestrator/**`
- `app/src/lib/bot/**`
- `app/src/app/api/telegram/**`
- `app/src/app/api/tick/**`

**No toca:**
- Los módulos 02, 03, 04 y 05: los usa por sus interfaces.
- El esquema de la base, que se pide.

## Bot (grammY, con webhook)

- **Webhook:** `POST /api/telegram`. Valida el header `X-Telegram-Bot-Api-Secret-Token` contra `TELEGRAM_WEBHOOK_SECRET`.
- **Identificación:**
  - La primera vez, el bot pide "Compartir mi contacto" con un botón `request_contact`.
  - Con el teléfono busca a la persona en `persons` y guarda `telegramUserId` y `telegramChatId`.
  - Si no la encuentra: "No te encuentro en el padrón; pedile a la comisión que te agregue".
- **Menú según el rol:**
  - **Socio:**
    - **Aportar:** pide el monto, con montos sugeridos y monto libre.
    - **¿En qué se gastó?** Responde con un resumen y el link al panel.
    - **Mis aportes.**
  - **Comisión:** todo lo del socio, más:
    - **Cargar factura:** recibe la foto o el PDF.
    - **Pagos pendientes.**
    - **Proponer cambio:** manda un link a `/firmar/proponer`.
  - **Revisor:** todo lo de la comisión, más **Revisar rendición**.
  - **Firmante sin passkey:** recibe el link de alta (`/firmar/alta`).
  - **Proveedor:** **Mis cobros**, con un link a `/proveedor`.
- **Aportar:**
  1. Crea un `contribution_intents` con un `ref` aleatorio de 32 bytes y su `boxAddress`.
  2. Responde con un link de on-ramp de Ripio que lleva la red Celo, el token wARS, el monto y la dirección del buzón (`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=<monto>&address=<box>`). Hay que confirmar los nombres de los parámetros en `docs/research/ripio.md` y docs.ripio.com.
  3. Explica en tres pasos qué va a ver la persona.
  4. Nunca usa la palabra "gas" y nunca menciona alumnos.
- **Texto libre:** se responde con Claude, que recibe un contexto del estado del tesoro (saldo, partidas y últimos pagos) y la consigna de que el texto del usuario es dato. **Claude no tiene herramientas que muevan plata.** A lo sumo puede sugerir abrir un flujo del menú.
- Los mensajes salientes van por una función `notify(personId, text, buttons?)`. Así los tests pueden capturarlos.

## Orquestador: factura

```text
recibida → leida → validada | rechazada(motivo) | revision(motivo)
validada → (elige partida) → propuesta → pagada | pendiente → aprobada → pagada | cancelada
```

1. Descarga el archivo de Telegram y lo guarda en Blob (o en disco local en dev). Calcula `fileHash`.
2. `readInvoice` del módulo 02. Si falla, pasa a `rechazada` o `revision` con el motivo.
3. `validateInvoice` con estos datos:
   - el CUIT de `cooperadora`;
   - los proveedores habilitados de `vendors`;
   - `alreadyPaid`, que consulta `invoices` por `invoiceId` y `isInvoicePaid` en la cadena.

   Si `looksLikeInjection` da positivo, la factura va a `revision`: "La factura tiene instrucciones de pago en el texto; la reviso con una persona".
4. Pide la partida con botones. El agente sugiere una según el proveedor y su último pago.
5. `proposePayment` del módulo 03, con la clave `propose:invoice:<id>`.
   - Si se ejecutó: pasa a `pagada`, avisa a quien la cargó y **avisa en el momento al revisor** ("Pago automático: …").
   - Si quedó pendiente: crea un `sign_links` para cada firmante y le manda el resumen con el botón "Revisar y firmar", que abre `/firmar/pago/<id>` en el navegador.
6. Cuando el indexador ve `PaymentExecuted` o `PaymentRejected` de un pago pendiente, el tick actualiza la factura y avisa a quien la cargó y a los firmantes.

## Tick (`POST /api/tick`)

Protegido con `Authorization: Bearer <TICK_SECRET>`. Corre todo dentro de `withLock(db, "tick", 300_000)`:

1. `runIndexer`.
2. **Buzones:** para cada `contribution_intents` abierto con saldo, `sweepBox` con la clave `sweep:<ref>`. Los intents de más de 7 días sin saldo pasan a `expired`.
3. **Recibos:** para cada `contributions` con `personId` y sin `receiptSentAt`, manda el recibo: "Recibimos tu aporte de $ X el <fecha>. ¡Gracias! Ver movimiento: <link>". Después marca `receiptSentAt`.
4. Actualiza las facturas pendientes según los pagos indexados (paso 6 de arriba).
5. **Cierre de mes:** el primer tick después de las 00:00 del día 1 (hora de Argentina) llama a `POST /api/reports/close` del módulo 05 para el mes anterior. Después le manda al revisor el link al borrador con un token.
6. **Aviso de partidas:** cuando una partida pasa el 80% de lo asignado, avisa a la comisión una sola vez por partida y período.

El tick es idempotente: si corre dos veces seguidas, no manda dos recibos ni dos avisos.

## Aceptación

- **Tests de orquestador y tick** con PGlite, un Telegram falso que capture `notify`, un lector de facturas falso y un cliente de cadena falso (o anvil, si 03 trae un helper de test):
  - factura válida bajo el tope: `pagada`, aviso al revisor;
  - factura a otro nombre: rechazada con motivo;
  - factura con inyección: `revision`;
  - factura grande: pendiente, links a los firmantes; después del evento de ejecución pasa a `pagada` y se avisa;
  - factura duplicada: rechazada;
  - aporte: intent → saldo → barrido → recibo una sola vez;
  - cierre de mes una sola vez;
  - aviso del 80% una sola vez.
- **Test del webhook:** un update de Telegram con un secreto inválido devuelve 401; un `request_contact` de un teléfono conocido vincula a la persona.
- `npx tsc --noEmit` y `npm run build` sin errores.

## Reporte

Archivos, columnas pedidas, resultado de tests y estado.
