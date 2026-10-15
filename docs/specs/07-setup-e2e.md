# 07 — Configuración, deploy, ERC-8004 y e2e

> **Ola 3:** empieza cuando 01 a 06 están entregados.

## Objetivo

Poner una instancia en marcha con un solo script y probar los 6 flujos de la demo de punta a punta, contra un fork de Celo mainnet.

Este módulo prepara el deploy a Sepolia y a mainnet, pero no lo ejecuta. Cualquier envío fuera de anvil lo confirma Franco.

## Archivos

**Le pertenecen:**
- `contracts/script/Deploy.s.sol`, que es el deploy real. Usa los contratos del módulo 01 sin modificarlos.
- `app/scripts/**`, menos `gen-abi.mjs`.
- `app/test/**`, que contiene el e2e.
- La sección "Cómo correrlo" de un `README.md` en la raíz del repo.

## Script de configuración: `app/scripts/setup.ts`

Se corre con `npx tsx scripts/setup.ts config/<nombre>.json`. El JSON de ejemplo es `app/scripts/config/demo.json`, con una cooperadora ficticia:

- cooperadora: nombre, escuela, CUIT, RUCE y la ruta al PDF del acta (se guarda su `keccak256`);
- personas con teléfono, roles y, para firmantes, `safeAddress`;
- proveedores con razón social, CUIT y dirección;
- partidas: materiales, mantenimiento, comedor, eventos, imprevistos y gastos operativos, cada una con monto y `periodEnd`;
- topes y umbral.

Pasos:

1. Despliega con `forge script contracts/script/Deploy.s.sol`. En `local` también despliega `MockWARS`; en mainnet usa el wARS real.
2. Carga la configuración en el contrato. El constructor recibe firmantes y topes; las partidas y los proveedores entran por propuestas. Con umbral 2, el script firma con claves de prueba en `local`. En una red real deja impresas las propuestas para que las firmen los firmantes desde `/firmar`.
3. Migra la base (`drizzle-kit migrate`) y siembra `cooperadora`, `persons`, `vendors` y `budget_lines`, con `lineId = keccak256(slug)`.
4. Imprime las variables de entorno resultantes para pegar en Vercel.

**Corte de seguridad:**
- Si `CHAIN` no es `local`, el script se detiene antes de enviar cualquier cosa. Muestra lo que haría y pide `--yes` explícito.
- En mainnet, además, exige `ATTRIBUTION_CODE`.

## ERC-8004: `app/scripts/register-agent.ts`

- Registra la identidad del agente en el Identity Registry.
  - Mainnet: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
  - Sepolia: `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- Usa el `sendAgentTx` del módulo 03, que agrega el tag.
- Genera `app/public/agent-registration.json` con nombre, descripción, endpoints y dirección del agente, según el formato de registro de ERC-8004. Ese formato hay que verificarlo en docs.celo.org/build-on-celo/build-with-ai/8004 o en el EIP.
- Tiene el mismo corte de seguridad que el script de configuración.
- El script se prueba contra un fork de mainnet en anvil.

## Webhook de Telegram: `app/scripts/telegram-webhook.ts`

Llama a `setWebhook` con la URL y el secreto.

## E2E: `app/test/e2e.test.ts`

Levanta:
- `anvil --fork-url https://forno.celo.org`;
- deploy local con `MockWARS`;
- PGlite;
- la app en proceso, llamando a los handlers de las rutas directamente;
- Telegram y Claude falsos.

Recorre los 6 flujos de la demo (ver `docs/sdd.md`, sección 9):

1. Factura C chica → pagada → aviso al revisor → aparece en `buildReport`.
2. Factura con instrucciones inyectadas → `revision`; factura a otro nombre → rechazada.
3. Factura grande → pendiente → 2 aprobaciones → pagada.
   - Las aprobaciones pueden salir de cuentas EOA de prueba que sean firmantes. La ruta con passkey ya la cubre el módulo 04.
4. Aporte → buzón con wARS minteados → tick → barrido → recibo.
5. El proveedor recibe wARS en su dirección.
6. Cierre de mes → borrador → visto bueno → publicada con PDF.

Al final verifica que **todas** las transacciones del run tengan el tag ERC-8021, con `readAttribution` sobre el input de cada una.

## Aceptación

- `cd app && npx vitest run test/e2e.test.ts` pasa.
- `npx tsx scripts/setup.ts scripts/config/demo.json` funciona contra un anvil local limpio.
- El README explica cómo levantar todo en local en menos de 10 pasos.

## Reporte

Archivos, resultado del e2e, lo que quedó listo para Sepolia y mainnet pero no se ejecutó, y estado.
