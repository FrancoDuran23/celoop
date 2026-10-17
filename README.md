# Minga

Antes "Cooperadora Segura". Dos agentes para la tesorería de una cooperadora escolar argentina, sobre Celo y con wARS: un **tesorero** que cobra aportes, paga a proveedores dentro del presupuesto votado y arma la rendición, y un **auditor** con su propia llave que revisa cada pago antes de que salga (puede frenarlo, nunca empujarlo). El diseño está en [`docs/sdd.md`](docs/sdd.md) y las specs por módulo en [`docs/specs/`](docs/specs/README.md).

- `contracts/`: contratos en Solidity con Foundry (`TreasuryPolicy`, `BoxFactory`, `DepositBox`, `CooperadoraFactory`).
- `app/`: Next.js con el bot de Telegram, el orquestador, el alta de cooperadoras, la página de firma, el panel y la rendición.
- `cron/`: Worker de Cloudflare que llama al tick y al auditor cada minuto.

## Hackathon compliance

Celo mainnet (chain id 42220, RPC `https://forno.celo.org`). Attribution code: `celo_97a761e4eeab` (`ATTRIBUTION_CODE`). Node 22.

| Rule | How |
|---|---|
| ERC-8021 on every transaction | `@celo/attribution-tags`. The agent and the auditor sign with `prepareTransactionRequest` (CIP-64), so the suffix is concatenated onto `data` with `toDataSuffix` before signing — that path is not wrapped by the package. `sendTransaction` / `writeContract` (setup signers, the test bundler's `handleOps`) use the package's `withAttribution([...])` extension (`data` or `dataSuffix`). Passkey user-ops put the same suffix on the **inner** `callData` (`onchainIdentifier` on the Safe, which is `concat(executeUserOp, suffix)`). Pimlico's outer `handleOps` transaction is the bundler's; indexers read the tag with `fromEntryPointCalldata`. Contract creations (`Deploy.s.sol`, `DeployLocal.s.sol`, and `CooperadoraFactory.create` from the agent) append the suffix after the constructor args or the call data. Mainnet refuses to send without `ATTRIBUTION_CODE`. |
| ERC-8004 identity | Identity Registry on Celo mainnet: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` ([Celo docs](https://docs.celo.org/build-on-celo/build-with-ai/8004)). Sepolia: `0x8004A818BFB912233c491871b3d84c89A494BD9e`. The treasurer's card is `APP_URL/agent.json`; the auditor's is `APP_URL/auditor.json`. The id is `AGENT_ID` / `AUDITOR_ID`, not a hardcoded value. |

These commands do not broadcast unless you drop `--dry-run`. Wallets are not funded here; `--dry-run` only simulates, and without `--yes` mainnet stops before any RPC send.

```bash
cd app

# 1. Plan only. Prints what it would do and sends nothing (exit 2).
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AGENT_PRIVATE_KEY=0x... \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts

# 2. Simulate the treasurer's register() against mainnet. Still sends nothing.
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AGENT_PRIVATE_KEY=0x... \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  FEE_CURRENCY=0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72 \
  DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts --yes --dry-run

# 3. Register. The log prints AGENT_ID=<id>. Put that in the environment and restart
#    so https://<app>/agent.json includes registrations. The URI does not change.
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AGENT_PRIVATE_KEY=0x... \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  FEE_CURRENCY=0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72 \
  DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts --yes

# 4. Auditor, same two steps (simulate, then send). Card: https://<app>/auditor.json
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AUDITOR_PRIVATE_KEY=0x... \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  FEE_CURRENCY=0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72 \
  DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts --auditor --yes --dry-run
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AUDITOR_PRIVATE_KEY=0x... \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  FEE_CURRENCY=0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72 \
  DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts --auditor --yes

# 5. Only if the URL itself changes (setAgentURI). Same --yes --dry-run gate.
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AGENT_PRIVATE_KEY=0x... AGENT_ID=<id> \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  DATABASE_URL=<neon> \
  npx tsx scripts/update-agent-uri.ts --yes --dry-run
CHAIN=mainnet RPC_URL=https://forno.celo.org \
  AGENT_PRIVATE_KEY=0x... AGENT_ID=<id> \
  APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab \
  DATABASE_URL=<neon> \
  npx tsx scripts/update-agent-uri.ts --yes
# Auditor: add --auditor and AUDITOR_PRIVATE_KEY / AUDITOR_ID.
```

Deployments are tagged too. `scripts/setup.ts` passes `ATTRIBUTION_SUFFIX` (from `toDataSuffix(ATTRIBUTION_CODE)`) into `forge script contracts/script/Deploy.s.sol`, which appends it after constructor args. On mainnet that script refuses to deploy without it.

## Cómo correrlo

Hace falta Node 20 o más nuevo y [mise](https://mise.jdx.dev), que instala Foundry según `mise.toml`. Los comandos de `forge` y `anvil` van siempre con `mise exec --`.

### En local, paso a paso

1. **Instalar dependencias.**
   ```bash
   mise install
   cd app && npm ci && cd ..
   ```
2. **Compilar los contratos.** Los tests de la app usan `contracts/out`.
   ```bash
   cd contracts && mise exec -- forge build && cd ..
   ```
3. **Levantar una cadena local** en otra terminal y dejarla abierta. Puede ser un anvil limpio o un fork de Celo mainnet. El fork tiene el Identity Registry de ERC-8004 y es lo que se usa para la demo.
   ```bash
   mise exec -- anvil                                         # limpio (chain id 31337)
   mise exec -- anvil --fork-url https://forno.celo.org --block-time 1   # fork (chain id 42220)
   ```
4. **Preparar la base.** Hay dos opciones:
   - **Sin Neon:** poné `DATABASE_URL=pglite:./.data/pglite` en `app/.env`. Es la base PGlite que siembra `setup.ts`, y la usan tanto los scripts como `next dev`. No corras dos procesos a la vez sobre ella.
   - **Con Neon:** creá una branch de desarrollo y poné su `DATABASE_URL` en `app/.env`.
5. **Desplegar y configurar la cooperadora ficticia.**
   ```bash
   cd app
   npx tsx scripts/setup.ts scripts/config/demo.json
   ```
   El script hace todo esto:
   - despliega `MockWARS` y `CooperadoraFactory`, y crea la cooperadora demo (su `TreasuryPolicy` y su `BoxFactory`) en una sola transacción;
   - carga las 6 partidas y el proveedor con propuestas firmadas por claves de prueba de anvil;
   - migra y siembra la base;
   - imprime las variables de entorno.

   Pegá esas variables en `app/.env`, junto con `AGENT_PRIVATE_KEY` (en local, la cuenta #1 de anvil: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`), `AUDITOR_PRIVATE_KEY` (en local, la cuenta #6: `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e`) y `RPC_URL`. Si lo corrés contra el fork, `AGENT_PRIVATE_KEY` tiene que ser una clave nueva con saldo (`cast wallet new` y `anvil_setBalance`): en mainnet, las cuentas de prueba de anvil tienen código EIP-7702 y no pueden recibir la identidad ERC-8004. Para volver a empezar contra un anvil nuevo, agregá `--fresh-db` (solo con PGlite).
6. **Registrar las identidades ERC-8004 de los dos agentes**, solo contra el fork. La URI on-chain es `$APP_URL/agent.json` y `$APP_URL/auditor.json` (las sirve la app). El script imprime `AGENT_ID` y `AUDITOR_ID` para el entorno, y deja una copia en `app/public/agent-registration.json` y `app/public/auditor-registration.json`.
   ```bash
   npx tsx scripts/register-agent.ts
   npx tsx scripts/register-agent.ts --auditor
   ```
7. **Levantar la app.**
   ```bash
   npm run dev
   ```
8. **Conectar el bot de Telegram.** Telegram solo manda updates a una URL HTTPS:
   - abrí un túnel, por ejemplo con `cloudflared tunnel --url http://localhost:3000`;
   - poné `APP_URL` con esa URL, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` en `app/.env`;
   - corré `npx tsx scripts/telegram-webhook.ts`;
   - para entrar al bot con tu teléfono, cambiá el `phone` de una persona en `scripts/config/demo.json` antes del paso 5.
9. **Correr el tick y la ronda del auditor.** En producción los llama el Worker de `cron/` cada minuto (recorre las cooperadoras activas, de a una por el límite de 300 s). A mano:
   ```bash
   curl -X POST -H "Authorization: Bearer $TICK_SECRET" http://localhost:3000/api/tick
   curl -X POST -H "Authorization: Bearer $TICK_SECRET" http://localhost:3000/api/auditor
   ```

## Varias cooperadoras

Cada cooperadora tiene su tesoro. `CooperadoraFactory.create` despliega `TreasuryPolicy` y `BoxFactory` en una transacción y los anota en un registro. La fila de la base guarda esas direcciones, los topes y el estado (`draft` hasta el deploy, `active` después). Las tablas de pagos, partidas, facturas, propuestas, cursores y locks llevan `cooperadora_id`. La demo sigue siendo la fila `id = 1`.

Quien quiera abrir una cooperadora entra a `/start`, invita a los firmantes (cada uno crea su Safe con passkey en `/firmar/alta`), carga umbral, topes y partidas, y despliega. Las partidas no van en el constructor: después del deploy, `/c/<id>/settings` arma links para que los firmantes las propongan en `/firmar/proponer`. Un cambio de topes, partidas o proveedores es una propuesta on-chain (`propose` / `approveProposal`).

El bot es uno solo (`@Minga_coop_bot`). Si una persona está en más de una cooperadora, elige cuál con los botones del chat.

**Cómo se separan.** Los ids de partidas, pagos y propuestas se repiten entre tesoros, y un mismo CUIT puede ser proveedor de varias cooperadoras. Por eso:

- Toda consulta lleva su `cooperadora_id`. El tick, el auditor y el bot trabajan con `forCooperadora(deps, fila)`: el id de esa cooperadora y un puerto de cadena apuntado a su propio tesoro. Si no se nombra ninguna, es la demo (`scopeId`), nunca "todas".
- Los roles son por cooperadora (`memberships`). `persons.roles` es el padrón de la demo y solo cuenta mientras la demo no tenga memberships (bases viejas y tests); el alta nueva nunca escribe ahí. El operador sí es de la plataforma y recibe las alertas de todas.
- Cada link de firma, de alta, de proveedor y de revisión guarda su cooperadora. Las páginas de `/firmar`, `/proveedor` y el bundler usan el tesoro de esa cooperadora (`linkScope`).
- Las páginas públicas toman `?c=<id>`: `/ledger?c=2`, `/rendicion/2026-10?c=2`, `/auditoria/1?c=2`. Sin `c` muestran la demo.
- El alta no deja invitar como firmante a un teléfono que ya está en otra cooperadora: su firma (el Safe con passkey) es de esa persona.

`src/lib/orchestrator/multi-tenant.test.ts` lo prueba con dos cooperadoras que comparten partida, CUIT de proveedor y número de pago.

La variable de entorno del contrato de la plataforma es `FACTORY_ADDRESS`. `TREASURY_ADDRESS` y `BOX_FACTORY_ADDRESS` quedan como respaldo opcional para un deploy viejo o para los tests de integración; si no están, la app usa la única cooperadora activa, o la que dice la ruta o la sesión.

### Migración

`app/drizzle/0002_multi_tenant.sql` corre sobre la base que ya existe:

```bash
cd app && npm run db:migrate
```

Agrega `cooperadora_id` con default `1` (la demo no se mueve de fila), crea la secuencia de ids, y copia los roles de `persons` a `memberships` de la cooperadora 1. Los ids de pagos y propuestas siguen siendo por tesoro: la clave pasa a ser `(cooperadora_id, id)`.

### Deploy de la factory y del worker

1. **Factory.** Corré `setup.ts` como en el paso 5 (en mainnet, con `--yes`). El script imprime `FACTORY_ADDRESS`. Pegala en Vercel. El tesoro y el box factory de la demo quedan en la fila, no hace falta repetirlos en el env. Recién cuando esa fila está cargada se pueden sacar `TREASURY_ADDRESS` y `BOX_FACTORY_ADDRESS` si venían de un deploy anterior.
2. **App.** Redeploy de `main` en Vercel, con `FACTORY_ADDRESS` y el mismo `TICK_SECRET` de siempre.
3. **Cron.** Desde la raíz del repo:

   ```bash
   cd cron
   npx wrangler login
   npx wrangler secret put TICK_SECRET
   npx wrangler deploy
   ```

   `TICK_SECRET` tiene que ser el mismo valor que en Vercel. `APP_URL` está en `cron/wrangler.toml` (`https://celoop-rouge.vercel.app`). El trigger `* * * * *` hace `POST /api/tick` y `POST /api/auditor` con `Authorization: Bearer TICK_SECRET`.

### Tests

```bash
cd contracts && mise exec -- forge test
cd app && npm test                       # incluye test/e2e.test.ts y test/scripts.test.ts
cd app && npx vitest run test/e2e.test.ts
```

`test/e2e.test.ts` recorre los flujos de la demo (`docs/sdd.md`, sección 9) contra un fork de Celo mainnet:
- levanta el fork;
- corre `setup.ts` con forge;
- registra en ERC-8004 al tesorero y al auditor, cada uno con su llave;
- el auditor aprueba los pagos limpios y observa una compra partida;
- usa PGlite y llama directo a los handlers de `/api/telegram`, `/api/tick` y `/api/reports/*`;
- falsea Telegram, Claude y Ripio.

Al final comprueba que todas las transacciones del run llevan el tag ERC-8021. Necesita acceso a `https://forno.celo.org`; sin red, se saltea.

### Sepolia y mainnet (no se ejecutó nada todavía)

Fuera de `CHAIN=local`, los scripts muestran lo que harían y no envían nada sin `--yes`. En mainnet exigen además `ATTRIBUTION_CODE`: todas las transacciones llevan el tag ERC-8021 desde la primera, incluido el deploy.

En una red real, las propuestas de configuración (partidas y proveedores) quedan impresas para que las firmen los firmantes. Las `safeAddress` del JSON tienen que ser las Safe con passkey de cada firmante.

```bash
cd app
# 1. Ver el plan (no envía nada)
CHAIN=mainnet RPC_URL=https://forno.celo.org DEPLOYER_PRIVATE_KEY=0x... AGENT_ADDRESS=0x... AUDITOR_ADDRESS=0x... \
  ATTRIBUTION_CODE=celo_97a761e4eeab DATABASE_URL=<neon> npx tsx scripts/setup.ts scripts/config/<cooperadora>.json
# 2. Ejecutarlo
CHAIN=mainnet ... npx tsx scripts/setup.ts scripts/config/<cooperadora>.json --yes
# 3. Identidad ERC-8004. Comandos completos en "Hackathon compliance" (código celo_97a761e4eeab).
#    Primero simulá (--yes --dry-run), después sacá --dry-run. Guardá AGENT_ID y AUDITOR_ID.
CHAIN=mainnet RPC_URL=https://forno.celo.org AGENT_PRIVATE_KEY=0x... APP_URL=https://<app> \
  ATTRIBUTION_CODE=celo_97a761e4eeab FEE_CURRENCY=0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72 DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts --yes --dry-run
# 4. Webhook de Telegram
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_URL=https://<app> npx tsx scripts/telegram-webhook.ts
```

En Sepolia es igual, con `CHAIN=sepolia` y `RPC_URL=https://forno.celo-sepolia.celo-testnet.org`. Ahí no existe wARS, así que se despliega `MockWARS`, salvo que pases `WARS_ADDRESS`. El registro ERC-8004 usa `0x8004A818BFB912233c491871b3d84c89A494BD9e`.

`forge script` deja el registro del deploy en `contracts/broadcast/` y `contracts/cache/`.
