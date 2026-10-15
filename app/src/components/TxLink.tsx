import { explorerTxUrl, shortHash } from "@/lib/report/format";

/** Link to a transaction on the block explorer. Without an explorer it shows the short code. */
export function TxLink({
  txHash, chainId, label = "Ver transacción",
}: { txHash: string | null | undefined; chainId: number | null | undefined; label?: string }) {
  if (!txHash) return null;
  const url = explorerTxUrl(chainId, txHash);
  if (!url) return <span className="num text-sm text-muted" title={txHash}>{shortHash(txHash)}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm">
      {label}
    </a>
  );
}
