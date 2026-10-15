// What /api/bundler is willing to sponsor. Pure decoding plus injected lookups, so it can be
// tested without a chain or a bundler.
//
// Allowed: a v0.7 UserOperation with no value, from a Safe registered in `passkeys`, whose
// callData is Safe4337Module.executeUserOp[WithErrorString] (a single CALL, or a DELEGATECALL to
// MultiSendCallOnly 1.4.1 with only CALLs inside) followed by the ERC-8021 tag, and whose calls are:
// - to the treasury: approve, reject, executePayment, propose, approveProposal, pause — and only
//   if the Safe is a signer (isSigner);
// - to wARS: transfer — and only if the Safe is a vendor's address.
// Every decoded piece is re-encoded and compared byte for byte, so nothing can hide in padding.
import {
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  hexToBigInt,
  isAddressEqual,
  size,
  slice,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import {
  ENTRY_POINT,
  MAX_FEE_PER_GAS,
  MAX_OPERATION_GAS,
  MULTI_SEND_CALL_ONLY,
  SAFE_PROXY_FACTORY,
} from "./constants";
import { linkAllows, linkOwnsSafe, type ResolvedLink } from "./links";

export const safe4337ModuleAbi = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeUserOpWithErrorString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

export const multiSendAbi = [
  {
    type: "function",
    name: "multiSend",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
] as const;

export const TREASURY_FUNCTIONS = [
  "approve",
  "reject",
  "executePayment",
  "propose",
  "approveProposal",
  "pause",
] as const;
export type TreasuryFunction = (typeof TREASURY_FUNCTIONS)[number];

export type DecodedCall =
  | { target: "treasury"; functionName: TreasuryFunction; args: readonly unknown[] }
  | { target: "wars"; functionName: "transfer"; args: readonly [Address, bigint] };

export type PolicyReason =
  | "malformed"
  | "entry_point"
  | "not_registered"
  | "no_tag"
  | "bad_call_data"
  | "value"
  | "operation"
  | "target"
  | "function"
  | "factory"
  | "gas"
  | "fee"
  | "not_signer"
  | "not_vendor"
  | "wrong_person"
  | "scope";

export class PolicyViolation extends Error {
  constructor(
    readonly reason: PolicyReason,
    message: string,
  ) {
    super(message);
    this.name = "PolicyViolation";
  }
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const quantity = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** EntryPoint v0.7 UserOperation as sent over JSON-RPC. v0.6 fields are rejected. */
export const rpcUserOperationSchema = z
  .object({
    sender: address,
    nonce: quantity,
    factory: address.nullish(),
    factoryData: hex.nullish(),
    callData: hex,
    callGasLimit: quantity.nullish(),
    verificationGasLimit: quantity.nullish(),
    preVerificationGas: quantity.nullish(),
    maxFeePerGas: quantity.nullish(),
    maxPriorityFeePerGas: quantity.nullish(),
    paymaster: address.nullish(),
    paymasterVerificationGasLimit: quantity.nullish(),
    paymasterPostOpGasLimit: quantity.nullish(),
    paymasterData: hex.nullish(),
    signature: hex.nullish(),
  })
  .passthrough()
  .refine((op) => !("initCode" in op) && !("paymasterAndData" in op), "v0.6 UserOperation");
export type RpcUserOperation = z.infer<typeof rpcUserOperationSchema>;

export type PolicyContext = {
  treasury: Address;
  wars: Address;
  /** attributionSuffix() from lib/chain/attribution: callData must end with it. */
  attributionSuffix: Hex;
  isRegisteredSafe: (safe: Address) => Promise<boolean>;
  isSigner: (safe: Address) => Promise<boolean>;
  isVendor: (safe: Address) => Promise<boolean>;
};

export type PolicyResult =
  | { ok: true; sender: Address; calls: DecodedCall[] }
  | { ok: false; reason: PolicyReason; message: string };

const lower = (h: string) => h.toLowerCase();

/** Strips the tag and decodes the Safe's calls. Throws PolicyViolation. */
export function decodeSafeCallData(
  callData: Hex,
  ctx: Pick<PolicyContext, "treasury" | "wars" | "attributionSuffix">,
): DecodedCall[] {
  const suffix = lower(ctx.attributionSuffix);
  const data = lower(callData);
  if (suffix.length <= 2 || !data.endsWith(suffix.slice(2)) || data.length <= suffix.length) {
    throw new PolicyViolation("no_tag", "callData does not end with the attribution tag");
  }
  const body = data.slice(0, data.length - (suffix.length - 2)) as Hex;
  if (lower(concatHex([body, ctx.attributionSuffix])) !== data) {
    throw new PolicyViolation("no_tag", "callData does not end with the attribution tag");
  }

  let outer;
  try {
    outer = decodeFunctionData({ abi: safe4337ModuleAbi, data: body });
  } catch {
    throw new PolicyViolation("bad_call_data", "callData is not a Safe4337Module execution");
  }
  if (lower(encodeFunctionData({ abi: safe4337ModuleAbi, functionName: outer.functionName, args: outer.args })) !== body) {
    throw new PolicyViolation("bad_call_data", "callData has trailing or non-canonical bytes");
  }
  const [to, value, inner, operation] = outer.args;
  if (value !== BigInt(0)) throw new PolicyViolation("value", "operations cannot move CELO");

  if (operation === 0) return [decodeInnerCall(to, inner, ctx)];
  if (operation !== 1) throw new PolicyViolation("operation", "unknown Safe operation");
  if (!isAddressEqual(to, MULTI_SEND_CALL_ONLY)) {
    throw new PolicyViolation("operation", "delegatecall is only allowed to MultiSendCallOnly");
  }
  return decodeMultiSend(inner).map((tx) => {
    if (tx.operation !== 0) throw new PolicyViolation("operation", "batched calls must be plain calls");
    if (tx.value !== BigInt(0)) throw new PolicyViolation("value", "operations cannot move CELO");
    return decodeInnerCall(tx.to, tx.data, ctx);
  });
}

function decodeMultiSend(data: Hex) {
  let packed: Hex;
  try {
    const decoded = decodeFunctionData({ abi: multiSendAbi, data });
    if (lower(encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: decoded.args })) !== lower(data)) {
      throw new Error("non-canonical");
    }
    packed = decoded.args[0];
  } catch {
    throw new PolicyViolation("bad_call_data", "batch is not a multiSend call");
  }
  const txs: { operation: number; to: Address; value: bigint; data: Hex }[] = [];
  const total = size(packed);
  let pos = 0;
  while (pos < total) {
    if (pos + 85 > total) throw new PolicyViolation("bad_call_data", "truncated batch");
    const operation = Number(hexToBigInt(slice(packed, pos, pos + 1)));
    const to = getAddress(slice(packed, pos + 1, pos + 21));
    const value = hexToBigInt(slice(packed, pos + 21, pos + 53));
    const length = Number(hexToBigInt(slice(packed, pos + 53, pos + 85)));
    pos += 85;
    if (pos + length > total) throw new PolicyViolation("bad_call_data", "truncated batch");
    const txData = length === 0 ? "0x" : slice(packed, pos, pos + length);
    pos += length;
    txs.push({ operation, to, value, data: txData });
  }
  if (txs.length === 0) throw new PolicyViolation("bad_call_data", "empty batch");
  const reencoded = concatHex(
    txs.map((t) =>
      encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [t.operation, t.to, t.value, BigInt(size(t.data)), t.data]),
    ),
  );
  if (lower(reencoded) !== lower(packed)) throw new PolicyViolation("bad_call_data", "non-canonical batch");
  return txs;
}

