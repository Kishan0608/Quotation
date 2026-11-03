import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "@/lib/format";
import { MAX_COMMISSION, MIN_COMMISSION } from "@/lib/quotation/calc";
import type { CompanyInfo, QuoteHeader } from "@/lib/quotation/types";
import type { CompanySettingsRow, Database } from "@/lib/supabase/database.types";
import { getCompanySettings } from "./quotations";

const FALLBACK_COMPANY: CompanySettingsRow = {
  id: true,
  company_name: "Your Company Name",
  tagline: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  tax_id: null,
  base_currency: "CNY",
  default_currency: "CNY",
  default_exchange_rate: 1,
  default_margin_pct: 0,
  default_tax_label: "Tax",
  default_tax_pct: 0,
  default_validity_days: 30,
  quote_prefix: "QT",
  default_terms: null,
  bank_details: null,
  footer_note: null,
  signature_image: null,
  updated_at: "",
};

/** Everything the quotation builder needs besides the quotation itself. */
export async function loadBuilderContext(supabase: SupabaseClient<Database>) {
  const settings = await getCompanySettings(supabase);
  const s = settings ?? FALLBACK_COMPANY;
  const company: CompanyInfo = {
    company_name: s.company_name,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    email: s.email,
    website: s.website,
    tax_id: s.tax_id,
    base_currency: s.base_currency,
    bank_details: s.bank_details,
    footer_note: s.footer_note,
    // Missing until the signature column is added to the database.
    signature_image: s.signature_image ?? null,
  };
  return { settings: s, company };
}

export function defaultHeader(s: CompanySettingsRow): QuoteHeader {
  const today = todayISO();
  return {
    status: "draft",
    quote_date: today,
    valid_until: "",
    reference: "",
    customer_name: "",
    contact_person: "",
    customer_email: "",
    customer_phone: "",
    customer_address: "",
    // In RMB until a conversion is added on the Totals card (RMB -> INR / USD).
    currency: s.base_currency,
    exchange_rate: 1,
    // The commission % (customer price = China price x (1 + commission)).
    margin_pct: Math.min(Math.max(Number(s.default_margin_pct) || 0, MIN_COMMISSION), MAX_COMMISSION),
    pricing_basis: "piece",
    rate_per_kg: null,
    // The company's default tax (Company settings) is added as the first bill line.
    adjustments:
      Number(s.default_tax_pct) > 0
        ? [{ key: "tax0", kind: "tax", label: s.default_tax_label || "Tax", mode: "percent", value: Number(s.default_tax_pct) }]
        : [],
    sheet_names: ["Quotation"],
    extra_columns: [],
    hidden_columns: [],
    column_titles: {},
    notes: "",
    terms: s.default_terms ?? "",
  };
}
