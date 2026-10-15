// Turns what a signer fills in /firmar/proponer into a proposal for the contract: validates the
// input, encodes `propose(kind, data)` and writes the summary shown before signing. Browser-safe.
import { getAddress, isAddress, keccak256, stringToBytes, zeroAddress, type Address, type Hex } from "viem";
import { parsePesos } from "./format";
import {
  describeProposal,
  encodeMoveBudget,
  encodeSetBudget,
  encodeSetCaps,
  encodeSetVendor,
  encodeUnpause,
  proposalKindIndex,
  type DecodedProposal,
  type ProposalKindName,
} from "./proposals";

/** CUIT/CUIL: 11 digits whose last one is the mod-11 check digit (weights 5432765432). */
export function isValidCuit(cuit: string | bigint): boolean {
  const s = cuit.toString();
  if (!/^\d{11}$/.test(s)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod;
  return check !== 10 && check === Number(s[10]);
}

/** "20-12345678-6", "20 12345678 6" or "20123456786" → 20123456786n; null if invalid. */
export function parseCuit(text: string): bigint | null {
  const digits = text.replace(/[\s.-]/g, "");
  return isValidCuit(digits) ? BigInt(digits) : null;
}

/** "Gastos Operativos" → "gastos-operativos". Lowercase ASCII, digits and hyphens. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** budget_lines.lineId: keccak256 of the slug's UTF-8 bytes. */
export function lineIdOf(slug: string): Hex {
  return keccak256(stringToBytes(slug));
}

/** "2026-12-31" → unix seconds of the last second of that day in Argentina (UTC-3). */
export function periodEndOf(date: string): bigint | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // 23:59:59 at UTC-3 is 02:59:59 UTC the next day.
  return BigInt(Math.floor(Date.UTC(y, mo - 1, d + 1, 2, 59, 59) / 1000));
}

export type LineRef = { lineId: Hex; name: string };

export type ProposalInput =
  | { kind: "MoveBudget"; fromLine: string; toLine: string; amount: string; reason: string }
  | { kind: "Unpause" }
  | {
      kind: "SetBudget";
      /** An existing lineId, or "new" with newName (and optionally newSlug). */
      line: string;
      newName?: string;
      newSlug?: string;
      amount: string;
      periodEnd: string;
    }
  | { kind: "SetVendor"; legalName: string; cuit: string; address: string; enabled: boolean }
  | { kind: "SetCaps"; perTxCap: string; vendorMonthlyCap: string };

/** What the page saves after the proposal is confirmed (budget line or vendor name, motive). */
export type ProposalMeta = {
  reasonText?: string;
  newLine?: { slug: string; name: string };
  vendorLegalName?: string;
};

export type BuiltProposal = {
  kind: ProposalKindName;
  kindIndex: number;
  data: Hex;
  decoded: DecodedProposal;
  summary: string;
  meta: ProposalMeta;
};

export type BuildResult = { ok: true; proposal: BuiltProposal } | { ok: false; error: string };

export type BuildContext = {
  lines: LineRef[];
  /** Unix seconds; periodEnd must be after it. */
  now?: number;
};

const fail = (error: string): BuildResult => ({ ok: false, error });

