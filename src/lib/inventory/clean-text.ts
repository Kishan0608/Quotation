/** Translates the Chinese shorthand found in supplier sheets. */
export function cleanSupplierText(text: string): string {
  return text
    .replace(/标准/g, "Standard")
    .replace(/中心距\s*/g, "C-C ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Supplier notes, translated. TEE / CAP only repeat what the Items text already
 * says, so they are dropped; CONCENTRIC / ECCENTRIC tell two reducers apart and are kept.
 */
export function cleanNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const cleaned = cleanSupplierText(String(note));
  if (/^(TEE|CAP)$/i.test(cleaned)) return null;
  return cleaned || null;
}

/** "5.0-5.2MM   4.5-5.0MM" (tee run and branch) -> "5.0-5.2MM / 4.5-5.0MM". */
export function cleanActualWeight(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = String(value).trim().split(/\s{2,}|\s*\/\s*/).filter(Boolean);
  return parts.length ? parts.join(" / ") : null;
}
