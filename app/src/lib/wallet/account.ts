// The passkey Safe account. Browser-safe: used by the pages to sign and by the server to compute
// the counterfactual address. Same parameters on both sides, so both get the same address.
import { toSafeSmartAccount } from "permissionless/accounts";
import { bytesToHex, hexToBytes, type Address, type Chain, type Client, type Hex, type Transport } from "viem";
import { toWebAuthnAccount, type WebAuthnAccount } from "viem/account-abstraction";
import { ENTRY_POINT, SAFE_VERSION } from "./constants";

export type PasskeyCredential = {
  /** WebAuthn credential id (base64url). */
  id: string;
  /** P-256 public key, uncompressed (0x04 || x || y) or raw (x || y). */
  publicKey: Hex;
};

/** A read client (no account), e.g. createPublicClient(...). */
export type ReadClient = Client<Transport, Chain | undefined, undefined>;

export type PasskeySafeOptions = {
  client: ReadClient;
  credential: PasskeyCredential;
  /** WebAuthn relying party id (env().RP_ID, passed down from the server). */
  rpId?: string;
  /** ERC-8021 suffix appended to every callData (attributionSuffix(), passed down from the server). */
  attributionSuffix?: Hex;
  /** For tests: replaces navigator.credentials.get. */
  getFn?: Parameters<typeof toWebAuthnAccount>[0]["getFn"];
  /** Known Safe address (passkeys.safeAddress): skips recomputing it from the chain. */
  address?: Address;
};

/** 0x04 || x || y, the form stored in passkeys.publicKey. Throws on anything that isn't 64/65 bytes. */
export function normalizePublicKey(publicKey: Hex): Hex {
  const bytes = hexToBytes(publicKey);
  if (bytes.length === 64) return bytesToHex(new Uint8Array([4, ...bytes]));
  if (bytes.length === 65 && bytes[0] === 4) return bytesToHex(bytes);
  throw new Error("Invalid P-256 public key");
}

export function passkeyOwner(opts: Pick<PasskeySafeOptions, "credential" | "rpId" | "getFn">): WebAuthnAccount {
  return toWebAuthnAccount({
    credential: { id: opts.credential.id, publicKey: normalizePublicKey(opts.credential.publicKey) },
    rpId: opts.rpId,
    getFn: opts.getFn,
  });
}

/**
 * Safe 1.4.1 with the passkey as its only owner (via Safe's WebAuthn shared signer), on
 * EntryPoint v0.7. Deployed by its first UserOperation.
 */
export async function passkeySafeAccount(opts: PasskeySafeOptions) {
  return toSafeSmartAccount({
    client: opts.client,
    owners: [passkeyOwner(opts)],
    version: SAFE_VERSION,
    entryPoint: ENTRY_POINT,
    // The tag is concatenated onto the Safe's executeUserOp calldata (permissionless does
    // concat([calldata, onchainIdentifier])). That is the UserOperation callData. The bundler's
    // handleOps transaction does not end with the tag — the signature is ABI-encoded after the
    // callData — so ERC-8021 indexers read it with fromEntryPointCalldata, not off tx.input.
    // /api/bundler checks the same tail before it sponsors the operation.
    onchainIdentifier: opts.attributionSuffix,
    address: opts.address,
  });
}

/** Counterfactual address of the passkey's Safe. Reads the proxy creation code from the chain. */
export async function passkeySafeAddress(client: ReadClient, credential: PasskeyCredential) {
  const account = await passkeySafeAccount({ client, credential });
  return account.getAddress();
}
