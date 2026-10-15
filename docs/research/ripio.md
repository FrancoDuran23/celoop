# Ripio para una cooperadora escolar: investigación

Fecha: 2026-10-14. Caso: asociación civil sin fines de lucro con CUIT, contrato tesorero en Celo que custodia wARS (`0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D`).

Confianza: **confirmado** (lo dice una fuente primaria), **probable** (se infiere de fuentes primarias o lo dice una fuente de Ripio que no es normativa), **no encontrado**.

Fuentes principales:
- Docs B2B: https://docs.ripio.com/llms-full.txt y `https://docs.ripio.com/ramps-api/openapi.json`
- Brief comercial de Ripio, v1.5 del 2026-10-13: https://github.com/ripio/agents-toolkit, archivo "Ripio Business - Brief for AI Assistants.md" (dice que se publica en ai.ripio.com/context.md, URL que no respondió)
- T&C del on/off-ramp de Moonbird SRL y Digipayments, actualizados 8/3/2026: https://terms.ripio.com/ar/on-off-ramp
- T&C de Digipayments, actualizados 5/4/2026: https://terms.ripio.com/ar/digipayments
- UIF Res. 49/2024: https://www.argentina.gob.ar/normativa/nacional/norma-397597/texto
- CNV RG 1058/2025: https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-1058-2025-410635/texto

---

## 1. KYB: tipos de persona jurídica y documentación

**Respuesta:** ninguna fuente pública dice qué tipos societarios acepta Ripio, ni para el partner ni para un customer `BUSINESS`.
- **Partner (platform.ripio.com):** el KYB es un formulario en kyc.ripio.com con `schema=B2B_PJ`. El bundle del front no trae la lista de documentos, que se carga desde el servidor. El brief dice "It is for legal entities only". El contacto de onboarding es b2b@ripio.com.
- **Customer `BUSINESS` en la Ramps API:** el enum `type: INDIVIDUAL | BUSINESS` existe. La página "Deactivate Customer" menciona un endpoint `/kyb/`, pero ese endpoint no figura en el OpenAPI. "KYC fields by country" para AR solo tiene campos de persona humana: DNI, CUIL/CUIT, género, fecha de nacimiento.
- **T&C del on/off-ramp:** cl. 5, "Si estuviese disponible el registro de personas jurídicas…". También: "Ninguna persona podrá utilizar los Servicios en calidad de comerciante… solamente con fines personales, no comerciales." Digipayments dice lo mismo en su cl. 6, citando la RG AFIP 4636.
- **Piso regulatorio (UIF 49/2024, art. 24):** para una persona jurídica, el PSAV tiene que pedir:
  - denominación;
  - fecha y número de inscripción registral;
  - CUIT;
  - copia del instrumento de constitución o del estatuto actualizado;
  - domicilio, teléfono y email;
  - actividad;
  - representantes legales y apoderados;
  - nómina del órgano de administración;
  - titularidad del capital;
  - beneficiarios finales.

  El artículo no menciona "acta de designación de autoridades" textualmente. Lo más cercano es el inc. i, "nómina del órgano de administración". El art. 26 h marca como cliente de mayor riesgo a las "personas o estructuras jurídicas que operan con fondos de terceros". Una cooperadora que recauda cuotas de los padres podría caer ahí.

**Confianza:** no encontrado en cuanto a qué tipos acepta Ripio y qué documentos pide. Confirmado en cuanto al piso de la UIF.

**Pregunta para Ripio:** "¿Pueden onboardear como customer `BUSINESS` de la Ramps API en Argentina a una asociación civil sin fines de lucro con personería de IGJ o DPPJ y CUIT? ¿Qué documentos piden: estatuto, inscripción, acta de designación de autoridades, constancia de CUIT, DDJJ de beneficiario final, constancia de sujeto obligado UIF? ¿El KYB del customer se hace por `/kyb/` o por kyc.ripio.com con otro schema? ¿La cláusula de 'fines personales, no comerciales' aplica a un customer `BUSINESS`?"

## 2. Transferencias de terceros (padres) al CVU

**Respuesta:** no encontré ningún reason code de "third party deposit".
- `ON-RAMP.DEPOSIT.REJECTED` tiene un solo motivo documentado: un depósito que no matchea ninguna orden.
- Los valores de `failureReason` son `INVALID_DESTINATION`, `EXPIRED_QUOTE`, `PROVIDER_REJECTED`, `PROVIDER_ERROR`, `REFUND_BY_PROVIDER`, `USER_BANNED`, `AMOUNT_LIMIT_EXCEEDED`, `KYC_NOT_APPROVED` e `INTERNAL_ERROR`.
- Los valores de `rejectionReason` del refund son `DUPLICATE_REQUEST`, `INVALID_DESTINATION`, `ALREADY_RESOLVED`, `NOT_ELIGIBLE` y `CONTACT_SUPPORT`.
- Si un control de titularidad existiera, lo más probable es que apareciera como `PROVIDER_REJECTED` o `REFUND_BY_PROVIDER`, pero eso es inferencia.
- En AR, el refund de on-ramp vuelve a "the account the customer paid from" (`refundDestinationRequired: false`).

