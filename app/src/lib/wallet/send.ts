// Sends calls from the passkey Safe as a sponsored UserOperation through /api/bundler.
// Browser-safe. The node reads, the bundler and the paymaster all go through the same proxy URL.
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type Log,
  type Transport,
} from "viem";
import { celo } from "viem/chains";
import { passkeySafeAccount, type PasskeyCredential } from "./account";
import { ENTRY_POINT } from "./constants";

export type SafeCall = { to: Address; data: Hex; value?: bigint };

export type SendSafeCallsParams = {
  credential: PasskeyCredential;
  calls: SafeCall[];
  chainId: number;
  /** Sign link token: the proxy authorizes each request with it. */
  token: string;
  rpId?: string;
  attributionSuffix: Hex;
  /** Defaults to `/api/bundler`. */
  bundlerUrl?: string;
  /** Overrides the HTTP transport (tests). */
  transport?: Transport;
  /** false = no paymaster, the Safe pays (tests against a fork). */
  sponsored?: boolean;
  getFn?: Parameters<typeof passkeySafeAccount>[0]["getFn"];
  /** Max wait for the receipt. */
  timeoutMs?: number;
  /** The Safe's address if already known (skips recomputing it). */
  safeAddress?: Address;
};

export type SendSafeCallsResult = {
  userOpHash: Hex;
  transactionHash: Hex;
  success: boolean;
  logs: Log[];
  sender: Address;
};

export function bundlerTransport(token: string, bundlerUrl = "/api/bundler"): Transport {
  const base = typeof window === "undefined" ? bundlerUrl : new URL(bundlerUrl, window.location.origin).toString();
  const sep = base.includes("?") ? "&" : "?";
  return http(`${base}${sep}t=${encodeURIComponent(token)}`, { retryCount: 0, timeout: 60_000 });
}

export async function sendSafeCalls(params: SendSafeCallsParams): Promise<SendSafeCallsResult> {
  const transport = params.transport ?? bundlerTransport(params.token, params.bundlerUrl);
  const chain = defineChain({ ...celo, id: params.chainId });
  const client = createPublicClient({ chain, transport });
  const account = await passkeySafeAccount({
    client,
    credential: params.credential,
    rpId: params.rpId,
    attributionSuffix: params.attributionSuffix,
    getFn: params.getFn,
    address: params.safeAddress,
  });
  const sponsored = params.sponsored ?? true;
  const pimlico = createPimlicoClient({ transport, entryPoint: ENTRY_POINT });
  const smartClient = createSmartAccountClient({
    account,
    chain,
    client,
    bundlerTransport: transport,
    paymaster: sponsored ? pimlico : undefined,
    userOperation: sponsored
      ? { estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast }
      : undefined,
  });

  const userOpHash = await smartClient.sendUserOperation({ calls: params.calls });
  const receipt = await smartClient.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: params.timeoutMs ?? 120_000,
    pollingInterval: 1_500,
  });
  return {
    userOpHash,
    transactionHash: receipt.receipt.transactionHash,
    success: receipt.success,
    logs: receipt.logs,
    sender: account.address,
  };
}

/** A person-readable message for anything sendSafeCalls throws. */
export function sendErrorMessage(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message} ${String((error as { details?: unknown }).details ?? "")}` : String(error);
  if (/NotAllowedError|SignFailed|cancel|abort/i.test(text)) {
    return "We couldn't confirm with your fingerprint or PIN. Try again.";
  }
  if (/Demasiadas operaciones|429/i.test(text)) return "You've done a lot of operations today. Try tomorrow.";
  if (/Link inválido/i.test(text)) return "The link expired or was already used. Ask for a new one in the chat.";
  if (/Operación no permitida|403/i.test(text)) return "This operation isn't allowed from this page.";
  if (/timeout|timed out/i.test(text)) return "The operation is taking longer than usual. Check in a few minutes whether it was recorded.";
  return "The operation couldn't be completed. Try again in a bit.";
}
