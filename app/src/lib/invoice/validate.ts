import type { InvoiceFields, Validation } from "./types";

export type ValidationContext = {
  cooperadoraCuit: bigint;
  enabledVendorCuits: Set<bigint> | ((cuit: bigint) => boolean | Promise<boolean>);
  alreadyPaid: (fields: InvoiceFields) => Promise<boolean>;
  /** YYYY-MM-DD */
  today: string;
};

const MAX_AGE_DAYS = 365;

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t / 86_400_000;
}

function fmtCuit(c: bigint): string {
  const s = c.toString().padStart(11, "0");
  return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
}

function fail(code: Extract<Validation, { ok: false }>["code"], reason: string): Validation {
  return { ok: false, code, reason };
}

export async function validateInvoice(fields: InvoiceFields, ctx: ValidationContext): Promise<Validation> {
  if (fields.tipo !== 6 && fields.tipo !== 11) {
    return fail("TIPO_NO_ACEPTADO", "Solo se aceptan facturas B o C");
  }
  if (fields.receptorDocTipo !== 80 || fields.receptorDocNro !== ctx.cooperadoraCuit) {
    return fail("RECEPTOR_INCORRECTO", `La factura no está a nombre de la cooperadora (CUIT ${fmtCuit(ctx.cooperadoraCuit)})`);
  }
  const vendors = ctx.enabledVendorCuits;
  const enabled = typeof vendors === "function" ? await vendors(fields.cuit) : vendors.has(fields.cuit);
  if (!enabled) {
    return fail(
      "PROVEEDOR_NO_HABILITADO",
      `El proveedor (CUIT ${fmtCuit(fields.cuit)}) no está en la lista de proveedores habilitados de la cooperadora`,
    );
  }
  let importeOk = false;
  try {
    importeOk = /^\d+(\.\d+)?$/.test(fields.importe) && Number(fields.importe) > 0;
  } catch {
    importeOk = false;
  }
  if (!importeOk) return fail("IMPORTE_INVALIDO", "El importe de la factura tiene que ser mayor a cero");
  if (fields.moneda !== "PES") return fail("IMPORTE_INVALIDO", "La factura tiene que estar en pesos argentinos");

  const day = dayNumber(fields.fecha);
  const today = dayNumber(ctx.today);
  if (day === null || today === null) return fail("FECHA_INVALIDA", "No se pudo leer la fecha de la factura");
  if (day > today) return fail("FECHA_INVALIDA", "La fecha de la factura es futura");
  if (today - day > MAX_AGE_DAYS) return fail("FECHA_INVALIDA", "La factura tiene más de un año de antigüedad");

  if (await ctx.alreadyPaid(fields)) return fail("YA_PAGADA", "Esta factura ya fue pagada");
  return { ok: true };
}
