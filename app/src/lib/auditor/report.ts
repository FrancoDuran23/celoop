// The public audit report of one payment. Its JSON text is stored as is (audits.reportJson) and its
// keccak256 goes on chain with auditPayment, so anyone can download it and check the hash.
import { keccak256, stringToBytes, type Hex } from "viem";
import { isFlagged, type Finding } from "./checks";

export const REPORT_KIND = "cooperadora-segura/auditoria-de-pago";

export type AuditReport = {
  kind: typeof REPORT_KIND;
  version: 1;
  chainId: number;
  treasury: string;
  auditor: string;
  paymentId: string;
  payment: { vendor: string; amount: string; lineId: string; invoiceId: string; fileHash: string };
  verdict: "cleared" | "flagged";
  findings: Finding[];
  checkedAt: string;
};

export function buildAuditReport(args: {
  chainId: number;
  treasury: string;
  auditor: string;
  paymentId: bigint;
  payment: { vendor: string; amount: bigint; lineId: string; invoiceId: string; fileHash: string };
  findings: Finding[];
  checkedAt: Date;
}): { report: AuditReport; json: string; hash: Hex } {
  // Built field by field so the key order (and therefore the hash) never depends on the input.
  const report: AuditReport = {
    kind: REPORT_KIND,
    version: 1,
    chainId: args.chainId,
    treasury: args.treasury,
    auditor: args.auditor,
    paymentId: args.paymentId.toString(),
    payment: {
      vendor: args.payment.vendor,
      amount: args.payment.amount.toString(),
      lineId: args.payment.lineId,
      invoiceId: args.payment.invoiceId,
      fileHash: args.payment.fileHash,
    },
    verdict: isFlagged(args.findings) ? "flagged" : "cleared",
    findings: args.findings.map((f) => ({ code: f.code, level: f.level, text: f.text })),
    checkedAt: args.checkedAt.toISOString(),
  };
  const json = JSON.stringify(report);
  return { report, json, hash: reportHash(json) };
}

export const reportHash = (json: string): Hex => keccak256(stringToBytes(json));