Los T&C de Digipayments, que emite el CVU, permiten expresamente el ingreso "desde cuentas de misma titularidad o de un tercero" (cl. 11). El help center del Ripio retail dice lo mismo: "Podés recibir transferencias de terceros a través de CVU".

En la normativa (UIF 49/2024 y CNV RG 1058/2025) no hay una prohibición expresa de recibir fondos de terceros. Lo que sí hay en la UIF 49/2024 es una alerta, art. 34 b vii: "Situaciones en las cuales se utilice una cuenta para depositar fondos de terceros". Y el art. 26 h, ya citado, clasifica como de mayor riesgo a quien opera con fondos de terceros.

**Confianza:**
- Probable que se acepten a nivel técnico: los T&C del CVU las permiten y no hay reason code de rechazo.
- No encontrado si compliance las bloquea para un customer `BUSINESS`.
- Confirmado que la normativa las trata como alerta y no como prohibición.

**Pregunta para Ripio:** "Para un customer `BUSINESS` en AR, ¿se acreditan las transferencias al CVU desde cuentas de personas humanas con un CUIL distinto al del titular? ¿Hay un tope de cantidad o de monto por originante? ¿Un rechazo por titularidad llega como `ON-RAMP.DEPOSIT.REJECTED`, como `ORDER.CANCELLED` con `PROVIDER_REJECTED` o como otra cosa? ¿El webhook trae el CUIL del originante (`originAccountIdentifier`) además de `sender`?"

## 3. Off-ramp a cuentas de terceros

**Respuesta:** en Argentina el off-ramp puede ir a la cuenta de un tercero, según Ripio.
- El brief dice: "In Argentina, Brazil and Colombia, that account may belong to the end user or to a third-party beneficiary. In Mexico, it must belong to the end user". También: "the end user's own, or a third party's… what makes payouts possible".
- En create-fiat-account para AR (`bank_transfer`, campo único `alias_or_cvu_destination`), la validación es sincrónica. La cuenta vuelve como `unconfirmed`, con el titular resuelto en `metadata` para que el usuario lo revise.
- Los docs exigen que el titular coincida solo en MX (RFC) y en BR (CPF/CNPJ), donde la cuenta queda `disabled`. Para AR no dicen eso.
- Hay una contradicción menor: la página del ciclo de vida describe la validación como "does the account exist and belong to the customer", y en BR los docs dicen que hay que cobrar en una cuenta propia.
- Sigue vigente la restricción conocida: una sola cuenta `enabled` por medio de pago. Pagar a varios proveedores implica rotar la cuenta activa. La anterior pasa a `suspended` y se reactiva cuando se vuelve a usar.
- La CNV RG 1058/2025 no exige mismo titular. Los arts. 18 y 19 piden segregar los fondos y "transferir según instrucciones del cliente".

**Confianza:** probable. El brief de Ripio es explícito, pero los docs técnicos no lo dicen para AR y no es un documento contractual.

**Pregunta para Ripio:** "En AR, si una fiat account de un customer `BUSINESS` resuelve a un CUIT distinto, ¿queda `unconfirmed` y se puede confirmar, o queda `disabled`? ¿Hay límites para pagar a terceros? ¿Se puede tener más de una cuenta `enabled` para pagar a varios proveedores, o cambiar la cuenta por orden sin rotar la activa?"

## 4. Precios y límites

- **Tarifas:**
  - Los T&C del on/off-ramp (cl. 9.3.4) dicen:
    - "Comisión primera transacción: USD 1 más impuestos"
    - "Mercado Pago: 5,8%"
    - "compra de activos virtuales: 0,1%"
    - "venta: 0,1%"
  - Digipayments cobra $0 por depósitos y retiros por transferencia. Su página de T&C menciona además un 0,5% de Moonbird, que parece corresponder a otro producto.
  - En la API, el schema `Fee` del quote tiene `appliesOnFirstOrder`, lo que coincide con la comisión de USD 1 de la primera transacción.
  - La página del hackathon y la prensa hablan de ramps "free" / "no-cost" para wFIAT en Celo.
  - El brief sostiene que ARS→wARS es 1:1 y "no FX", y que el pricing B2B se negocia con cada partner y no se publica.
- **Límites:** la Ramps API los publica por transacción en `GET /transactionLimits/`, y no hay límites diarios ni mensuales. El ejemplo de los docs muestra:
  - `ARS_ONRAMP_TRANSACTION_MIN_LIMIT: 2100`
  - `ARS_ONRAMP_TRANSACTION_MAX_LIMIT: 500000`
  - `ARS_OFFRAMP_TRANSACTION_MIN_LIMIT: 2121`
  - `ARS_OFFRAMP_TRANSACTION_MAX_LIMIT: 500000`

  Es solo un ejemplo y los valores reales dependen de la cuenta. Un depósito sobre el máximo se rechaza y se devuelve (`BuyTransactionMaxLimitExceeded`, 20018).

