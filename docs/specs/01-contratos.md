# 01 — Contratos

## Objetivo

Implementar `TreasuryPolicy`, `BoxFactory` y `DepositBox` (más `MockWARS` para tests) con exactamente la interfaz de `contracts/src/interfaces/ITreasuryPolicy.sol`.

Es la pieza que hace verdad la promesa del producto: ni el agente ni una persona sola pueden sacar plata fuera de las reglas.

## Archivos

**Le pertenecen:**
- `contracts/src/TreasuryPolicy.sol`
- `contracts/src/BoxFactory.sol`
- `contracts/src/DepositBox.sol`
- `contracts/src/test/MockWARS.sol`
- `contracts/test/**`
- `contracts/script/DeployLocal.s.sol`

**No toca:**
- `contracts/src/interfaces/ITreasuryPolicy.sol`. Si hace falta cambiarla, pedirlo en el reporte con el motivo.
- Nada fuera de `contracts/`.

## Comportamiento

### TreasuryPolicy

Implementa `ITreasuryPolicy`.

**Constructor:** `(token, signers[], threshold, agent, perTxCap, vendorMonthlyCap, configHash)`. Valida:
- umbral entre 1 y la cantidad de firmantes;
- firmantes sin duplicados y sin `address(0)`;
- el agente no es firmante.

**Roles:**
- `onlyAgent`: `proposePayment`.
- `onlySigner`:
  - `approve`, `executePayment`, `reject`;
  - `propose`, `approveProposal`;
  - `pause`.
- Cualquiera puede llamar a `contribute`.

**`contribute(amount, ref)`:** hace `safeTransferFrom(msg.sender, this, amount)` y emite `Contribution(ref, msg.sender, amount)`. Rechaza `amount == 0`.

**`proposePayment(vendor, invoice, amount, lineId, fileHash)`:**

1. Revierte si se cumple cualquiera de estas condiciones:
   - el contrato está pausado;
   - `amount == 0`;
   - el proveedor no está habilitado;
   - `invoice.cuit != vendors[vendor].cuit`;
   - la partida no existe;
   - `invoicePaid[id]`;
   - ya hay un pago `Pending` con el mismo `invoiceId`.
2. Calcula `id = keccak256(abi.encode(cuit, tipo, ptoVta, nro))`.
3. Guarda el pago y emite `PaymentProposed`.
4. Ejecuta en el acto (con `Rule.Auto`) solo si se cumplen todas estas condiciones:
   - `amount <= perTxCap`;
   - `budget.spent + amount <= budget.allocated`;
   - `vendorSpentThisPeriod(vendor) + amount <= vendorMonthlyCap`;
   - `amount <= token.balanceOf(this)`;
   - `vendor != agent`.

   Si alguna falla, queda `Pending` y devuelve `executed = false`.
5. El período del tope por proveedor es `block.timestamp / 30 days`. Solo los pagos automáticos suman a ese acumulado.

**Ejecutar un pago** (función interna, igual en los dos caminos):
- Marca `invoicePaid`.
- Suma a `budget.spent`.
- Transfiere al proveedor.
- Emite `PaymentExecuted` con:
  - `rule`;
  - `overBudget = spent > allocated` después de sumar;
  - `budgetExpired = block.timestamp > periodEnd`.
- Sigue el patrón checks-effects-interactions y usa `ReentrancyGuard`.

**`approve(paymentId)`:**
- Pago `Pending`.
- Un voto por firmante; un voto repetido revierte.
- Emite `PaymentApproved`.
- Al llegar al umbral ejecuta con `Rule.Signers`, si no está pausado. Si está pausado, el voto queda y la ejecución espera a `executePayment`.
- Con firmas, el pago puede exceder la partida.
- Antes de ejecutar revalida tres cosas: que el proveedor siga habilitado, que la factura no esté pagada y que haya saldo. Si no hay saldo, revierte.

**`executePayment(paymentId)`:** firmante; pago `Pending` con aprobaciones ≥ umbral; no pausado.

**`reject(paymentId)`:** firmante; pago `Pending` → `Rejected`.

