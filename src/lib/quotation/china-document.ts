import { computeTotals } from "./calc";
import type { QuoteDocument, QuoteLine } from "./types";

/** A line as the China tab shows it: RMB/PCS = the China (inventory) price; totals typed over the customer's prices don't apply. */
export const chinaLine = (l: QuoteLine): QuoteLine => ({ ...l, unit_price: l.base_price, price_overridden: false, overrides: undefined });

/**
 * The quotation at the China price, as on the China tab: the first sheet's lines at the China
 * price, totalled in RMB with no discounts, charges, taxes or currency conversion.
 */
export function chinaDocument(doc: QuoteDocument): QuoteDocument {
  const header = { ...doc.header, sheet_names: ["China"], currency: doc.company.base_currency, exchange_rate: 1, adjustments: [] };
  const lines = doc.lines.filter((l) => (l.sheet ?? 0) === 0).map(chinaLine);
  return { ...doc, header, lines, totals: computeTotals(lines, header), china: true };
}
