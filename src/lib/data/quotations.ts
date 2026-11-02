import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blankLine } from "@/components/quotation/line-utils";
import { MAX_COMMISSION } from "@/lib/quotation/calc";
import { STANDARD_COLUMNS, type QuoteHeader, type QuoteLine, type StandardColumn } from "@/lib/quotation/types";
import type { CompanySettingsRow, Database, QuotationItemRow, QuotationRow, QuotationStatus } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const STATUSES: QuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired"];

export type QuotationFilters = { q: string; status: QuotationStatus | ""; page: number; pageSize: number };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Rows per page on the Quotations list (the Pagination component's choices). */
const PAGE_SIZES = [25, 50, 100, 200];

export function parseQuotationFilters(params: Record<string, string | string[] | undefined>): QuotationFilters {
  const status = first(params.status) as QuotationStatus;
  const page = Number(first(params.page));
  const pageSize = Number(first(params.size));
  return {
    q: first(params.q).trim().slice(0, 100),
    status: STATUSES.includes(status) ? status : "",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 25,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listQuotations(supabase: Client, f: QuotationFilters) {
  const from = (f.page - 1) * f.pageSize;
  let query = supabase
    .from("quotations")
    .select("id, quote_no, status, quote_date, valid_until, customer_name, reference, currency, total_qty, total_weight_kg, grand_total, prepared_by, created_by, updated_at", {
      count: "exact",
    });
  for (const term of f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    query = query.ilike("search_text", `%${escapeLike(term)}%`);
  }
  if (f.status) query = query.eq("status", f.status);
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + f.pageSize - 1);
  return { rows: data ?? [], total: count ?? 0, error };
}

export type QuotationListRow = Awaited<ReturnType<typeof listQuotations>>["rows"][number];

type LoadedQuotation = {
  id: string;
  quoteNo: string;
  preparedBy: string | null;
  createdBy: string | null;
  header: QuoteHeader;
  lines: QuoteLine[];
};

function toHeader(q: QuotationRow): QuoteHeader {
  return {
    status: q.status,
    quote_date: q.quote_date,
    valid_until: q.valid_until ?? "",
    reference: q.reference ?? "",
    customer_name: q.customer_name,
    contact_person: q.contact_person ?? "",
    customer_email: q.customer_email ?? "",
    customer_phone: q.customer_phone ?? "",
    customer_address: q.customer_address ?? "",
    currency: q.currency,
    exchange_rate: Number(q.exchange_rate),
    margin_pct: Math.min(Math.max(Number(q.margin_pct) || 0, 0), MAX_COMMISSION),
    pricing_basis: q.pricing_basis,
    rate_per_kg: q.rate_per_kg == null ? null : Number(q.rate_per_kg),
    adjustments: (Array.isArray(q.adjustments) ? q.adjustments : []).map((a, i) => ({
      key: `a${i}`,
      kind: a.kind,
      label: a.label,
      mode: a.mode,
      value: Number(a.value),
    })),
    sheet_names: Array.isArray(q.sheet_names) && q.sheet_names.length ? q.sheet_names.map(String) : ["Quotation"],
    extra_columns: Array.isArray(q.extra_columns)
      ? q.extra_columns.map((c) => ({ key: String(c.key), name: String(c.name ?? ""), ...(c.after && STANDARD_COLUMNS.includes(c.after) ? { after: c.after } : {}) }))
      : [],
    hidden_columns: Array.isArray(q.hidden_columns) ? q.hidden_columns : [],
    column_titles:
      q.column_titles && typeof q.column_titles === "object"
        ? Object.fromEntries(Object.entries(q.column_titles).filter(([k, v]) => STANDARD_COLUMNS.includes(k as StandardColumn) && typeof v === "string"))
        : {},
    notes: q.notes ?? "",
    terms: q.terms ?? "",
  };
}

function toLine(i: QuotationItemRow): QuoteLine {
  return {
    key: i.id,
    sheet: Number(i.sheet ?? 0),
    inventory_item_id: i.inventory_item_id,
    item_code: i.item_code ?? "",
    description: i.description,
    unit: i.unit,
    qty: Number(i.qty),
    unit_weight_kg: i.unit_weight_kg == null ? null : Number(i.unit_weight_kg),
    base_price: i.base_price == null ? null : Number(i.base_price),
    unit_price: Number(i.unit_price),
    price_overridden: i.price_overridden,
    remarks: i.remarks ?? "",
    actual_weight: i.actual_weight ?? "",
    extra: i.extra && typeof i.extra === "object" ? i.extra : {},
    fmt: i.fmt && typeof i.fmt === "object" ? i.fmt : {},
    overrides: i.overrides && typeof i.overrides === "object" ? i.overrides : {},
  };
}

/**
 * The saved lines with the empty rows between them put back, so every line opens in the row it
 * was typed in (lines saved before rows were kept simply follow each other).
 */
function withEmptyRows(items: QuotationItemRow[]): QuoteLine[] {
  const out: QuoteLine[] = [];
  const sheets = [...new Set(items.map((i) => Number(i.sheet ?? 0)))].sort((a, b) => a - b);
  for (const sheet of sheets) {
    const rows: QuoteLine[] = [];
    for (const item of items.filter((i) => Number(i.sheet ?? 0) === sheet)) {
      const at = item.row_index;
      if (at != null && at >= rows.length && at < 10_000) while (rows.length < at) rows.push(blankLine(sheet));
      rows.push(toLine(item));
    }
    out.push(...rows);
  }
  return out;
}

export async function getQuotation(supabase: Client, id: string): Promise<LoadedQuotation | null> {
  const [{ data: q }, { data: items }] = await Promise.all([
    supabase.from("quotations").select("*").eq("id", id).maybeSingle(),
    supabase.from("quotation_items").select("*").eq("quotation_id", id).order("position"),
  ]);
  if (!q) return null;
  return {
    id: q.id,
    quoteNo: q.quote_no,
    preparedBy: q.prepared_by,
    createdBy: q.created_by,
    header: toHeader(q),
    lines: withEmptyRows(items ?? []),
  };
}

export async function getCompanySettings(supabase: Client): Promise<CompanySettingsRow | null> {
  const { data } = await supabase.from("company_settings").select("*").maybeSingle();
  return data;
}
