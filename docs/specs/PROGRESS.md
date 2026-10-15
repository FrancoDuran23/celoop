# Progreso de la implementación

Un mismo checkout con propiedad de archivos separada (ver `README.md`). El coordinador revisa cada entrega y corre las verificaciones él mismo.

| Ola | Spec | Estado | Notas |
|---|---|---|---|
| 0 | Base compartida | hecho | Interfaz del contrato, ABI, esquema y migración, env, attribution, vitest. 3 tests pasan |
| 1 | 01 Contratos | hecho | 50 tests y 9 invariantes verificados. El coordinador revisó la ruta de pagos. Se sumaron a la interfaz las vistas de propuestas. Limitación conocida: las propuestas no vencen ni se cancelan |
| 1 | 02 Facturas | hecho | 34 tests verificados por el coordinador. Falta probar la API real de Claude y el empaquetado en Next (se agregó serverExternalPackages) |
| 1 | 03 Cadena | hecho, falta confirmar estabilidad | 25 tests. La primera corrida del coordinador dio 2 fallas, probablemente porque 01 recompilaba `contracts/out` en ese momento. La segunda pasó. Se repite al final de la ola |
| 1 | 04 Firma | hecho | 82 tests verificados. El e2e corre con passkey virtual sobre un fork, pero sin el paymaster de Pimlico (recorte permitido). El límite diario de operaciones vive en memoria |
| 1 | 05 Panel y rendición | hecho | 23 tests verificados. El coordinador ya reemplazó el import de live-balance.ts por getTreasuryState |
| 2 | 06 Agente y bot | hecho | 63 tests verificados por el coordinador. Incluye resolver facturas en revisión (un revisor o el presidente, nunca quien la cargó, y sin saltear las reglas fijas), barrido diario de buzones vencidos y alertas al rol `operador` |
| 3 | 07 Setup y e2e | hecho | El e2e cubre los 6 flujos y el tag en todas las transacciones, y pasó 3 de 3 veces. `setup.ts` funciona contra un anvil limpio. Deploy a Sepolia y mainnet preparado, sin ejecutar |

## Reglas de la ola 1

- Nadie corre `npm install` ni `npm run build`: el build lo corre el coordinador después de integrar.
- `tsc` y `vitest` se corren filtrando por los archivos propios.

## Acuerdos entre módulos que salieron de las entregas

- **05 → 03:** `proposals.decoded` usa las claves del ABI (`fromLine`, `toLine`, `amount`, `lineId`, `allocated`, `periodEnd`, `vendor`, `cuit`, `enabled`, `perTxCap`, `vendorMonthlyCap`, `signers`, `threshold`, `agent`, `configHash`), y `ProposalExecuted` guarda `proposalId` en `args`.
- **05 → 06:**
  - Los links de revisión son `sign_links` con `purpose: "review"`, `target: {period}`, y van a una persona con rol `revisor`.
  - El tick llama a `POST /api/reports/close` el día 1 y a `POST /api/reports/[period]/publish` cuando la rendición está `revisada`, siempre con `TICK_SECRET`.
  - Componentes disponibles en `@/components` (`Money`, `Card`, `TxLink`, `Banner`, `Tag`, `ProgressBar`) y formato en `@/lib/report/format`.
- **02:** `readInvoice` y `validateInvoice` desde `@/lib/invoice`. El extractor de Claude es inyectable.
- **03 → 06:**
  - Para que dos envíos no choquen en el nonce, todos los envíos del agente van serializados con `withLock(db, "agent-tx", ...)`.
  - La clave de barrido no puede ser solo `sweep:<ref>`, porque un segundo depósito en el mismo buzón nunca se barrería. Tiene que incluir algo que cambie, por ejemplo `sweep:<ref>:<bloque o saldo>`.
  - Una fila `sending` cuyo hash nunca se mina queda trabada. El tick tiene que avisar al operador si una fila lleva más de 10 minutos en `sending`.
- **03 → 05:** `getTreasuryState()` ya existe en `@/lib/chain/treasury`. Hay que reemplazar el `@ts-ignore` de `live-balance.ts`.
- **06 → 07:**
  - Cargar en el padrón una persona con rol `operador`, que recibe las alertas técnicas.
  - Registrar el webhook con `secret_token = TELEGRAM_WEBHOOK_SECRET`.
  - El primer tick después del deploy cierra el mes anterior.

## Integración de olas 1 y 2 (coordinador)

- App: 35 archivos de test, 228 tests pasan (2 en skip a propósito). Contratos: 50 tests.
- `tsc --noEmit` limpio. `next build` compila. eslint deja 1 warning menor.
- El coordinador arregló el indexador: si la página de firma inserta antes la fila de una propuesta, el indexador completa `decoded` y `kind` sin pisar `reasonText`.
- Riesgo abierto: `next build` avisa que `pdfjs-dist` no puede ir como externo. Falta verificar la lectura de facturas en PDF dentro del servidor de Next o en Vercel.

## Ola 3: arreglos del coordinador

- `/api/tick` serializa los bigint. Antes devolvía 500 en cada tick de producción. Se quitó el workaround del e2e y quedó un test que exige 200.
- `settle` en `chain/agent.ts` consulta el recibo directamente en lugar de usar `waitForTransactionReceipt`, que se perdía bloques en el fork.
- `getDb()` y `setup.ts` aceptan `DATABASE_URL=pglite:<dir>` para desarrollo local sin Neon.
- `.gitignore`: se agregaron `app/.data` y `contracts/{cache,out,broadcast}`.
- Pedido al módulo 04: que `/firmar/proponer` también cree propuestas `SetBudget`, `SetVendor` y `SetCaps`. Sin eso, en una red real nadie puede dar de alta proveedores ni partidas. Hecho (97 tests del módulo). El coordinador agregó `wallet/vendor-sync.ts`: después de cada indexación aplica las propuestas `SetVendor` ejecutadas a `vendors`.
- Suite completa: 37 archivos, 250 tests pasan (3 en skip).

## Verificación final (coordinador)

- `tsc --noEmit` limpio. eslint: 0 errores y 1 warning menor.
- App: 39 archivos, 266 tests pasan (3 en skip a propósito), incluido el e2e de los 6 flujos sobre un fork de mainnet.
- Contratos: 58 tests pasan.
- `next build` compila. Sigue el aviso de `pdfjs-dist`.

## Pendientes antes de mainnet (necesitan a Franco)

- Tag ERC-8021 (`ATTRIBUTION_CODE`).
- Cuentas: Neon, Vercel, Pimlico (API key y política de patrocinio), bot de Telegram, Anthropic API key, y USDT para las comisiones del agente.
- Probar con una key real la lectura de facturas en PDF en Vercel, el paymaster de Pimlico y los parámetros de la URL de Ripio.
- Decidir si las propuestas tienen vencimiento o cancelación (hoy no tienen).
- Confirmar las columnas de la rendición con las planillas reales (CooperAr o Jujuy).
