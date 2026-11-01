/** Helpers for PostgREST `ilike` filters built from user input. */

/** Escapes the LIKE wildcards (% and _) and the backslash, so they match literally. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Wraps a value in PostgREST double quotes so commas, brackets and quotes in user input stay literal. */
export const quoteValue = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
