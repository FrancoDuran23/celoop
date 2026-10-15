// Configuration proposals: encode what the form builds, decode what the page shows. Browser-safe.
import {
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { formatCuit, formatPesos, shortAddress } from "./format";

/** Same order as ITreasuryPolicy.ProposalKind. */
export const PROPOSAL_KINDS = [
  "SetBudget",
  "MoveBudget",
  "SetVendor",
  "SetCaps",
  "SetSigners",
  "SetAgent",
  "SetConfigHash",
  "Unpause",
  "SetAuditor",
] as const;
export type ProposalKindName = (typeof PROPOSAL_KINDS)[number];

const PARAMS = {
  SetBudget: [
    { name: "lineId", type: "bytes32" },
    { name: "allocated", type: "uint256" },
    { name: "periodEnd", type: "uint64" },
  ],
  MoveBudget: [
    { name: "fromLine", type: "bytes32" },
    { name: "toLine", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "reasonHash", type: "bytes32" },
  ],
  SetVendor: [
    { name: "vendor", type: "address" },
    { name: "cuit", type: "uint64" },
    { name: "enabled", type: "bool" },
  ],
  SetCaps: [
    { name: "perTxCap", type: "uint256" },
    { name: "vendorMonthlyCap", type: "uint256" },
  ],
  SetSigners: [
    { name: "signers", type: "address[]" },
    { name: "threshold", type: "uint256" },
  ],
  SetAgent: [{ name: "agent", type: "address" }],
  SetConfigHash: [{ name: "configHash", type: "bytes32" }],
  Unpause: [],
  SetAuditor: [{ name: "auditor", type: "address" }],
} as const;

/** Index for the contract (`propose(kind, data)`), from a name or a numeric string. */
export function proposalKindIndex(kind: string | number): number {
  const asNumber = typeof kind === "number" ? kind : /^\d+$/.test(kind) ? Number(kind) : NaN;
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber < PROPOSAL_KINDS.length) return asNumber;
  const index = PROPOSAL_KINDS.findIndex((k) => k.toLowerCase() === String(kind).toLowerCase());
  if (index < 0) throw new Error(`Unknown proposal kind ${kind}`);
  return index;
}

export function proposalKindName(kind: string | number): ProposalKindName {
  return PROPOSAL_KINDS[proposalKindIndex(kind)];
}

/** keccak256 of the motive as UTF-8: what MoveBudget carries on chain. */
export function reasonHash(reasonText: string): Hex {
  return keccak256(stringToBytes(reasonText));
}

export function encodeMoveBudget(args: { fromLine: Hex; toLine: Hex; amount: bigint; reasonText: string }): Hex {
  return encodeAbiParameters(PARAMS.MoveBudget, [
    args.fromLine,
    args.toLine,
    args.amount,
    reasonHash(args.reasonText),
  ]);
}

export function encodeUnpause(): Hex {
  return "0x";
}

export function encodeSetBudget(args: { lineId: Hex; allocated: bigint; periodEnd: bigint }): Hex {
  return encodeAbiParameters(PARAMS.SetBudget, [args.lineId, args.allocated, args.periodEnd]);
}

export function encodeSetVendor(args: { vendor: Address; cuit: bigint; enabled: boolean }): Hex {
  return encodeAbiParameters(PARAMS.SetVendor, [args.vendor, args.cuit, args.enabled]);
}

export function encodeSetCaps(args: { perTxCap: bigint; vendorMonthlyCap: bigint }): Hex {
  return encodeAbiParameters(PARAMS.SetCaps, [args.perTxCap, args.vendorMonthlyCap]);
}

export type DecodedProposal =
  | { kind: "SetBudget"; lineId: Hex; allocated: bigint; periodEnd: bigint }
  | { kind: "MoveBudget"; fromLine: Hex; toLine: Hex; amount: bigint; reasonHash: Hex }
  | { kind: "SetVendor"; vendor: Address; cuit: bigint; enabled: boolean }
  | { kind: "SetCaps"; perTxCap: bigint; vendorMonthlyCap: bigint }
  | { kind: "SetSigners"; signers: readonly Address[]; threshold: bigint }
  | { kind: "SetAgent"; agent: Address }
  | { kind: "SetConfigHash"; configHash: Hex }
  | { kind: "Unpause" }
  | { kind: "SetAuditor"; auditor: Address };

