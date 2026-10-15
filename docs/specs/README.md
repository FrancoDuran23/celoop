# Specs por módulo

`00-producto.md` es la spec de producto: problema, historias de usuario y alcance. Los demás archivos son specs de implementación, una por módulo. Cada spec dice:

- qué construye el módulo;
- qué archivos le pertenecen;
- con qué interfaz habla con los otros módulos;
- cómo se acepta.

El diseño completo está en `docs/sdd.md`.

| Spec | Módulo | Directorios que le pertenecen | Depende de | Ola |
|---|---|---|---|---|
| [01](01-contratos.md) | Contratos | `contracts/src/` (menos `interfaces/`), `contracts/test/`, `contracts/script/` | interfaz compartida | 1 |
| [02](02-facturas.md) | Lector y validador de facturas | `app/src/lib/invoice/` | — | 1 |
| [03](03-cadena.md) | Cliente de cadena, tag ERC-8021, envío del agente, indexador, locks | `app/src/lib/chain/` (menos `abi.ts`), `app/src/lib/indexer/`, `app/src/lib/locks.ts` | ABI compartido | 1 |
| [04](04-firma.md) | Passkey + Safe, página de firma, página del proveedor, proxy del bundler | `app/src/lib/wallet/`, `app/src/app/firmar/`, `app/src/app/proveedor/`, `app/src/app/api/bundler/`, `app/src/app/api/passkeys/` | ABI compartido | 1 |
| [05](05-panel-rendicion.md) | Panel público y rendición (web + PDF) | `app/src/app/page.tsx`, `app/src/app/layout.tsx`, `app/src/app/globals.css`, `app/src/app/rendicion/`, `app/src/app/api/reports/`, `app/src/lib/report/`, `app/src/components/` | esquema de datos | 1 |
| [06](06-agente-bot.md) | Orquestador, tick y bot de Telegram | `app/src/lib/orchestrator/`, `app/src/lib/bot/`, `app/src/app/api/telegram/`, `app/src/app/api/tick/` | 02, 03 | 2 |
| [07](07-setup-e2e.md) | Script de configuración, deploy, ERC-8004, e2e contra un fork | `contracts/script/Deploy*.s.sol` (lo coordina con 01), `app/scripts/`, `app/test/` | todos | 3 |

## Base compartida (ya existe; ningún worker la cambia sin avisar)

- **`contracts/src/interfaces/ITreasuryPolicy.sol`:** la superficie del contrato. Cambiarla obliga a regenerar el ABI y avisar al coordinador.
- **`app/src/lib/chain/abi.ts`:** generado desde la interfaz con `npm run abi`, después de `forge build`.
- **`app/src/db/schema.ts`, `app/src/db/index.ts`, `app/src/db/testing.ts`, `app/drizzle/`:**
  - Para el esquema de la base, `getDb()` da Neon en producción y `createTestDb()` da PGlite en memoria para tests.
  - Si un módulo necesita una columna nueva, no la agrega por su cuenta: la pide en su reporte.
- **`app/src/lib/env.ts` y `app/.env.example`:** variables de entorno.
- **`app/package.json`:** dependencias. **Nadie corre `npm install`.** Si falta una dependencia, se pide en el reporte.
- **`mise.toml`:** Foundry 1.8.5. Usar `mise exec -- forge ...` y `mise exec -- anvil ...`.

## Convenciones

- **Idioma:**
  - Código, identificadores y comentarios en inglés.
  - Textos para personas (bot, páginas, PDF) en español rioplatense, claros, sin jerga cripto. No se usa la palabra "gas" en la UI.
- **Montos:**
  - wARS tiene 18 decimales. En la base se guardan como string numérico en unidades base.
  - En la UI se muestran en pesos con formato `es-AR`, por ejemplo `$ 12.500,00`.
- **Next.js 16:** cambia APIs respecto de versiones anteriores. Antes de escribir rutas o páginas, leer la guía que corresponda en `app/node_modules/next/dist/docs/`.
- **Tests:**
  - Vitest en `app/` con `npm test`; los archivos van al lado del código como `*.test.ts`.
  - Foundry en `contracts/` con `mise exec -- forge test`.
  - Se prueba comportamiento observable, no detalles internos.
- **Nada toca mainnet ni testnet** durante el desarrollo. Se trabaja con anvil, local o como fork de Celo mainnet (`https://forno.celo.org`).
- **Todo envío de transacción pasa por el módulo 03,** que agrega el tag ERC-8021 y la fee currency. La única excepción son las UserOperations del módulo 04, que agregan el tag con el mismo helper de 03.
