import type { PricingBasis, QuotationStatus } from "../supabase/database.types";

export type QuoteHeader = {
  status: QuotationStatus;
  quote_date: string;
  valid_until: string;
  reference: string;
  customer_name: string;
  contact_person: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  currency: string;
  exchange_rate: number;
  margin_pct: number;
  pricing_basis: PricingBasis;
  rate_per_kg: number | null;
  /** Discounts, charges and taxes shown under the subtotal. */
  adjustments: Adjustment[];
  /** Sheet tabs of the quotation (Excel style); lines point to one by index. */
  sheet_names: string[];
  /** Extra columns typed after Final Total (L, M, N...), in order. */
  extra_columns: ExtraColumn[];
  /** Standard columns the user deleted (hidden) on this quotation. */
  hidden_columns: HideableColumn[];
  /** Standard column titles the user renamed on the sheet (missing = the normal title). */
  column_titles: Partial<Record<StandardColumn, string>>;
  notes: string;
  terms: string;
};

/** Standard sheet columns, in order. */
// Actual Weight and Note / Length come after Final Total (the user's layout, 2026-10-31).
export const STANDARD_COLUMNS = ["idx", "description", "unit_weight_kg", "unit_price", "qty", "total_weight", "amount", "net", "actual_weight", "remarks"] as const;
export type StandardColumn = (typeof STANDARD_COLUMNS)[number];

/** A change to the sheet's columns (extra columns, deleted columns, renamed titles). */
export type ColumnLayoutPatch = Partial<Pick<QuoteHeader, "extra_columns" | "hidden_columns" | "column_titles">>;

/** An extra column; `after` = the standard column it was inserted right after (none = at the end). */
export type ExtraColumn = { key: string; name: string; after?: StandardColumn };

/** Standard sheet columns that can be deleted (hidden) per quotation. No., Items and Final Total always stay. */
export const HIDEABLE_COLUMNS = ["unit_weight_kg", "actual_weight", "unit_price", "qty", "total_weight", "amount", "remarks"] as const;
export type HideableColumn = (typeof HIDEABLE_COLUMNS)[number];

export type AdjustmentKind = "discount" | "charge" | "tax";

export type Adjustment = {
  key: string;
  kind: AdjustmentKind;
  label: string;
  mode: "percent" | "amount";
  value: number;
};

export type AdjustmentLine = Adjustment & { amount: number };

/**
 * Values typed over a calculated cell, like typing over a formula in Excel: they replace the
 * calculation until the cell is cleared.
 */
export type LineOverrides = Partial<Record<"total_weight" | "amount" | "net", number>>;

export type QuoteLine = {
  key: string;
  /** Index into header.sheet_names. */
  sheet: number;
  inventory_item_id: string | null;
  item_code: string;
  description: string;
  unit: string;
  qty: number | null;
  unit_weight_kg: number | null;
  /** Inventory price per piece in the base currency (before margin / FX). */
  base_price: number | null;
  unit_price: number | null;
  price_overridden: boolean;
  /** Shown as "Note / Length" (copied from the inventory Note / Length; an import adds the customer's note). */
  remarks: string;
  /** As written by the supplier, e.g. "5.4-5.6MM". */
  actual_weight: string;
  /** Values of the extra columns, by column key. */
  extra: Record<string, string>;
  /** Cell formatting (Home ribbon), by column id ("qty", "x:<key>", ...). */
  fmt: Record<string, CellFmt>;
  /** Total KG / Total Amount / Final Total typed over their calculation (missing = calculated). */
  overrides?: LineOverrides;
  /**
   * Why this line needs a look, set by Import (e.g. "Not in your inventory"). The row shows red on
   * the sheet until it is edited or marked as checked; it is not saved with the quotation.
   */
  check?: string;
};

/** 1 = thin, 2 = thick. */
export type BorderEdge = 1 | 2;

/** Excel-style formatting of one cell. */
export type CellFmt = {
  font?: string;
  /** Points, like Excel (11 = normal). */
  size?: number;
  b?: boolean;
  i?: boolean;
  /** 1 = single, 2 = double underline. */
  u?: 1 | 2;
  color?: string;
  fill?: string;
  h?: "left" | "center" | "right";
  v?: "top" | "middle" | "bottom";
  wrap?: boolean;
  indent?: number;
  /** Degrees counter-clockwise (45, -45, 90, -90) or "v" = vertical (stacked) text. */
  rot?: 45 | -45 | 90 | -90 | "v";
  bt?: BorderEdge;
  br?: BorderEdge;
  bb?: BorderEdge;
  bl?: BorderEdge;
  /** Merged with the cells to its right, up to this column id. */
  merge?: string;
};

export type QuoteTotals = {
  totalQty: number;
  totalWeight: number;
  /** Sum of the RMB/PCS column (Excel's SUM of the price per piece). */
  totalPrice: number;
  /** Sum of Total Amount (qty x price). */
  grossAmount: number;
  /** Sum of the lines' Final Total (= Total Amount), in RMB. */
  baseSubtotal: number;
  /** RMB -> quotation currency (1 when the quotation is in RMB). */
  exchangeRate: number;
  /** baseSubtotal converted to the quotation currency; bill lines apply to this. */
  subtotal: number;
  discount: number;
  charges: number;
  taxable: number;
  tax: number;
  grandTotal: number;
  /** Bill lines in print order (discounts, charges, taxes) with their amounts. */
  adjustments: AdjustmentLine[];
};

export type CompanyInfo = {
  company_name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_id: string | null;
  base_currency: string;
  bank_details: string | null;
  footer_note: string | null;
  /** PNG data URL of the signature (Company settings), or null. */
  signature_image: string | null;
};

/** What the Excel / PDF exporters need. */
export type QuoteDocument = {
  quoteNo: string;
  preparedBy: string | null;
  header: QuoteHeader;
  lines: QuoteLine[];
  totals: QuoteTotals;
  company: CompanyInfo;
  /** The China price version (china-document.ts), titled as such in the files. */
  china?: boolean;
};
