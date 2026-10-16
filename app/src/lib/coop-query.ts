// The `?c=<id>` that public pages (ledger, monthly report, auditor's report) take to pick a
// cooperative. Pure, so client components can build links too. The demo (id 1) needs none.
export const DEMO_COOPERADORA_ID = 1;

/** `?c=<id>` (or `&c=<id>`) for a cooperative other than the demo, so demo links stay as they were. */
export function coopQuery(cooperadoraId?: number | null, sep: "?" | "&" = "?"): string {
  return cooperadoraId == null || cooperadoraId === DEMO_COOPERADORA_ID ? "" : `${sep}c=${cooperadoraId}`;
}

/** Reads `?c=` from a public page or route. Missing or malformed means the demo. */
export function parseCoopParam(raw: string | string[] | null | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : DEMO_COOPERADORA_ID;
}
