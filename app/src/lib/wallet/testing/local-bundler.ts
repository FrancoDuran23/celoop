// A minimal stand-in for Pimlico in tests: fixed gas estimates, and eth_sendUserOperation runs
// EntryPoint.handleOps directly on the local chain from an anvil key. No paymaster, no mempool.
import {
  createWalletClient,
  http,
  parseEventLogs,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  entryPoint07Abi,
  formatUserOperation,
  getUserOperationHash,
  toPackedUserOperation,
} from "viem/account-abstraction";
import { tagClient } from "@/lib/chain/attribution";
import type { Forward, JsonRpcRequest } from "../bundler";
import { ENTRY_POINT } from "../constants";

export const LOCAL_GAS = {
  preVerificationGas: "0x186a0", // 100k
  verificationGasLimit: "0x124f80", // 1.2M: deploys the Safe and verifies P-256 in Solidity
  callGasLimit: "0x30d40", // 200k
};

/**
 * Waits for a receipt by polling eth_getTransactionReceipt. viem's waitForTransactionReceipt
 * watches block numbers and sometimes misses the blocks of an anvil fork of Celo.
 */
export async function waitMined(client: PublicClient, hash: Hex, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await client.request({ method: "eth_getTransactionReceipt", params: [hash] }))) {
    if (Date.now() > deadline) throw new Error(`not mined: ${hash}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return client.getTransactionReceipt({ hash });
}

export function localBundler(opts: { rpcUrl: string; chain: Chain; publicClient: PublicClient; bundlerKey: Hex }) {
  // The outer handleOps is a transaction we send in tests (Pimlico sends it in production, and we
  // cannot suffix that one). writeContract's dataSuffix tags it. The tag that indexers credit for
  // a bundle is still the one on the UserOperation callData; this outer suffix is extra.
  const wallet = tagClient(
    createWalletClient({ account: privateKeyToAccount(opts.bundlerKey), chain: opts.chain, transport: http(opts.rpcUrl) }),
  );
  const sent = new Map<Hex, Hex>();
  const handled: { userOpHash: Hex; txHash: Hex; callData: Hex }[] = [];

  const forward: Forward = async (request: JsonRpcRequest) => {
    const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id: request.id, result });
    const params = request.params ?? [];
    switch (request.method) {
      case "eth_estimateUserOperationGas":
        return ok(LOCAL_GAS);
      case "eth_sendUserOperation": {
        const userOperation = formatUserOperation(params[0] as never);
        const txHash = await wallet.writeContract({
          address: ENTRY_POINT.address,
          abi: entryPoint07Abi,
          functionName: "handleOps",
          args: [[toPackedUserOperation(userOperation)], wallet.account.address],
          gas: BigInt(5_000_000),
        });
        const receipt = await waitMined(opts.publicClient, txHash);
        if (receipt.status !== "success") throw new Error("handleOps reverted");
        const userOpHash = getUserOperationHash({
          userOperation,
          entryPointAddress: ENTRY_POINT.address,
          entryPointVersion: "0.7",
          chainId: opts.chain.id,
        });
        sent.set(userOpHash, txHash);
        handled.push({ userOpHash, txHash, callData: userOperation.callData });
        return ok(userOpHash);
      }
      case "eth_getUserOperationReceipt": {
        const txHash = sent.get(params[0] as Hex);
        if (!txHash) return ok(null);
        const raw = (await opts.publicClient.request({ method: "eth_getTransactionReceipt", params: [txHash] })) as {
          logs: Parameters<typeof parseEventLogs>[0]["logs"];
        };
        const receipt = await opts.publicClient.getTransactionReceipt({ hash: txHash });
        const [event] = parseEventLogs({ abi: entryPoint07Abi, eventName: "UserOperationEvent", logs: receipt.logs });
        return ok({
          userOpHash: params[0],
          entryPoint: ENTRY_POINT.address,
          sender: event.args.sender,
          nonce: `0x${event.args.nonce.toString(16)}`,
          actualGasUsed: `0x${event.args.actualGasUsed.toString(16)}`,
          actualGasCost: `0x${event.args.actualGasCost.toString(16)}`,
          success: event.args.success,
          logs: raw.logs,
          receipt: raw,
        });
      }
      default:
        throw new Error(`local bundler: ${request.method} not supported`);
    }
  };
  return { forward, handled };
}
