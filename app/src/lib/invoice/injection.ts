const PATTERNS: RegExp[] = [
  /\bpag(ar|á|a|ue|uen)\s+(a|al|en)\b/i,
  /\btransfer(ir|í|i|ime|ile)\s+(a|al|en)\b/i,
  /\bignor(a|á|ar|e|en)/i,
  /\bolvid(a|á|ar|e).*\b(instrucci|anterior)/i,
  /\b(nueva|otra|diferente)\s+(cuenta|cbu|alias|billetera|wallet)\b/i,
  /\b(cuenta|cbu|alias|billetera|wallet)\s+(nueva|alternativa)\b/i,
  /\bcbu\b/i,
  /\balias\b\s*[:=]/i,
  /\b\d{22}\b/,
  /\b0x[0-9a-fA-F]{40}\b/,
  /\b(ignore|disregard)\b.*\b(instructions?|previous|above)\b/i,
  /\b(system prompt|assistant|developer message)\b/i,
  /\b(send|transfer|pay)\s+(funds?\s+)?to\b/i,
];

/** True when text tries to give orders (pay to, new account, CBU, 0x address...). */
export function looksLikeInjection(text: string): boolean {
  const t = text.normalize("NFKC");
  return PATTERNS.some((p) => p.test(t));
}
