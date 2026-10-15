import { formatPesos } from "@/lib/report/format";

/** An amount in Argentine pesos ("$ 12.500,00"), from wARS base units. */
export function Money({
  value, className = "", negative,
}: { value: string | bigint; className?: string; negative?: boolean }) {
  return <span className={`num whitespace-nowrap ${negative ? "text-red-ink" : ""} ${className}`}>{formatPesos(value)}</span>;
}
