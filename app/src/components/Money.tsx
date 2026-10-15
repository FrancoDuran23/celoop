import { formatPesos } from "@/lib/report/format";

/** An amount in pesos (es-AR), from wARS base units. */
export function Money({
  value, className = "", negative,
}: { value: string | bigint; className?: string; negative?: boolean }) {
  return <span className={`num whitespace-nowrap ${negative ? "text-danger" : ""} ${className}`}>{formatPesos(value)}</span>;
}
