/** Spent vs allocated. Over 100% turns red. */
export function ProgressBar({ spent, allocated, label }: { spent: string; allocated: string; label: string }) {
  const a = BigInt(allocated);
  const sp = BigInt(spent);
  const pct = a > BigInt(0) ? Number((sp * BigInt(1000)) / a) / 10 : sp > BigInt(0) ? 100 : 0;
  const over = sp > a;
  return (
    <div
      role="img"
      aria-label={`${label}: ${Math.round(pct)}% gastado`}
      className="h-3 w-full overflow-hidden rounded-full bg-line"
    >
      <div className={`h-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}
