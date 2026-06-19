/**
 * Tiny text sanitizers used before Jake or Travis send anything to a
 * client. The em dash and en dash rule is in every prompt, but the
 * model still slips them in occasionally; this replaces them with
 * commas at the byte level so they never reach the outbound message.
 */

/**
 * Replace em dashes (—, U+2014) and en dashes (–, U+2013) with
 * commas, normalizing surrounding whitespace. Preserves single
 * hyphens (-) which are legitimate in compound words and URLs.
 */
export function stripDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/, ,/g, ",")
    .replace(/,\s*\./g, ".");
}
