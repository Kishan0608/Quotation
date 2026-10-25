import { z } from "zod";
import { parseNumber } from "./format";

/** Optional trimmed text: "" -> null. */
export const optText = (max: number) =>
  z.preprocess(
    (v) => (v == null ? null : String(v).trim() === "" ? null : String(v).trim()),
    z.string().max(max, `Must be ${max} characters or fewer`).nullable(),
  );

export const reqText = (max: number, label = "This field") =>
  z.preprocess(
    (v) => (v == null ? "" : String(v).trim()),
    z.string().min(1, `${label} is required`).max(max, `Must be ${max} characters or fewer`),
  );

/** Optional number accepting "1,234.5" strings: "" -> null. */
export const optNum = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : parseNumber(v) ?? Number.NaN),
    z.number({ error: "Enter a valid number" }).min(min, `Must be at least ${min}`).max(max, `Must be at most ${max}`).nullable(),
  );

export const reqNum = (min: number, max: number, fallback?: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? (fallback ?? Number.NaN) : parseNumber(v) ?? Number.NaN),
    z.number({ error: "Enter a valid number" }).min(min, `Must be at least ${min}`).max(max, `Must be at most ${max}`),
  );

export const optInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : parseNumber(v) ?? Number.NaN),
    z.number({ error: "Enter a whole number" }).int("Enter a whole number").min(min).max(max).nullable(),
  );

export const uuidSchema = z.uuid();

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const currencyCode = z.preprocess(
  (v) => String(v ?? "").trim().toUpperCase(),
  z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
);

/** Flattens zod issues into { field: message } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function firstError(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
