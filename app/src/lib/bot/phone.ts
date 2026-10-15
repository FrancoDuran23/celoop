// Phone matching between Telegram's contact and the padrón (E.164, e.g. +5493884000000).

/**
 * Candidate E.164 forms for a phone shared by Telegram ("5493884000000", "+54 9 388 ...").
 * Argentine mobiles are written with or without the 9 after 54, so both forms are tried.
 */
export function phoneCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return [];
  const out = new Set([`+${digits}`]);
  if (digits.startsWith("549")) out.add(`+54${digits.slice(3)}`);
  else if (digits.startsWith("54")) out.add(`+549${digits.slice(2)}`);
  return [...out];
}
