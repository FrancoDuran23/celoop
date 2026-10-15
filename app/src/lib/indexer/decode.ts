// Decoding helpers for the indexer: raw logs to named events, proposal payloads to JSON.
import { decodeAbiParameters, decodeEventLog, erc20Abi, getAddress, isAddressEqual, type Hex } from "viem";
import { boxFactoryAbi, treasuryPolicyAbi } from "@/lib/chain/abi";
import type { IndexerAddresses, RawLog } from "./source";

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
] as const;
export type ProposalKindName = (typeof PROPOSAL_KINDS)[number];

const PROPOSAL_PARAMS: Record<ProposalKindName, readonly { name: string; type: string }[]> = {
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
};

export function proposalKindName(kind: number): ProposalKindName | `Unknown(${number})` {
  return PROPOSAL_KINDS[kind] ?? `Unknown(${kind})`;
}

/** Decodes a proposal's `data` according to its kind. Bigints become decimal strings. */
export function decodeProposalData(kind: number, data: Hex): Record<string, unknown> {
  const name = PROPOSAL_KINDS[kind];
  if (!name) return { error: `unknown kind ${kind}` };
  const params = PROPOSAL_PARAMS[name];
  if (params.length === 0) return {};
  try {
    const values = decodeAbiParameters(params, data);
    return Object.fromEntries(params.map((p, i) => [p.name, toJson(values[i])]));
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

/** JSON-safe copy: bigint → decimal string, recursively. */
export function toJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  }
  return value;
}

export type DecodedLog = RawLog & { eventName: string; args: Record<string, unknown> };

/** Decodes a log from one of the three sources, or null if it is not one we index. */
export function decodeLog(log: RawLog, addresses: IndexerAddresses): DecodedLog | null {
  const topics = log.topics as [Hex, ...Hex[]];
  try {
    const base = { ...log, address: getAddress(log.address) };
    if (isAddressEqual(log.address, addresses.treasury)) {
      const ev = decodeEventLog({ abi: treasuryPolicyAbi, data: log.data, topics });
      return { ...base, eventName: ev.eventName, args: (ev.args ?? {}) as Record<string, unknown> };
    }
    if (isAddressEqual(log.address, addresses.boxFactory)) {
      const ev = decodeEventLog({ abi: boxFactoryAbi, data: log.data, topics });
      return { ...base, eventName: ev.eventName, args: ev.args as Record<string, unknown> };
    }
    if (isAddressEqual(log.address, addresses.wars)) {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics });
      if (ev.eventName !== "Transfer" || !isAddressEqual(ev.args.to, addresses.treasury)) return null;
      return { ...base, eventName: "Transfer", args: ev.args as Record<string, unknown> };
    }
  } catch {
    return null;
  }
  return null;
}