function decodeInnerCall(
  to: Address,
  data: Hex,
  ctx: Pick<PolicyContext, "treasury" | "wars">,
): DecodedCall {
  if (isAddressEqual(to, ctx.treasury)) {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: treasuryPolicyAbi, data });
    } catch {
      throw new PolicyViolation("function", "unknown treasury function");
    }
    if (!(TREASURY_FUNCTIONS as readonly string[]).includes(decoded.functionName)) {
      throw new PolicyViolation("function", `treasury.${decoded.functionName} is not sponsored`);
    }
    const reencoded = encodeFunctionData({
      abi: treasuryPolicyAbi,
      functionName: decoded.functionName,
      args: decoded.args,
    } as Parameters<typeof encodeFunctionData>[0]);
    if (lower(reencoded) !== lower(data)) {
      throw new PolicyViolation("bad_call_data", "non-canonical treasury call");
    }
    return { target: "treasury", functionName: decoded.functionName as TreasuryFunction, args: decoded.args ?? [] };
  }
  if (isAddressEqual(to, ctx.wars)) {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: erc20Abi, data });
    } catch {
      throw new PolicyViolation("function", "unknown wARS function");
    }
    if (decoded.functionName !== "transfer") {
      throw new PolicyViolation("function", `wARS.${decoded.functionName} is not sponsored`);
    }
    if (lower(encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: decoded.args })) !== lower(data)) {
      throw new PolicyViolation("bad_call_data", "non-canonical wARS call");
    }
    return { target: "wars", functionName: "transfer", args: decoded.args as readonly [Address, bigint] };
  }
  throw new PolicyViolation("target", `calls to ${to} are not sponsored`);
}