export function decodeProposal(kind: string | number, data: Hex): DecodedProposal {
  const name = proposalKindName(kind);
  switch (name) {
    case "SetBudget": {
      const [lineId, allocated, periodEnd] = decodeAbiParameters(PARAMS.SetBudget, data);
      return { kind: name, lineId, allocated, periodEnd };
    }
    case "MoveBudget": {
      const [fromLine, toLine, amount, hash] = decodeAbiParameters(PARAMS.MoveBudget, data);
      return { kind: name, fromLine, toLine, amount, reasonHash: hash };
    }
    case "SetVendor": {
      const [vendor, cuit, enabled] = decodeAbiParameters(PARAMS.SetVendor, data);
      return { kind: name, vendor, cuit, enabled };
    }
    case "SetCaps": {
      const [perTxCap, vendorMonthlyCap] = decodeAbiParameters(PARAMS.SetCaps, data);
      return { kind: name, perTxCap, vendorMonthlyCap };
    }
    case "SetSigners": {
      const [signers, threshold] = decodeAbiParameters(PARAMS.SetSigners, data);
      return { kind: name, signers, threshold };
    }
    case "SetAgent": {
      const [agent] = decodeAbiParameters(PARAMS.SetAgent, data);
      return { kind: name, agent };
    }
    case "SetConfigHash": {
      const [configHash] = decodeAbiParameters(PARAMS.SetConfigHash, data);
      return { kind: name, configHash };
    }
    case "Unpause":
      return { kind: name };
    case "SetAuditor": {
      const [auditor] = decodeAbiParameters(PARAMS.SetAuditor, data);
      return { kind: name, auditor };
    }
  }
}

export type DescribeContext = {
  /** Human name of a budget line by its bytes32 id. */
  lineName?: (lineId: Hex) => string | undefined;
  /** Human name of a vendor by address. */
  vendorName?: (address: Address) => string | undefined;
  /** Motive saved in proposals.reasonText. */
  reasonText?: string | null;
};

export type ProposalDescription = {
  /** One sentence, e.g. "Mover $ 100.000,00 de Eventos a Mantenimiento. Motivo: rotura de caño". */
  summary: string;
  /** For MoveBudget: whether reasonText hashes to what the contract has. null = no text saved. */
  reasonMatches: boolean | null;
};

const formatDate = (unixSeconds: bigint) =>
  new Date(Number(unixSeconds) * 1000).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** The proposal as one sentence in plain Spanish. */
export function describeProposal(proposal: DecodedProposal, ctx: DescribeContext = {}): ProposalDescription {
  const line = (id: Hex) => ctx.lineName?.(id) ?? `una partida sin nombre (${shortAddress(id)})`;
  const vendor = (a: Address) => ctx.vendorName?.(a) ?? shortAddress(a);
  switch (proposal.kind) {
    case "MoveBudget": {
      const text = ctx.reasonText?.trim();
      const matches = text ? reasonHash(ctx.reasonText!) === proposal.reasonHash : null;
      const motive = text ? ` Motivo: ${text}` : "";
      return {
        summary: `Mover ${formatPesos(proposal.amount)} de ${line(proposal.fromLine)} a ${line(proposal.toLine)}.${motive}`,
        reasonMatches: matches,
      };
    }
    case "SetBudget":
      return {
        summary: `Asignar ${formatPesos(proposal.allocated)} a ${line(proposal.lineId)}, hasta el ${formatDate(proposal.periodEnd)}.`,
        reasonMatches: null,
      };
    case "SetVendor":
      return {
        summary: proposal.enabled
          ? `Habilitar al proveedor ${vendor(proposal.vendor)} (CUIT ${formatCuit(proposal.cuit)}).`
          : `Dar de baja al proveedor ${vendor(proposal.vendor)} (CUIT ${formatCuit(proposal.cuit)}).`,
        reasonMatches: null,
      };
    case "SetCaps":
      return {
        summary: `Cambiar los topes de pago automático: hasta ${formatPesos(proposal.perTxCap)} por pago y ${formatPesos(proposal.vendorMonthlyCap)} por proveedor cada 30 días.`,
        reasonMatches: null,
      };
    case "SetSigners": {
      const n = proposal.signers.length;
      return {
        summary: `Cambiar quiénes firman: ${n} ${n === 1 ? "persona" : "personas"}, y cada pago grande necesita ${proposal.threshold} ${proposal.threshold === BigInt(1) ? "firma" : "firmas"}.`,
        reasonMatches: null,
      };
    }
    case "SetAgent":
      return { summary: `Cambiar el agente que propone los pagos a ${shortAddress(proposal.agent)}.`, reasonMatches: null };
    case "SetConfigHash":
      return { summary: "Actualizar la configuración publicada de la cooperadora.", reasonMatches: null };
    case "Unpause":
      return { summary: "Reanudar los pagos, que hoy están pausados.", reasonMatches: null };
    case "SetAuditor":
      return {
        summary: /^0x0{40}$/i.test(proposal.auditor)
          ? "Sacar al auditor: los pagos chicos vuelven a salir sin su revisión."
          : `Cambiar el auditor que revisa los pagos a ${shortAddress(proposal.auditor)}.`,
        reasonMatches: null,
      };
  }
}
