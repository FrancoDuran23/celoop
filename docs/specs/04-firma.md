# 04 — Firma con passkey, página del firmante y del proveedor

## Objetivo

Firmantes y proveedores operan con una **Safe 1.4.1 cuyo dueño es una passkey** (huella, cara o PIN) en Celo. No hay frase semilla ni extensión, y no necesitan saldo: las operaciones van como UserOperations (ERC-4337, EntryPoint v0.7) patrocinadas por Pimlico.

TesorerIA ya probó este camino en Celo mainnet.

## Archivos

**Le pertenecen:**
- `app/src/lib/wallet/**`
- `app/src/app/firmar/**`, con layout propio si hace falta
- `app/src/app/proveedor/**`
- `app/src/app/api/bundler/**`
- `app/src/app/api/passkeys/**`

**No toca:**
- `app/src/app/layout.tsx` y `globals.css`, que son del módulo 05.
- El esquema de la base, que se pide.
- `attribution.ts`, que se usa tal cual.
- No corre `npm install`. Están `viem`, `permissionless` y `zod`.

## Flujos

**1. Alta del firmante (`/firmar/alta?t=<token>`)**
- El token es una fila de `sign_links` con `purpose = enroll`, que genera el bot.
- La página explica en una frase qué va a pasar y crea la passkey con WebAuthn (`createWebAuthnCredential` de `viem/account-abstraction`, `rpId = env().RP_ID`).
- Calcula la dirección contrafactual de la Safe con `toSafeSmartAccount` de permissionless y la passkey como dueña.
- Guarda `passkeys` y `persons.safeAddress` con `POST /api/passkeys`.
- Muestra "Listo. Tu firma quedó creada" y la dirección abreviada.
- La Safe se despliega con la primera operación.
- El operador agrega esa dirección como firmante con el script del módulo 07.

**2. Firmar un pago (`/firmar/pago/[id]?t=<token>`)**
- Muestra:
  - el proveedor, el CUIT, el monto en pesos y la partida;
  - un link a la factura;
  - cuántas firmas tiene y cuántas faltan;
  - si excede la partida.
- Botones **Aprobar** y **Rechazar**. Arman la llamada al tesoro (`approve` o `reject`) y la mandan como UserOperation firmada con la passkey.
- Al terminar muestra el resultado y el link al explorador.

**3. Firmar una propuesta (`/firmar/propuesta/[id]?t=<token>`)**
- Igual que el pago, mostrando decodificado lo que cambia. Por ejemplo: "Mover $100.000 de Eventos a Mantenimiento. Motivo: rotura de caño".
- Además existe **Pausar**, para cualquier firmante, sin propuesta previa.

**4. Crear una propuesta (`/firmar/proponer?t=<token>`)**
- Formulario simple para dos acciones: mover entre partidas (origen, destino, monto y motivo) y `Unpause`.
- El texto del motivo va a `proposals.reasonText` y su `keccak256` al contrato.
- Otras acciones (proveedores, topes, firmantes) quedan para el script del módulo 07.

**5. Proveedor (`/proveedor?t=<token>`)**
- Muestra su saldo en wARS y la lista de cobros.
- Tiene un botón "Pasar a mi cuenta bancaria" que abre el off-ramp de Ripio con la red Celo, el token wARS y el monto.
  - URL: `https://ramp.ripio.com/offramp` con los parámetros que correspondan. Hay que leer la documentación de Ripio (docs.ripio.com) para confirmarlos y dejar la construcción de la URL en una función testeada.
- Si el flujo de Ripio pide una dirección de depósito, el proveedor la pega y la página manda una UserOperation de `transfer` de wARS desde su Safe a esa dirección, con confirmación previa.

**Telegram:** el navegador interno de Telegram no soporta WebAuthn. Si la página detecta el user agent de Telegram, muestra "Abrí este link en Chrome o Safari" con un botón para copiar el link.

## `/api/bundler`: la única puerta a Pimlico

- **La API key queda en el servidor.** El navegador habla con `/api/bundler`, que reenvía a Pimlico solo los métodos JSON-RPC que necesita una operación patrocinada.
- **Solo patrocina lo que puede decodificar.** Una operación sin valor, desde una Safe registrada en `passkeys`, con una sola llamada de la Safe o un batch `MultiSendCallOnly`, cuyas llamadas sean:
  - al tesoro: `approve`, `reject`, `executePayment`, `propose`, `approveProposal` o `pause`, y solo si la Safe es firmante (`isSigner`);
  - a wARS: `transfer`, solo si la Safe es de un proveedor (`vendors.address`).
- **El `callData` tiene que terminar con el tag ERC-8021:** `withAttribution`.
- **Límites:** de gas por operación (2M), y una tasa por Safe (por ejemplo 30 operaciones por día).
- **Todo lo demás:** 403.

## Sesión

El token de `sign_links`:
- es aleatorio y de un solo uso para `sign`;
- vence a las 24 horas;
- para `enroll` y `vendor`, vence pero se puede reusar dentro de su vigencia.

El token identifica a la persona. Las rutas `POST` validan el token y que la Safe que firma sea la de esa persona.

## Aceptación

**Unit tests (Vitest):**
- el decodificador y la política del bundler: casos permitidos y bloqueados por función, por rol y sin tag;
- validación de tokens: vencido, usado y de otra persona;
- la construcción de la URL de Ripio;
- la decodificación de propuestas para mostrarlas.

**E2E contra un fork de anvil:**
- un test con una passkey virtual crea la Safe y aprueba un pago en un tesoro desplegado localmente.
- Sirve el patrón de TesorerIA (`e2e:serve` con anvil fork y un bundler local), o se arman la UserOperation y la firma P-256 con una clave generada en el test.
- Si no se puede montar un bundler local en tiempo razonable, se entrega el test que arma y firma la UserOperation y verifica su validez llamando a `EntryPoint.handleOps` directo en el fork, sin paymaster. Ese recorte se reporta como concern.

`npx tsc --noEmit` sin errores en el módulo, y las páginas renderizan con `npm run build`.

## Reporte

Archivos, recortes, columnas o dependencias pedidas, resultado de tests y estado.
