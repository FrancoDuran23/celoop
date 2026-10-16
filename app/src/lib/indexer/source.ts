// Where the indexer reads from. The default reads Celo through viem; tests pass fake logs.
import { getAbiItem, erc20Abi, type Address, type Hex } from "viem";
import type { Db } from "@/db";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { publicClient } from "@/lib/chain/clients";
import type { ChainScope } from "@/lib/chain/treasury";
import { warsAddress } from "@/lib/chain/treasury";
import { resolveBoxFactory, resolveTreasury } from "@/lib/tenant";

export type RawLog = {
  address: Address;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  data: Hex;
  topics: Hex[];
};

export type IndexerAddresses = { treasury: Address; boxFactory: Address; wars: Address };

export interface IndexerSource {
  addresses(): Promise<IndexerAddresses>;
  latestBlock(): Promise<bigint>;
  /**
   * Logs in [fromBlock, toBlock]: every treasury event, every box factory event and the wARS
   * Transfers whose `to` is the treasury.
   */
  getLogs(fromBlock: bigint, toBlock: bigint): Promise<RawLog[]>;
  blockTime(blockNumber: bigint): Promise<Date>;
  readBudget(lineId: Hex): Promise<{ allocated: bigint; spent: bigint; periodEnd: bigint }>;
}

const transferEvent = getAbiItem({ abi: erc20Abi, name: "Transfer" });

/** Reads Celo with publicClient(). Addresses come from `scope`, else the only active row, else env. */
export function chainSource(scope: ChainScope & { db?: Db } = {}): IndexerSource {
  let cached: IndexerAddresses | undefined;
  const addresses = async () =>
    (cached ??= {
      treasury: await resolveTreasury(scope.db, scope.treasury),
      boxFactory: await resolveBoxFactory(scope.db, scope.boxFactory),
      wars: await warsAddress(scope),
    });

  const toRaw = (l: {
    address: Address;
    blockNumber: bigint | null;
    transactionHash: Hex | null;
    logIndex: number | null;
    data: Hex;
    topics: readonly Hex[];
  }): RawLog => ({
    address: l.address,
    blockNumber: l.blockNumber!,
    transactionHash: l.transactionHash!,
    logIndex: l.logIndex!,
    data: l.data,
    topics: [...l.topics],
  });

  return {
    addresses,
    latestBlock: () => publicClient().getBlockNumber({ cacheTime: 0 }),
    async getLogs(fromBlock, toBlock) {
      const { treasury, boxFactory, wars } = await addresses();
      const client = publicClient();
      const [own, transfers] = await Promise.all([
        client.getLogs({ address: [treasury, boxFactory], fromBlock, toBlock }),
        client.getLogs({ address: wars, event: transferEvent, args: { to: treasury }, fromBlock, toBlock }),
      ]);
      return [...own, ...transfers].filter((l) => !l.removed).map(toRaw);
    },
    async blockTime(blockNumber) {
      const block = await publicClient().getBlock({ blockNumber });
      return new Date(Number(block.timestamp) * 1000);
    },
    async readBudget(lineId) {
      const { treasury } = await addresses();
      const b = await publicClient().readContract({
        address: treasury,
        abi: treasuryPolicyAbi,
        functionName: "budget",
        args: [lineId],
      });
      return { allocated: b.allocated, spent: b.spent, periodEnd: BigInt(b.periodEnd) };
    },
  };
}
