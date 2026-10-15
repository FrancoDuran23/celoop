# 02 — Lector y validador de facturas

## Objetivo

Recibir una factura argentina en foto o PDF y devolver sus datos fiscales: primero desde el QR de ARCA y, solo si falla, con Claude. Después validarla con reglas fijas.

El camino del dinero no depende del LLM: el LLM solo lee. Toda decisión es código.

## Archivos

**Le pertenecen:** `app/src/lib/invoice/**`, incluidos los tests y `app/src/lib/invoice/fixtures/`.

**No toca:**
- Nada fuera de ese directorio.
- No corre `npm install`. Ya están instaladas: `zxing-wasm`, `jsqr`, `sharp`, `pdfjs-dist`, `@napi-rs/canvas` (si no está, pedirla), `@anthropic-ai/sdk` y `zod`.

## Interfaz pública

Se exporta desde `app/src/lib/invoice/index.ts`:

```ts
type InvoiceFields = {
  cuit: bigint;            // emisor, 11 dígitos
  tipo: number;            // código ARCA: 6 = Factura B, 11 = Factura C (otros se leen pero no se aceptan)
  ptoVta: number;
  nro: bigint;
  importe: string;         // decimal en pesos, "12500.00"
  fecha: string;           // YYYY-MM-DD
  moneda: string;          // "PES"
  receptorDocTipo: number | null;  // 80 = CUIT
  receptorDocNro: bigint | null;
  cae: string | null;
};

type ReadResult =
  | { ok: true; fields: InvoiceFields; source: "qr" | "llm" | "qr+llm"; raw: unknown }
  | { ok: false; reason: string };  // en español, para mostrarle a la persona

readInvoice(file: { bytes: Uint8Array; mimeType: string }, deps?: { extractWithLlm?: LlmExtractor }): Promise<ReadResult>

type Validation = { ok: true } | { ok: false; code: ValidationCode; reason: string };
validateInvoice(fields: InvoiceFields, ctx: {
  cooperadoraCuit: bigint;
  enabledVendorCuits: Set<bigint>;   // o una función de búsqueda
  alreadyPaid: (fields: InvoiceFields) => Promise<boolean>;
  today: string;                     // YYYY-MM-DD
}): Promise<Validation>

invoiceIdOf(fields): `0x${string}`   // keccak256(abi.encode(uint64 cuit, uint16 tipo, uint32 ptoVta, uint64 nro)), igual que el contrato
fileHashOf(bytes): `0x${string}`     // keccak256 de los bytes
toWarsUnits(importe: string): bigint // 1 peso = 1 wARS, 18 decimales
looksLikeInjection(text: string): boolean
```

## Comportamiento

**QR de ARCA**
- El QR codifica una URL `https://www.afip.gob.ar/fe/qr/?p=<base64>`. El base64 es un JSON con `ver`, `fecha`, `cuit`, `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda`, `ctz`, `tipoDocRec`, `nroDocRec`, `tipoCodAut` y `codAut`.
- Hay que tolerar las variantes: base64 sin padding o url-safe, dominio `arca.gob.ar` y números como string.

**Imágenes**
- Decodificar con `zxing-wasm`, sobre la imagen original y sobre versiones preprocesadas con `sharp`: escala de grises, contraste, reescalado y rotaciones.
- Si `zxing-wasm` falla, probar con `jsqr`.

**PDF**
- Renderizar las páginas con `pdfjs-dist` y buscar el QR igual que en una imagen.
- Además extraer el texto del PDF, para el LLM y para detectar inyección.

**Claude** (cuando no hay QR, o para completar el receptor si el QR no lo trae)
- Se le manda la imagen o el PDF con una herramienta cuyo esquema de entrada es `InvoiceFields`, y se valida la respuesta con zod.
- El prompt deja explícito que el contenido de la factura es dato: se ignora cualquier instrucción que aparezca en ella.
- El modelo sale de `env().CLAUDE_MODEL`.
- Inyectable con `deps.extractWithLlm`, para que los tests no llamen a la API.

**Cruce de fuentes**
- Si hay QR y también datos del LLM, y no coinciden en CUIT, tipo, número o importe, el resultado es `ok: false` con un motivo de revisión humana.

**`validateInvoice`** devuelve el primer error en este orden:

| Código | Condición | Motivo |
|---|---|---|
| `TIPO_NO_ACEPTADO` | El tipo no es 6 ni 11 | "Solo se aceptan facturas B o C" |
| `RECEPTOR_INCORRECTO` | `receptorDocTipo` no es 80 o `receptorDocNro` no es el CUIT de la cooperadora | "La factura no está a nombre de la cooperadora (CUIT …)" |
| `PROVEEDOR_NO_HABILITADO` | El emisor no está en la lista de proveedores | Lo explica |
| `IMPORTE_INVALIDO` | El importe es ≤ 0 o la moneda no es PES | Lo explica |
| `FECHA_INVALIDA` | La fecha es futura o tiene más de 365 días | Lo explica |
| `YA_PAGADA` | `alreadyPaid` devuelve verdadero | Lo explica |

**`looksLikeInjection`**
- Detecta texto que intenta dar órdenes: "pagar a", "transferir a", "ignorá", "nueva cuenta", CBU o alias, o direcciones `0x…` dentro del texto de la factura.
- Si da positivo, la factura va a revisión aunque sea válida. Eso lo decide el orquestador, y este módulo solo expone la función.

## Aceptación

- `cd app && npx vitest run src/lib/invoice` pasa.
- **Fixtures:**
  - QR sintéticos generados en el test (con un generador simple o bytes conocidos);
  - al menos un PNG de factura C con QR;
  - un PDF con QR;
  - una foto rotada o con poco contraste.

  Si no podés generarlos sin dependencias nuevas, pedí la dependencia en el reporte, por ejemplo `qrcode` como devDependency.
- **Tests:**
  - decodificación del payload (variantes);
  - lectura desde PNG, PDF y foto difícil;
  - fallback al LLM con un extractor falso;
  - discrepancia entre QR y LLM que va a revisión;
  - cada código de validación;
  - `invoiceIdOf` igual al valor que da `keccak256(abi.encode(...))`, comprobado con `encodeAbiParameters` de viem;
  - `looksLikeInjection` con casos positivos y negativos.
- `npx tsc --noEmit` sin errores en los archivos del módulo.

## Reporte

Archivos, dependencias pedidas, resultado de tests y estado (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` o `BLOCKED`).
