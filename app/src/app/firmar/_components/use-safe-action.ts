"use client";
// Runs calls from the person's passkey Safe through /api/bundler and tracks the state for the UI.
import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import type { PasskeyCredential } from "@/lib/wallet/account";
import { explorerTxUrl } from "@/lib/wallet/constants";
import { sendErrorMessage, sendSafeCalls, type SafeCall, type SendSafeCallsResult } from "@/lib/wallet/send";

export type SignerConfig = {
  token: string;
  credential: PasskeyCredential;
  safe: Address;
  chainId: number;
  rpId: string;
  attributionSuffix: Hex;
};

export type ActionState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; result: SendSafeCallsResult; explorerUrl: string | null }
  | { status: "error"; message: string };

export function useSafeAction(config: SignerConfig) {
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const run = useCallback(
    async (calls: SafeCall[]): Promise<SendSafeCallsResult | null> => {
      setState({ status: "working" });
      try {
        const result = await sendSafeCalls({
          credential: config.credential,
          safeAddress: config.safe,
          calls,
          chainId: config.chainId,
          token: config.token,
          rpId: config.rpId,
          attributionSuffix: config.attributionSuffix,
        });
        if (!result.success) {
          setState({ status: "error", message: "The operation arrived but couldn't be completed. Someone may have already resolved it. Reload the page." });
          return null;
        }
        setState({ status: "done", result, explorerUrl: explorerTxUrl(config.chainId, result.transactionHash) });
        return result;
      } catch (error) {
        console.error(error);
        setState({ status: "error", message: sendErrorMessage(error) });
        return null;
      }
    },
    [config],
  );
  return { state, run, reset: () => setState({ status: "idle" }) };
}
