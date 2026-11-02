const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Decimal-safe rounding (avoids 1.005 -> 1.00). */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(`${Math.round(Number(`${value}e${decimals}`))}e-${decimals}`);
}
export const round2 = (v: number) => roundTo(v, 2);
export const round3 = (v: number) => roundTo(v, 3);

const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number) {
  const k = `${min}:${max}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(k, f);
  }
  return f;
}

export function fmtNumber(value: number | null | undefined, min = 0, max = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return nf(min, max).format(Number(value));
}
export const fmtMoney = (v: number | null | undefined) => fmtNumber(v, 2, 2);
export const fmtQty = (v: number | null | undefined) => fmtNumber(v, 0, 2);
export const fmtWeight = (v: number | null | undefined) => fmtNumber(v, 0, 3);

/** "2026-10-19" -> "19 Oct 2026" without timezone shifts. */
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${fmtDate(toISODate(date))}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayISO() {
  return toISODate(new Date());
}

/** Lenient number parsing for form and grid input: "1,250.5" -> 1250.5, "" -> null. */
export function parseNumber(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const s = String(input).replace(/,/g, "").replace(/\s+/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
