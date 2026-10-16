import { encodeFunctionData, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { ENTRY_POINT, MULTI_SEND_CALL_ONLY } from "./constants";
import type { ResolvedLink } from "./links";
import { checkUserOperation, decodeSafeCallData } from "./policy";
import {
  SIGNER_SAFE,
  STRANGER,
  SUFFIX,
  TREASURY,
  VENDOR_SAFE,
  WARS,
  approveData,
  batchCallData,
  offlineSafeAccount,
  pauseData,
  policyContext,
  safeCallData,
  transferData,
  userOp,
} from "./testing/fixtures";

const ctx = policyContext();
const check = (op: unknown, opts?: Parameters<typeof checkUserOperation>[2]) => checkUserOperation(op, ctx, opts);
const reason = async (op: unknown, opts?: Parameters<typeof checkUserOperation>[2]) => {
  const r = await check(op, opts);
  return r.ok ? "ok" : r.reason;
};

function link(purpose: ResolvedLink["purpose"], target: ResolvedLink["target"], safe: Address = SIGNER_SAFE): ResolvedLink {
  return {
    token: "t",
    purpose,
    target,
    expiresAt: new Date(Date.now() + 1000),
    usedAt: null,
    person: { id: 1, name: "Ana", roles: [], safeAddress: safe },
    cooperadoraId: null,
  };
}

const treasuryCall = (fn: string, args: unknown[] = []) =>
  encodeFunctionData({ abi: treasuryPolicyAbi, functionName: fn as never, args: args as never });

describe("allowed operations", () => {
  it.each([
    ["approve", [BigInt(3)]],
    ["reject", [BigInt(3)]],
    ["executePayment", [BigInt(3)]],
    ["propose", [1, "0x1234"]],
    ["approveProposal", [BigInt(1)]],
    ["pause", []],
  ])("treasury.%s from a signer", async (fn, args) => {
    const r = await check(userOp(SIGNER_SAFE, safeCallData(TREASURY, treasuryCall(fn, args))));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.calls).toEqual([expect.objectContaining({ target: "treasury", functionName: fn })]);
  });

  it("a MultiSendCallOnly batch of treasury calls", async () => {
    const op = userOp(SIGNER_SAFE, batchCallData([{ to: TREASURY, data: approveData(BigInt(3)) }, { to: TREASURY, data: pauseData() }]));
    const r = await check(op);
    expect(r.ok && r.calls.map((c) => c.functionName)).toEqual(["approve", "pause"]);
  });

  it("wARS transfer from a vendor", async () => {
    expect(await reason(userOp(VENDOR_SAFE, safeCallData(WARS, transferData(STRANGER, BigInt(10) ** BigInt(18)))))).toBe("ok");
  });

  it("exactly what permissionless encodes for one call and for a batch", async () => {
    const account = await offlineSafeAccount();
    const single = await account.encodeCalls([{ to: TREASURY, data: approveData(BigInt(7)) }]);
    const batch = await account.encodeCalls([
      { to: TREASURY, data: approveData(BigInt(7)) },
      { to: TREASURY, data: pauseData() },
    ]);
    expect(single.toLowerCase().endsWith(SUFFIX.slice(2))).toBe(true);
    expect(decodeSafeCallData(single, ctx)).toHaveLength(1);
    expect(decodeSafeCallData(batch, ctx)).toHaveLength(2);
  });

  it("a first operation that deploys the Safe through the 1.4.1 factory", async () => {
    const op = userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(1))), {
      factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
      factoryData: "0x1688f0b9",
    });
    expect(await reason(op, { entryPoint: ENTRY_POINT.address })).toBe("ok");
  });
});

describe("blocked by function", () => {
  it.each([
    ["contribute", [BigInt(1), `0x${"00".repeat(32)}`]],
    ["proposePayment", [STRANGER, { cuit: BigInt(1), tipo: 11, ptoVta: 1, nro: BigInt(1) }, BigInt(1), `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`]],
  ])("treasury.%s", async (fn, args) => {
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, treasuryCall(fn, args))))).toBe("function");
  });

  it("wARS approve and transferFrom", async () => {
    const approve = encodeFunctionData({
      abi: [{ type: "function", name: "approve", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }],
      functionName: "approve",
      args: [STRANGER, BigInt(1)],
    });
    expect(await reason(userOp(VENDOR_SAFE, safeCallData(WARS, approve)))).toBe("function");
  });

  it("calls to any other contract", async () => {
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(STRANGER, approveData(BigInt(1)))))).toBe("target");
  });

  it("calls that move CELO", async () => {
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(1)), { value: BigInt(1) })))).toBe("value");
    const batch = batchCallData([{ to: TREASURY, data: approveData(BigInt(1)), value: BigInt(1) }]);
    expect(await reason(userOp(SIGNER_SAFE, batch))).toBe("value");
  });

  it("delegatecall to anything but MultiSendCallOnly, and delegatecalls inside a batch", async () => {
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(1)), { operation: 1 })))).toBe("operation");
    const nested = batchCallData([{ to: TREASURY, data: approveData(BigInt(1)), operation: 1 }]);
    expect(await reason(userOp(SIGNER_SAFE, nested))).toBe("operation");
  });

  it("callData that is not a Safe execution, or has bytes hidden before the tag", async () => {
    expect(await reason(userOp(SIGNER_SAFE, `${approveData(BigInt(1))}${SUFFIX.slice(2)}`))).toBe("bad_call_data");
    const body = safeCallData(TREASURY, approveData(BigInt(1)), { suffix: null });
    expect(await reason(userOp(SIGNER_SAFE, `${body}deadbeef${SUFFIX.slice(2)}`))).toBe("bad_call_data");
  });
});