**Confianza:**
- Confirmado que existen las tarifas de los T&C del widget o customer final y que los límites se exponen en la API.
- No encontrado el pricing B2B real ni los límites reales de una cuenta.

**Pregunta para Ripio:** "Para ARS↔wARS en Celo vía Ramps API con un customer `BUSINESS`, ¿qué fee y spread aplican? ¿Se cobra el USD 1 de la primera operación? ¿Cuáles son los mínimos y máximos por transacción en ARS para nuestra cuenta?"

## 5. Sell and Pay

**Respuesta:**
- **Solo paga QR de comercio.** El rail es QR en AR y BREB-QR en CO, y `paymentCurrency` acepta solo ARS o COP. No hay campo para un CBU o CVU arbitrario. Para pagar a un CBU, CVU o alias se usa el off-ramp con una fiat account.
- **wARS como moneda de depósito:** no está documentado. `depositCurrency` y `depositNetwork` son texto libre, con ejemplos USDC/BTC/ETH en ETHEREUM y POLYGON. Ni wARS ni Celo aparecen en ninguna parte de docs.ripio.com. El brief cuenta el caso de un cliente cuyos usuarios "pay with their wFIAT balance" vía QR, y dice que Sell and Pay se habilita por partner.
- En AR hay que crear antes la cuenta de Sell and Pay con `POST /sellAndPays/fiatAccounts/`.

**Confianza:** confirmado que solo paga QR. Probable, pero no confirmado para Celo, que acepte wARS.

**Pregunta para Ripio:** "¿Sell and Pay en AR acepta `depositCurrency=WARS` en `depositNetwork` Celo (42220)? ¿Qué QR acepta: interoperable de Transferencias 3.0, de Mercado Pago, MODO? ¿Hay un monto mínimo?"

## 6. Alternativas a Ripio para pasar pesos a wARS en Celo

- **No encontré otro on-ramp fiat que liste wARS en Celo.** Busqué Manteca, Belo, Lemon, Buenbit, Bitso, Transak, Alchemy Pay, Decaf, Peanut y MiniPay.
- **Rutas que dependen de Ripio:**
  - El Ripio retail o ramp.ripio.com en otra red, sumado a Ripio Bridge (https://bridge.ripio.com/developers). El bridge es burn/mint, no pide KYB y lista wARS en Ethereum, Base, World Chain, BSC, Polygon, Gnosis, Celo, HyperEVM y Arc. El fee es fijo por ruta y se lee on-chain en `routeConfigs`.
  - El `llms.txt` de ramp.ripio.com todavía lista solo Base, Ethereum y World Chain, aunque la página del hackathon usa `chain=42220`.
- **Rutas on-chain, sin fiat:**
  - Textile FX: pares wARS y wBRL en Celo, con liquidez de Tribeca Park. DefiLlama muestra volumen $0 en Celo en los últimos 30 días.
  - Uniswap, con liquidez puesta por Ripio según el brief.

  Estas rutas sirven para pasar de USDC/USDT a wARS, no de pesos a wARS.

**Confianza:** no encontré un on-ramp alternativo. Confirmado que existen el bridge y Textile FX.

## 7. Indicaciones de Ripio para los builders del hackathon

- **Página del hackathon** (https://www.loops.house/agents-on-open-rails/):
  - Recomienda ramp.ripio.com, "no credentials needed, easiest for the hackathon".
  - La Ramps API B2B es "for legal entities (companies)", con KYB en platform.ripio.com.
  - No hay sandbox, credenciales ni contacto de Ripio. "Celo mainnet only".
  - Las consultas van a Telegram (t.me/realworldagentshackathon) y a las Office Hours de los jueves a las 12:00 GMT.
- **Telegram:** es un grupo, sin preview público, así que no pude leerlo.
- **Livestream con Ripio** (https://www.youtube.com/watch?v=kjRJUaf1Fgo): no pude leer la descripción.
- **Sandbox:** existe, pero se accede con credenciales de partner (client_id y client_secret) que da Ripio. En el panel de platform.ripio.com dice: "En sandbox la configuración es fija: RTEST en ETHEREUM_SEPOLIA". O sea, no hay wARS ni Celo en sandbox.
- **Contactos públicos:**
  - b2b@ripio.com (onboarding de platform.ripio.com)
  - Juan Martín Idoyaga, Head of Accounts B2B, juan.idoyaga@ripio.com (según el brief de github.com/ripio/agents-toolkit)

**Confianza:**
- Confirmado lo que dice la página.
- No encontrado acceso B2B especial ni credenciales para los participantes.
- No verificado el contenido de Telegram y del video.

**Pregunta para Ripio, por Telegram u Office Hours:** "¿Hay acceso B2B acelerado o credenciales sandbox o mainnet para equipos del hackathon que necesiten la Ramps API, por ejemplo un customer `BUSINESS` con CVU persistente? ¿A quién le escribimos?"