export function buildProposal(input: ProposalInput, ctx: BuildContext): BuildResult {
  const lineName = (id: Hex) => ctx.lines.find((l) => l.lineId.toLowerCase() === id.toLowerCase())?.name;
  const finish = (decoded: DecodedProposal, data: Hex, meta: ProposalMeta, names: { line?: LineRef; vendor?: string } = {}): BuildResult => {
    const summary = describeProposal(decoded, {
      lineName: (id) => (names.line && names.line.lineId.toLowerCase() === id.toLowerCase() ? names.line.name : lineName(id)),
      vendorName: () => names.vendor,
      reasonText: meta.reasonText,
    }).summary;
    return { ok: true, proposal: { kind: decoded.kind, kindIndex: proposalKindIndex(decoded.kind), data, decoded, summary, meta } };
  };

  switch (input.kind) {
    case "MoveBudget": {
      if (!lineName(input.fromLine as Hex) || !lineName(input.toLine as Hex)) return fail("Pick both budget lines.");
      if (input.fromLine.toLowerCase() === input.toLine.toLowerCase()) return fail("Pick two different budget lines.");
      const amount = parsePesos(input.amount);
      if (amount === null) return fail("Enter an amount, for example 100.000.");
      const reasonText = input.reason.trim();
      if (!reasonText) return fail("Enter the reason.");
      if (reasonText.length > 500) return fail("The reason is too long.");
      const args = { fromLine: input.fromLine as Hex, toLine: input.toLine as Hex, amount, reasonText };
      const data = encodeMoveBudget(args);
      return finish({ kind: "MoveBudget", fromLine: args.fromLine, toLine: args.toLine, amount, reasonHash: keccak256(stringToBytes(reasonText)) }, data, {
        reasonText,
      });
    }
    case "Unpause":
      return finish({ kind: "Unpause" }, encodeUnpause(), {});
    case "SetBudget": {
      let line: LineRef;
      let newLine: ProposalMeta["newLine"];
      if (input.line === "new") {
        const name = (input.newName ?? "").trim();
        if (name.length < 2 || name.length > 60) return fail("Enter the name of the new budget line.");
        const slug = (input.newSlug ?? "").trim() || slugify(name);
        if (!SLUG_PATTERN.test(slug) || slug.length > 40) return fail("The line identifier can only have letters, numbers and hyphens.");
        const lineId = lineIdOf(slug);
        const existing = ctx.lines.find((l) => l.lineId.toLowerCase() === lineId.toLowerCase());
        if (existing) return fail(`The line ${existing.name} already exists. Pick it from the list.`);
        line = { lineId, name };
        newLine = { slug, name };
      } else {
        const name = lineName(input.line as Hex);
        if (!name) return fail("Pick a budget line.");
        line = { lineId: input.line as Hex, name };
      }
      const allocated = parsePesos(input.amount);
      if (allocated === null) return fail("Enter the allocated amount, for example 500.000.");
      const periodEnd = periodEndOf(input.periodEnd);
      if (periodEnd === null) return fail("Pick the end date of the period.");
      if (periodEnd <= BigInt(ctx.now ?? Math.floor(Date.now() / 1000))) return fail("The end date has to be in the future.");
      const data = encodeSetBudget({ lineId: line.lineId, allocated, periodEnd });
      return finish({ kind: "SetBudget", lineId: line.lineId, allocated, periodEnd }, data, newLine ? { newLine } : {}, { line });
    }
    case "SetVendor": {
      const legalName = input.legalName.trim();
      if (legalName.length < 2 || legalName.length > 200) return fail("Enter the vendor's legal name.");
      const cuit = parseCuit(input.cuit);
      if (cuit === null) return fail("The tax ID (CUIT) isn't valid. Check the 11 digits.");
      const address = input.address.trim();
      if (!isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress) {
        return fail("The vendor's account is missing or isn't valid.");
      }
      const vendor: Address = getAddress(address);
      const data = encodeSetVendor({ vendor, cuit, enabled: input.enabled });
      return finish({ kind: "SetVendor", vendor, cuit, enabled: input.enabled }, data, { vendorLegalName: legalName }, { vendor: legalName });
    }
    case "SetCaps": {
      const perTxCap = parsePesos(input.perTxCap);
      const vendorMonthlyCap = parsePesos(input.vendorMonthlyCap);
      if (perTxCap === null) return fail("Enter the cap per payment.");
      if (vendorMonthlyCap === null) return fail("Enter the monthly cap per vendor.");
      if (vendorMonthlyCap < perTxCap) return fail("The monthly cap per vendor can't be lower than the cap per payment.");
      return finish({ kind: "SetCaps", perTxCap, vendorMonthlyCap }, encodeSetCaps({ perTxCap, vendorMonthlyCap }), {});
    }
  }
}