const big = (v: string | null | undefined) => (v ? BigInt(v) : BigInt(0));

/** Total gas the operation may burn. */
export function operationGas(op: RpcUserOperation): bigint {
  return (
    big(op.callGasLimit) +
    big(op.verificationGasLimit) +
    big(op.preVerificationGas) +
    big(op.paymasterVerificationGasLimit) +
    big(op.paymasterPostOpGasLimit)
  );
}

/**
 * Full check. `link` (when given) scopes the operation to the link's person and target.
 * Never throws: returns { ok: false, reason } for anything not allowed.
 */
export async function checkUserOperation(
  rawOp: unknown,
  ctx: PolicyContext,
  opts: { link?: ResolvedLink; entryPoint?: unknown } = {},
): Promise<PolicyResult> {
  try {
    const parsed = rpcUserOperationSchema.safeParse(rawOp);
    if (!parsed.success) throw new PolicyViolation("malformed", "not a v0.7 UserOperation");
    const op = parsed.data;
    if (opts.entryPoint !== undefined) {
      if (typeof opts.entryPoint !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(opts.entryPoint) || !isAddressEqual(opts.entryPoint as Address, ENTRY_POINT.address)) {
        throw new PolicyViolation("entry_point", "only EntryPoint v0.7 is supported");
      }
    }
    const sender = getAddress(op.sender);

    if (op.factory && !isAddressEqual(op.factory as Address, SAFE_PROXY_FACTORY)) {
      throw new PolicyViolation("factory", "only the Safe 1.4.1 proxy factory may deploy");
    }
    if (operationGas(op) > MAX_OPERATION_GAS) {
      throw new PolicyViolation("gas", `operation exceeds ${MAX_OPERATION_GAS} gas`);
    }
    if (big(op.maxFeePerGas) > MAX_FEE_PER_GAS || big(op.maxPriorityFeePerGas) > MAX_FEE_PER_GAS) {
      throw new PolicyViolation("fee", "fee per gas above the sponsored maximum");
    }

    const calls = decodeSafeCallData(op.callData as Hex, ctx);

    if (opts.link) {
      if (!linkOwnsSafe(opts.link, sender)) {
        throw new PolicyViolation("wrong_person", "the link belongs to another person's Safe");
      }
      checkScope(calls, opts.link);
    }

    if (!(await ctx.isRegisteredSafe(sender))) {
      throw new PolicyViolation("not_registered", "sender is not a registered passkey Safe");
    }
    if (calls.some((c) => c.target === "treasury") && !(await ctx.isSigner(sender))) {
      throw new PolicyViolation("not_signer", "sender is not a treasury signer");
    }
    if (calls.some((c) => c.target === "wars") && !(await ctx.isVendor(sender))) {
      throw new PolicyViolation("not_vendor", "sender is not a vendor");
    }
    return { ok: true, sender, calls };
  } catch (error) {
    if (error instanceof PolicyViolation) return { ok: false, reason: error.reason, message: error.message };
    return { ok: false, reason: "malformed", message: "could not decode the operation" };
  }
}

/** A link only authorizes what it was sent for. */
function checkScope(calls: DecodedCall[], link: ResolvedLink) {
  for (const call of calls) {
    if (link.purpose === "vendor") {
      if (call.target !== "wars") throw new PolicyViolation("scope", "a vendor link only moves wARS");
      continue;
    }
    if (link.purpose !== "sign" || call.target !== "treasury") {
      throw new PolicyViolation("scope", "this link does not authorize that call");
    }
    const id = call.args[0] as bigint | undefined;
    const allowed =
      call.functionName === "pause" ||
      (call.functionName === "propose" && linkAllows(link, "propose")) ||
      (call.functionName === "approveProposal" && linkAllows(link, "proposal", id)) ||
      (["approve", "reject", "executePayment"].includes(call.functionName) && linkAllows(link, "payment", id));
    if (!allowed) throw new PolicyViolation("scope", "this link is for another payment or proposal");
  }
}
