# 03 — Cadena: clientes, envío del agente, indexador y locks

## Objetivo

Todo lo que la app hace contra Celo pasa por acá:
- leer el estado del tesoro;
- enviar las transacciones del agente con el tag ERC-8021, la fee currency y la idempotencia;
- indexar los eventos en Postgres;
- coordinar con locks para que dos ejecuciones nunca hagan lo mismo.

## Archivos

**Le pertenecen:**
- `app/src/lib/chain/**`, menos `abi.ts` y `attribution.ts`, que ya existen y se usan tal cual;
- `app/src/lib/indexer/**`;
- `app/src/lib/locks.ts` y su test.

**No toca:**
- El esquema de la base: si falta una columna, se pide.
- `env.ts`.
- Otros módulos.
- No corre `npm install`.

## Interfaz pública

```ts
// chain/clients.ts
celoChain(): Chain                  // según env().CHAIN: local (anvil 31337 o un fork con chainId 42220), sepolia (11142220), mainnet (42220)
publicClient(): PublicClient
agentAccount(): LocalAccount        // desde AGENT_PRIVATE_KEY

// chain/treasury.ts: lecturas tipadas
getTreasuryState(): Promise<{
  balance: bigint; paused: boolean; perTxCap: bigint; vendorMonthlyCap: bigint;
  signers: Address[]; threshold: bigint; agent: Address;
  budgets: { lineId: Hex; allocated: bigint; spent: bigint; periodEnd: bigint }[];
}>
getPayment(id: bigint), isInvoicePaid(invoiceId: Hex), vendorSpentThisPeriod(vendor: Address)
boxAddress(ref: Hex): Promise<Address>
warsBalanceOf(address: Address): Promise<bigint>

// chain/agent.ts: envíos del agente, todos idempotentes por clave
proposePayment(args: { key: string; vendor: Address; invoice: {cuit,tipo,ptoVta,nro}; amount: bigint; lineId: Hex; fileHash: Hex })
  : Promise<{ status: "executed" | "pending" | "dry-run"; paymentId?: bigint; txHash?: Hex }>
sweepBox(args: { key: string; ref: Hex }): Promise<{ status: "swept" | "empty" | "dry-run"; amount?: bigint; txHash?: Hex }>
sendAgentTx(args: { key: string; kind: string; to: Address; data: Hex }): Promise<{ txHash: Hex; receipt: TransactionReceipt } | { dryRun: true }>

// indexer/index.ts
runIndexer(db: Db, opts?: { maxBlocks?: bigint }): Promise<{ from: bigint; to: bigint; events: number }>

// locks.ts
withLock<T>(db: Db, name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | { skipped: true }>
```

## Comportamiento

**Envío del agente (`sendAgentTx`)**

1. Busca la clave en `agent_txs`.
   - Si está `mined`, devuelve el resultado guardado y no reenvía.
   - Si está `sending` con `txHash`, espera el recibo de ese hash; nunca manda otra transacción a ciegas.
   - Si está `sending` sin `txHash`, la reintenta solo si no hay transacciones del agente pendientes en el mempool (nonce `pending` igual a `latest`).
2. Si no existe, inserta la fila `sending`, simula con `simulateContract` o `call` y envía.
3. **Toda transacción** lleva:
   - el `data` con `withAttribution(data)`;
   - `feeCurrency: env().FEE_CURRENCY` cuando está definida, como transacción CIP-64 con el soporte Celo de viem.
4. Si `AGENT_SEND !== "on"`, no envía: simula y devuelve `dryRun`.
5. Guarda `txHash`, nonce, estado final (`mined` o `reverted`) y el error.

**`proposePayment`:** decodifica `PaymentProposed` y `PaymentExecuted` del recibo para devolver `paymentId` y si se ejecutó.

**`sweepBox`:**
- Si el saldo del buzón es 0, devuelve `empty` sin enviar nada.
- Si no, llama a `BoxFactory.sweep(ref)`.

**Indexador**
- Guarda el cursor en `indexer_cursor` (clave `treasury`).
- Lee en rangos de `maxBlocks` (por defecto 5.000) desde el cursor hasta `latest - 1`. Al primer arranque empieza en el bloque de deploy, que sale de la variable de entorno `DEPLOY_BLOCK` (si no está, pedirla).
- **Fuentes:**
  - todos los eventos del tesoro;
  - `BoxSwept` de la fábrica;
  - los `Transfer` de wARS cuyo `to` es el tesoro.
- **Escribe:**
  - `chain_events`, con todos los eventos y los bigint como string;
  - `contributions`:
    - un `Contribution` con un `ref` que existe en `contribution_intents` toma su `personId` y deja el intent en `swept`;
    - un `Transfer` al tesoro sin `Contribution` en la misma transacción queda como aporte sin identificar, con `ref` null.
  - `payments`, `approvals`, `proposals` (con `decoded` según `ProposalKind`) y `budget_index` (se relee del contrato al ver `BudgetSet`, `BudgetMoved` o `PaymentExecuted`).
- Todo es idempotente por `(txHash, logIndex)` y puede correr dos veces sobre el mismo rango sin duplicar.

**Locks:**
- `INSERT … ON CONFLICT (name) DO UPDATE … WHERE locks.expires_at < now()` en una sola sentencia. Funciona con neon-http, que no tiene transacciones interactivas.
- La liberación borra solo si el `holder` coincide.

## Aceptación

- **Unit tests** con Vitest y PGlite (`createTestDb`):
  - máquina de estados de `agent_txs`: reintento, recibo pendiente y dry run;
  - locks: exclusión, expiración y liberación por un holder ajeno;
  - indexador con logs de mentira: idempotencia, aporte identificado y sin identificar, decodificación de propuestas.
- **Test de integración contra anvil:**
  - levantar `anvil` desde el test con `mise exec -- anvil --port <libre>`;
  - desplegar con `forge script contracts/script/DeployLocal.s.sol`, o con bytecode compilado si el módulo 01 todavía no lo terminó;
  - recorrido: aporte por buzón → `sweepBox` → indexador → fila en `contributions`; `proposePayment` automático y escalado;
  - verificar con `readAttribution` que la transacción minada lleva el tag.

  Si los contratos del módulo 01 todavía no existen, este test se marca `skip` con un motivo claro y el resto del módulo se entrega igual.
- `npx tsc --noEmit` sin errores en el módulo.

## Reporte

Archivos, columnas o variables de entorno pedidas, resultado de tests y estado.
