# Minga

Antes "Cooperadora Segura". Agente tesorero para cooperadoras escolares argentinas, sobre Celo y con wARS. El diseño está en [`docs/sdd.md`](docs/sdd.md) y las specs por módulo en [`docs/specs/`](docs/specs/README.md).

- `contracts/`: contratos en Solidity con Foundry (`TreasuryPolicy`, `BoxFactory`, `DepositBox`).
- `app/`: Next.js con el bot de Telegram, el orquestador, la página de firma, el panel y la rendición.

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
   - despliega `MockWARS`, `TreasuryPolicy` y `BoxFactory` con `contracts/script/Deploy.s.sol`;
   - carga las 6 partidas y el proveedor con propuestas firmadas por claves de prueba de anvil;
   - migra y siembra la base;
   - imprime las variables de entorno.

   Pegá esas variables en `app/.env`, junto con `AGENT_PRIVATE_KEY` (en local, la cuenta #1 de anvil: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`) y `RPC_URL`. Si lo corrés contra el fork, `AGENT_PRIVATE_KEY` tiene que ser una clave nueva con saldo (`cast wallet new` y `anvil_setBalance`): en mainnet, las cuentas de prueba de anvil tienen código EIP-7702 y no pueden recibir la identidad ERC-8004. Para volver a empezar contra un anvil nuevo, agregá `--fresh-db` (solo con PGlite).
6. **Registrar la identidad ERC-8004 del agente**, solo contra el fork. El script genera `app/public/agent-registration.json`.
   ```bash
   npx tsx scripts/register-agent.ts
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
9. **Correr el tick.** En producción lo llama un cron cada minuto. A mano:
   ```bash
   curl -X POST -H "Authorization: Bearer $TICK_SECRET" http://localhost:3000/api/tick
   ```

### Tests

```bash
cd contracts && mise exec -- forge test
cd app && npm test                       # incluye test/e2e.test.ts y test/scripts.test.ts
cd app && npx vitest run test/e2e.test.ts
```

`test/e2e.test.ts` recorre los 6 flujos de la demo (`docs/sdd.md`, sección 9) contra un fork de Celo mainnet:
- levanta el fork;
- corre `setup.ts` con forge;
- registra el agente en ERC-8004;
- usa PGlite y llama directo a los handlers de `/api/telegram`, `/api/tick` y `/api/reports/*`;
- falsea Telegram, Claude y Ripio.

Al final comprueba que todas las transacciones del run llevan el tag ERC-8021. Necesita acceso a `https://forno.celo.org`; sin red, se saltea.

### Sepolia y mainnet (no se ejecutó nada todavía)

Fuera de `CHAIN=local`, los scripts muestran lo que harían y no envían nada sin `--yes`. En mainnet exigen además `ATTRIBUTION_CODE`: todas las transacciones llevan el tag ERC-8021 desde la primera, incluido el deploy.

En una red real, las propuestas de configuración (partidas y proveedores) quedan impresas para que las firmen los firmantes. Las `safeAddress` del JSON tienen que ser las Safe con passkey de cada firmante.

```bash
cd app
# 1. Ver el plan (no envía nada)
CHAIN=mainnet RPC_URL=https://forno.celo.org DEPLOYER_PRIVATE_KEY=0x... AGENT_ADDRESS=0x... \
  ATTRIBUTION_CODE=<código> DATABASE_URL=<neon> npx tsx scripts/setup.ts scripts/config/<cooperadora>.json
# 2. Ejecutarlo
CHAIN=mainnet ... npx tsx scripts/setup.ts scripts/config/<cooperadora>.json --yes
# 3. Identidad ERC-8004 (primero simulada, después en serio)
CHAIN=mainnet RPC_URL=https://forno.celo.org AGENT_PRIVATE_KEY=0x... APP_URL=https://<app> \
  ATTRIBUTION_CODE=<código> FEE_CURRENCY=0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72 DATABASE_URL=<neon> \
  npx tsx scripts/register-agent.ts --yes --dry-run
CHAIN=mainnet ... npx tsx scripts/register-agent.ts --yes
# 4. Webhook de Telegram
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_URL=https://<app> npx tsx scripts/telegram-webhook.ts
```

En Sepolia es igual, con `CHAIN=sepolia` y `RPC_URL=https://forno.celo-sepolia.celo-testnet.org`. Ahí no existe wARS, así que se despliega `MockWARS`, salvo que pases `WARS_ADDRESS`. El registro ERC-8004 usa `0x8004A818BFB912233c491871b3d84c89A494BD9e`.

`forge script` deja el registro del deploy en `contracts/broadcast/` y `contracts/cache/`.