**Propuestas:**
- `propose(kind, data)` guarda la propuesta, cuenta el voto del proponente y emite `ProposalCreated`. Si el umbral es 1, ejecuta en el acto.
- `approveProposal` agrega votos y ejecuta al llegar al umbral.
- Qué hace cada `kind`:
  - `SetBudget`: crea o reemplaza `allocated` y `periodEnd` de la partida, sin tocar `spent`, y la agrega a `budgetLines`.
  - `MoveBudget`: resta `amount` del `allocated` de origen y lo suma al de destino. El origen tiene que tener `allocated - spent >= amount`. Emite `BudgetMoved`.
  - `SetVendor`.
  - `SetCaps`.
  - `SetSigners`: valida igual que el constructor. Incrementa un `signerEpoch` que invalida los votos anteriores de pagos y propuestas abiertos: los votos se cuentan por epoch.
  - `SetAgent`: el agente no puede ser firmante.
  - `SetConfigHash`.
  - `Unpause`.
- Cada acción emite su evento.

**`pause()`:** cualquier firmante, y emite `Paused`. Reanudar solo con una propuesta `Unpause`.

**Views:** todas las de la interfaz.

### BoxFactory y DepositBox

- **`BoxFactory(treasury, token)`.**
- **`boxAddress(ref)`:** dirección CREATE2 del buzón. Se puede usar `Clones.cloneDeterministic` de OpenZeppelin con un `DepositBox` de implementación, o un despliegue CREATE2 con argumentos de constructor.
- **`sweep(ref)`:** cualquiera puede llamarla.
  - Despliega el buzón si no tiene código y le pide que aporte todo su saldo de wARS con `treasury.contribute(balance, ref)`.
  - Antes de aportar, el buzón aprueba al tesoro.
  - Emite `BoxSwept`.
  - Con saldo 0, devuelve 0 sin revertir.
- **El buzón no tiene ninguna otra función que mueva fondos.** El destino y el `ref` son fijos, y solo la fábrica puede ordenar el barrido.

### MockWARS

ERC-20 con 18 decimales, símbolo `wARS` y `mint` libre. Es solo para tests y local.

### DeployLocal.s.sol

Despliega en anvil, para que el módulo 07 lo use:
- `MockWARS`;
- `TreasuryPolicy` con firmantes y agente que llegan por variables de entorno;
- `BoxFactory`.

Imprime las direcciones en formato JSON.

## Aceptación

**Comando:** `cd contracts && mise exec -- forge test -vv` pasa entero.

**Invariantes:** tests de invariantes con un handler que llame en forma aleatoria a todas las funciones públicas, con actores agente, firmantes, extraños y proveedores. Tienen que probar:

1. Ningún wARS sale del tesoro hacia una dirección que no sea un proveedor habilitado en el momento del pago.
2. Ningún pago `Rule.Auto` supera `perTxCap`, el saldo disponible de su partida ni el tope del período del proveedor.
3. El agente no puede ejecutar ninguna propuesta ni recibir fondos sin el umbral de firmas.
4. Con el contrato pausado no se ejecuta ningún pago.
5. Cada pago ejecutado emite `PaymentExecuted` con `invoiceId`, `fileHash`, `lineId` y `rule`.
6. El balance del tesoro es igual a los aportes (`Contribution`) más las transferencias directas menos los pagos. No hay `Contribution` sin `transferFrom` real.
7. Un `invoiceId` se paga como máximo una vez.
8. El CUIT de la factura coincide con el `vendors[vendor].cuit` del pago.
9. Un buzón solo transfiere al tesoro.

**Tests de escenario:**
- pago automático;
- pago escalado y aprobado con 2 de 3;
- rechazo;
- votos duplicados;
- votos que se invalidan al cambiar firmantes;
- pausa con votos pendientes y después `Unpause` y `executePayment`;
- `MoveBudget` con motivo;
- partida vencida que sigue pagando con `budgetExpired = true`;
- pago escalado que excede la partida con `overBudget = true`;
- pago al agente siempre escalado;
- intento de reentrada con un token malicioso;
- buzón con saldo 0;
- buzón barrido dos veces;
- fuzz de montos alrededor de los topes.

**Sin errores ni warnings** de `forge build`.

## Reporte

Lista de archivos, salida resumida de `forge test`, cambios pedidos a la interfaz (si hay) y estado `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` o `BLOCKED`.
