import { z } from "zod";
import { FONTS } from "./cell-format";
import { HIDEABLE_COLUMNS, STANDARD_COLUMNS } from "./types";
import { currencyCode, isoDate, optNum, optText, reqNum, reqText } from "../validation";

export const MAX_QUOTE_LINES = 500;
export const MAX_ADJUSTMENTS = 20;
export const MAX_SHEETS = 20;
export const MAX_EXTRA_COLUMNS = 15;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const borderEdge = z.union([z.literal(1), z.literal(2)]).optional();
const cellFmtSchema = z
  .object({
    font: z.enum(FONTS).optional(),
    size: z.number().int().min(6).max(72).optional(),
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    u: z.union([z.literal(1), z.literal(2)]).optional(),
    color: hexColor.optional(),
    fill: hexColor.optional(),
    h: z.enum(["left", "center", "right"]).optional(),
    v: z.enum(["top", "middle", "bottom"]).optional(),
    wrap: z.boolean().optional(),
    indent: z.number().int().min(0).max(15).optional(),
    rot: z.union([z.literal(45), z.literal(-45), z.literal(90), z.literal(-90), z.literal("v")]).optional(),
    bt: borderEdge,
    br: borderEdge,
    bb: borderEdge,
    bl: borderEdge,
    merge: z.string().regex(/^(x:[a-z0-9]{1,24}|[a-z_]{2,20})$/i).optional(),
  })
  .strict();
/** Excel's own limits for a sheet name: 1-31 characters, none of : \ / ? * [ ] */
export const sheetNameSchema = z.preprocess(
  (v) => String(v ?? "").trim(),
  z.string().min(1, "Sheet name is required").max(31, "Sheet name can be at most 31 characters").regex(/^[^:\\/?*[\]]+$/, "Sheet name cannot contain : \\ / ? * [ ]"),
);

/** One discount / charge / tax line. Percentages are capped at 100. */
export const adjustmentSchema = z
  .object({
    kind: z.enum(["discount", "charge", "tax"]),
    label: z.preprocess((v) => String(v ?? "").trim(), z.string().max(40, "Name must be 40 characters or fewer")),
    mode: z.enum(["percent", "amount"]),
    value: reqNum(0, 100_000_000_000),
  })
  .refine((a) => a.mode !== "percent" || a.value <= 100, { message: "Percentage cannot be more than 100", path: ["value"] });

export const quoteHeaderSchema = z
  .object({
    status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
    quote_date: isoDate,
    valid_until: z.preprocess((v) => (v === "" ? null : v), isoDate.nullable()),
    reference: optText(120),
    customer_name: reqText(160, "Customer name"),
    contact_person: optText(120),
    customer_email: z.preprocess(
      (v) => (v == null || String(v).trim() === "" ? null : String(v).trim()),
      z.email("Enter a valid email").max(160).nullable(),
    ),
    customer_phone: optText(60),
    customer_address: optText(500),
    currency: currencyCode,
    exchange_rate: reqNum(0.000001, 1_000_000),
    margin_pct: reqNum(-100, 1000, 0),
    pricing_basis: z.enum(["piece", "kg"]),
    rate_per_kg: optNum(0, 10_000_000),
    adjustments: z.array(adjustmentSchema).max(MAX_ADJUSTMENTS, `At most ${MAX_ADJUSTMENTS} bill lines`),
    sheet_names: z.array(sheetNameSchema).min(1).max(MAX_SHEETS, `At most ${MAX_SHEETS} sheets`),
    extra_columns: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9]{1,24}$/i),
          name: z.preprocess((v) => String(v ?? "").trim(), z.string().max(40, "Column title can be at most 40 characters")),
          after: z.enum(STANDARD_COLUMNS).optional(),
        }),
      )
      .max(MAX_EXTRA_COLUMNS, `At most ${MAX_EXTRA_COLUMNS} extra columns`),
    hidden_columns: z.array(z.enum(HIDEABLE_COLUMNS)).max(HIDEABLE_COLUMNS.length),
    column_titles: z.partialRecord(z.enum(STANDARD_COLUMNS), z.string().trim().max(40, "Column title can be at most 40 characters")),
    notes: optText(2000),
    terms: optText(4000),
  })
  .refine((h) => !h.valid_until || h.valid_until >= h.quote_date, {
    message: "Valid-until date cannot be before the quotation date",
    path: ["valid_until"],
  })
  .refine((h) => h.pricing_basis !== "kg" || h.rate_per_kg != null, {
    message: "Enter a rate per kg for weight-based pricing",
    path: ["rate_per_kg"],
  });

export const quoteLineSchema = z.object({
  sheet: z.number().int().min(0).max(MAX_SHEETS - 1),
  /** Row on its sheet, empty rows included (lines open again in the same rows). */
  row: z.number().int().min(0).max(9999).optional(),
  inventory_item_id: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
  item_code: optText(40),
  description: reqText(300, "Description"),
  unit: z.preprocess((v) => String(v ?? "").trim().toUpperCase() || "PCS", z.string().max(12)),
  qty: reqNum(0, 100_000_000_000, 0),
  unit_weight_kg: optNum(0, 100_000_000),
  base_price: optNum(0, 100_000_000_000),
  unit_price: reqNum(0, 100_000_000_000, 0),
  price_overridden: z.boolean(),
  remarks: optText(300),
  actual_weight: optText(100),
  extra: z.record(z.string().regex(/^[a-z0-9]{1,24}$/i), z.string().max(300, "A cell can hold at most 300 characters")),
  fmt: z
    .record(z.string().regex(/^(x:[a-z0-9]{1,24}|[a-z_]{2,20})$/i), cellFmtSchema)
    .refine((o) => Object.keys(o).length <= 40, "Too many formatted cells in one row"),
});

export const saveQuotationSchema = z
  .object({
    id: z.uuid().nullable(),
    header: quoteHeaderSchema,
    lines: z.array(quoteLineSchema).min(1, "Add at least one item").max(MAX_QUOTE_LINES),
  })
  .refine((q) => q.lines.every((l) => l.sheet < q.header.sheet_names.length), { message: "A line points to a sheet that does not exist", path: ["lines"] })
  .refine((q) => new Set(q.header.sheet_names.map((n) => n.toLowerCase())).size === q.header.sheet_names.length, {
    message: "Two sheets have the same name",
    path: ["header", "sheet_names"],
  });

export type SaveQuotationInput = z.infer<typeof saveQuotationSchema>;
