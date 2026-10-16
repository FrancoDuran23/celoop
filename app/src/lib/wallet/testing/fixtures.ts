// Shared test fixtures for the wallet module.
import { concatHex, createPublicClient, custom, encodeFunctionData, encodePacked, erc20Abi, size, type Address, type Hex } from "viem";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import type { Db } from "@/db";
import { passkeys, persons, vendors } from "@/db/schema";
import { ensureCooperadora } from "@/db/testing";
import { passkeySafeAccount } from "../account";
import { MULTI_SEND_CALL_ONLY } from "../constants";
import { createSignLink, type LinkPurpose, type LinkTarget } from "../links";
import { multiSendAbi, safe4337ModuleAbi, type PolicyContext } from "../policy";

export const TREASURY: Address = "0x1111111111111111111111111111111111111111";
export const WARS: Address = "0x2222222222222222222222222222222222222222";
export const SIGNER_SAFE: Address = "0x3333333333333333333333333333333333333333";
export const VENDOR_SAFE: Address = "0x4444444444444444444444444444444444444444";
export const STRANGER: Address = "0x5555555555555555555555555555555555555555";
/** toDataSuffix("cooperadora_dev"), what attributionSuffix() gives off mainnet without a code. */
export const SUFFIX: Hex = "0x636f6f70657261646f72615f6465760f0080218021802180218021802180218021";

export const approveData = (id: bigint) => encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "approve", args: [id] });
export const pauseData = () => encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" });
export const transferData = (to: Address, amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });

/** Safe4337Module.executeUserOpWithErrorString(to, value, data, operation) + suffix. */
export function safeCallData(to: Address, data: Hex, opts: { value?: bigint; operation?: number; suffix?: Hex | null } = {}): Hex {
  const body = encodeFunctionData({
    abi: safe4337ModuleAbi,
    functionName: "executeUserOpWithErrorString",
    args: [to, opts.value ?? BigInt(0), data, opts.operation ?? 0],
  });
  const suffix = opts.suffix === undefined ? SUFFIX : opts.suffix;
  return suffix ? concatHex([body, suffix]) : body;
}

export function multiSendData(txs: { to: Address; data: Hex; value?: bigint; operation?: number }[]): Hex {
  const packed = concatHex(
    txs.map((t) =>
      encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [t.operation ?? 0, t.to, t.value ?? BigInt(0), BigInt(size(t.data)), t.data],
      ),
    ),
  );
  return encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] });
}

export function batchCallData(txs: { to: Address; data: Hex; value?: bigint; operation?: number }[], suffix: Hex | null = SUFFIX): Hex {
  return safeCallData(MULTI_SEND_CALL_ONLY, multiSendData(txs), { operation: 1, suffix });
}

export function userOp(sender: Address, callData: Hex, overrides: Record<string, unknown> = {}) {
  return {
    sender,
    nonce: "0x0",
    factory: null,
    factoryData: null,
    callData,
    callGasLimit: "0x30d40", // 200k
    verificationGasLimit: "0x7a120", // 500k
    preVerificationGas: "0xc350", // 50k
    maxFeePerGas: "0x9502f9000", // 40 gwei
    maxPriorityFeePerGas: "0x3b9aca00",
    signature: "0x",
    ...overrides,
  };
}

/** Policy context with fixed roles: SIGNER_SAFE signs, VENDOR_SAFE is a vendor, both registered. */
export function policyContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    treasury: TREASURY,
    wars: WARS,
    attributionSuffix: SUFFIX,
    isRegisteredSafe: async (s) => [SIGNER_SAFE, VENDOR_SAFE].some((a) => a.toLowerCase() === s.toLowerCase()),
    isSigner: async (s) => s.toLowerCase() === SIGNER_SAFE.toLowerCase(),
    isVendor: async (s) => s.toLowerCase() === VENDOR_SAFE.toLowerCase(),
    ...overrides,
  };
}

/** A Safe account whose client must never be hit (encodeCalls is local). */
export async function offlineSafeAccount(attributionSuffix: Hex = SUFFIX) {
  const client = createPublicClient({
    transport: custom({
      request: async () => {
        throw new Error("no chain in this test");
      },
    }),
  });
  return passkeySafeAccount({
    client,
    credential: { id: "test", publicKey: `0x04${"11".repeat(32)}${"22".repeat(32)}` },
    attributionSuffix,
    address: SIGNER_SAFE,
  });
}

let phoneCounter = 0;

export async function seedPerson(db: Db, opts: { name?: string; safe?: Address | null; roles?: string[] } = {}) {
  const [person] = await db
    .insert(persons)
    .values({
      name: opts.name ?? "Ana",
      phone: `+54938840000${String(++phoneCounter).padStart(2, "0")}`,
      roles: opts.roles ?? ["tesorero"],
      safeAddress: opts.safe ?? null,
    })
    .returning();
  if (opts.safe) {
    await db.insert(passkeys).values({
      personId: person.id,
      credentialId: `cred-${person.id}`,
      publicKey: `0x04${"ab".repeat(64)}`,
      safeAddress: opts.safe,
    });
  }
  return person;
}

export async function seedVendor(db: Db, opts: { personId?: number; address: Address; legalName?: string; cuit?: bigint }) {
  await ensureCooperadora(db);
  const [vendor] = await db
    .insert(vendors)
    .values({
      personId: opts.personId ?? null,
      legalName: opts.legalName ?? "Ferretería El Tornillo",
      cuit: opts.cuit ?? BigInt(20123456789),
      address: opts.address,
    })
    .returning();
  return vendor;
}

export async function seedLink(
  db: Db,
  personId: number,
  purpose: LinkPurpose,
  target: LinkTarget = null,
  opts: { ttlMs?: number; now?: Date } = {},
) {
  return createSignLink(db, { personId, purpose, target, ...opts });
}