describe("blocked by role", () => {
  it("treasury calls from a Safe that is not a signer", async () => {
    expect(await reason(userOp(VENDOR_SAFE, safeCallData(TREASURY, approveData(BigInt(1)))))).toBe("not_signer");
  });

  it("wARS transfers from a Safe that is not a vendor", async () => {
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(WARS, transferData(STRANGER, BigInt(1)))))).toBe("not_vendor");
  });

  it("a batch mixing a vendor transfer into a signer's treasury call", async () => {
    const op = batchCallData([{ to: TREASURY, data: approveData(BigInt(1)) }, { to: WARS, data: transferData(STRANGER, BigInt(1)) }]);
    expect(await reason(userOp(SIGNER_SAFE, op))).toBe("not_vendor");
  });

  it("Safes not registered in passkeys", async () => {
    const strict = policyContext({ isRegisteredSafe: async () => false });
    const r = await checkUserOperation(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(1)))), strict);
    expect(r.ok ? "ok" : r.reason).toBe("not_registered");
  });
});

describe("blocked without the tag", () => {
  it("no suffix at all", async () => {
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(1)), { suffix: null })))).toBe("no_tag");
  });

  it("someone else's attribution code", async () => {
    const account = await offlineSafeAccount("0x6f746865725f636f646509008021802180218021802180218021802180218021");
    const callData = await account.encodeCalls([{ to: TREASURY, data: approveData(BigInt(1)) }]);
    expect(await reason(userOp(SIGNER_SAFE, callData))).toBe("no_tag");
  });
});

describe("limits and shape", () => {
  const ok = safeCallData(TREASURY, approveData(BigInt(1)));

  it("more than 2M gas in total", async () => {
    expect(await reason(userOp(SIGNER_SAFE, ok, { callGasLimit: "0x1e8480" }))).toBe("gas"); // 2M + the rest
  });

  it("a fee per gas above the cap", async () => {
    expect(await reason(userOp(SIGNER_SAFE, ok, { maxFeePerGas: "0xe8d4a51000" }))).toBe("fee"); // 1000 gwei
  });

  it("another factory", async () => {
    expect(await reason(userOp(SIGNER_SAFE, ok, { factory: STRANGER, factoryData: "0x00" }))).toBe("factory");
  });

  it("another EntryPoint, v0.6 fields, garbage", async () => {
    expect(await reason(userOp(SIGNER_SAFE, ok), { entryPoint: STRANGER })).toBe("entry_point");
    expect(await reason({ ...userOp(SIGNER_SAFE, ok), initCode: "0x" })).toBe("malformed");
    expect(await reason("hello")).toBe("malformed");
  });
});

describe("scoped by the sign link", () => {
  it("a link for payment 3 approves payment 3, not payment 4; pause is always allowed", async () => {
    const l = link("sign", { paymentId: "3" });
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(3)))), { link: l })).toBe("ok");
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(4)))), { link: l })).toBe("scope");
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, pauseData())), { link: l })).toBe("ok");
    const propose = safeCallData(TREASURY, treasuryCall("propose", [7, "0x"]));
    expect(await reason(userOp(SIGNER_SAFE, propose), { link: l })).toBe("scope");
  });

  it("a proposal link only approves that proposal; a propose link only proposes", async () => {
    const approveProposal = (id: bigint) => safeCallData(TREASURY, treasuryCall("approveProposal", [id]));
    expect(await reason(userOp(SIGNER_SAFE, approveProposal(BigInt(2))), { link: link("sign", { proposalId: "2" }) })).toBe("ok");
    expect(await reason(userOp(SIGNER_SAFE, approveProposal(BigInt(9))), { link: link("sign", { proposalId: "2" }) })).toBe("scope");
    const propose = safeCallData(TREASURY, treasuryCall("propose", [7, "0x"]));
    expect(await reason(userOp(SIGNER_SAFE, propose), { link: link("sign", { action: "propose" }) })).toBe("ok");
    expect(await reason(userOp(SIGNER_SAFE, propose), { link: link("sign", null) })).toBe("ok");
    expect(await reason(userOp(SIGNER_SAFE, approveProposal(BigInt(2))), { link: link("sign", null) })).toBe("scope");
  });

  it("a vendor link moves wARS and nothing else", async () => {
    const l = link("vendor", null, VENDOR_SAFE);
    expect(await reason(userOp(VENDOR_SAFE, safeCallData(WARS, transferData(STRANGER, BigInt(1)))), { link: l })).toBe("ok");
    expect(await reason(userOp(VENDOR_SAFE, safeCallData(TREASURY, pauseData())), { link: l })).toBe("scope");
  });

  it("an enroll link authorizes nothing", async () => {
    const l = link("enroll", null);
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, pauseData())), { link: l })).toBe("scope");
  });

  it("someone else's Safe with my link", async () => {
    const l = link("sign", { paymentId: "3" }, VENDOR_SAFE);
    expect(await reason(userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(3)))), { link: l })).toBe("wrong_person");
  });
});

it("MultiSendCallOnly is the 1.4.1 deployment", () => {
  expect(MULTI_SEND_CALL_ONLY).toBe("0x9641d764fc13c8B624c04430C7356C1C7C8102e2");
});
