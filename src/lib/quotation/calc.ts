import { round2, round3, roundTo } from "../format";
import type { Adjustment, AdjustmentKind, QuoteHeader, QuoteLine, QuoteTotals } from "./types";

type PricingInputs = Pick<QuoteHeader, "pricing_basis" | "rate_per_kg" | "margin_pct">;

/** "RMB" for CNY (as written on the supplier sheets), otherwise the ISO code. */
export const currencyLabel = (code: string) => (code === "CNY" ? "RMB" : code);

/** The highest commission % a quotation takes. */
export const MAX_COMMISSION = 500;

/**
 * Automatic customer price for one line, in RMB (the company base currency):
 *   base  = China (inventory) price per piece      (pricing basis "piece")
 *         = unit weight (kg) x rate per kg         (pricing basis "kg")
 *   price = base x (1 + commission %), rounded to 2 decimals: the commission is added on top
 *           of the China price (5.70 with 10% -> 6.27). header.margin_pct holds the commission.
 * Lines stay in RMB; the total is converted to the quotation currency at the end.
 */
export function autoUnitPrice(line: Pick<QuoteLine, "base_price" | "unit_weight_kg">, pricing: PricingInputs) {
  let base: number | null = null;
  if (pricing.pricing_basis === "kg") {
    if (line.unit_weight_kg != null && pricing.rate_per_kg != null) base = line.unit_weight_kg * pricing.rate_per_kg;
  } else {
    base = line.base_price;
  }
  if (base == null) return null;
  const commission = Math.min(Math.max(pricing.margin_pct || 0, 0), MAX_COMMISSION) / 100;
  return round2(base * (1 + commission));
}

/**
 * The commission typed as a multiplier: China price x 1.25 is the same as + 25% (header.margin_pct
 * keeps the %, to 2 decimals as the database does, so a multiplier keeps 4).
 */
export const commissionOfMultiplier = (multiplier: number) => roundTo((multiplier - 1) * 100, 2);
export const multiplierOf = (commission: number) => roundTo(1 + commission / 100, 4);

/** Re-prices every line that the user has not overridden by hand. */
export function repriceLines(lines: QuoteLine[], pricing: PricingInputs, force = false): QuoteLine[] {
  return lines.map((line) => {
    if (line.price_overridden && !force) return line;
    const price = autoUnitPrice(line, pricing);
    if (price == null && !force) return line;
    return { ...line, unit_price: price ?? line.unit_price, price_overridden: false };
  });
}

/** The calculations; a value typed over the cell (line.overrides) replaces them. */
export const calcAmount = (line: Pick<QuoteLine, "qty" | "unit_price">) => round2((line.qty ?? 0) * (line.unit_price ?? 0));
export const calcWeight = (line: Pick<QuoteLine, "qty" | "unit_weight_kg">) => round3((line.qty ?? 0) * (line.unit_weight_kg ?? 0));

export const lineAmount = (line: Pick<QuoteLine, "qty" | "unit_price" | "overrides">) => line.overrides?.amount ?? calcAmount(line);
/** Final Total of a line = its Total Amount, unless a Final Total was typed. */
export const lineNet = (line: Pick<QuoteLine, "qty" | "unit_price" | "overrides">) => line.overrides?.net ?? lineAmount(line);
export const lineWeight = (line: Pick<QuoteLine, "qty" | "unit_weight_kg" | "overrides">) => line.overrides?.total_weight ?? calcWeight(line);

/** Same arithmetic and rounding as public.save_quotation() in the database. */
const KIND_ORDER: Record<AdjustmentKind, number> = { discount: 0, charge: 1, tax: 2 };

/**
 * Same arithmetic and rounding as public.save_quotation() in the database:
 * Final Total of every line (RMB) -> x exchange rate = subtotal in the quotation currency
 * -> discounts and charges (% of subtotal) -> taxes (% of the taxable amount).
 */
export function computeTotals(lines: QuoteLine[], header: Pick<QuoteHeader, "adjustments" | "exchange_rate">): QuoteTotals {
  let totalQty = 0;
  let totalWeight = 0;
  let totalPrice = 0;
  let grossAmount = 0;
  let subtotal = 0;
  for (const line of lines) {
    totalQty += line.qty ?? 0;
    totalWeight += lineWeight(line);
    totalPrice += line.unit_price ?? 0;
    grossAmount += lineAmount(line);
    subtotal += lineNet(line);
  }
  grossAmount = round2(grossAmount);
  const baseSubtotal = round2(subtotal);
  const exchangeRate = header.exchange_rate > 0 ? header.exchange_rate : 1;
  subtotal = round2(baseSubtotal * exchangeRate);

  const ordered = [...header.adjustments].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const amountOf = (a: Adjustment, base: number) => (a.mode === "percent" ? round2((base * a.value) / 100) : round2(a.value));
  const sumOf = (kind: AdjustmentKind, base: number) =>
    round2(ordered.filter((a) => a.kind === kind).reduce((s, a) => s + amountOf(a, base), 0));

  const discount = sumOf("discount", subtotal);
  const charges = sumOf("charge", subtotal);
  const taxable = round2(subtotal - discount + charges);
  const tax = sumOf("tax", taxable);

  return {
    totalQty: round2(totalQty),
    totalWeight: round3(totalWeight),
    totalPrice: round2(totalPrice),
    grossAmount,
    baseSubtotal,
    exchangeRate,
    subtotal,
    discount,
    charges,
    taxable,
    tax,
    grandTotal: round2(taxable + tax),
    adjustments: ordered.map((a) => ({ ...a, amount: amountOf(a, a.kind === "tax" ? taxable : subtotal) })),
  };
}

/** "GST (18%)", "Freight", "Discount (5%)". */
export function adjustmentTitle(a: Pick<Adjustment, "label" | "mode" | "value">) {
  return a.mode === "percent" ? `${a.label} (${a.value}%)` : a.label;
}

export function isBlankLine(line: QuoteLine) {
  return (
    !line.description.trim() &&
    !line.item_code.trim() &&
    !line.qty &&
    !line.unit_price &&
    !line.remarks.trim() &&
    !line.actual_weight.trim() &&
    !Object.keys(line.overrides ?? {}).length &&
    !Object.values(line.extra ?? {}).some((v) => v.trim())
  );
}
