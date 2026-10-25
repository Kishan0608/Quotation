// Hand-maintained to match supabase/migrations. If you change the schema you
// can regenerate with: npx supabase gen types typescript --project-id <id>

export type AppRole = "admin" | "editor" | "viewer";
export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type PricingBasis = "piece" | "kg";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CompanySettingsRow = {
  id: boolean;
  company_name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_id: string | null;
  base_currency: string;
  default_currency: string;
  default_exchange_rate: number;
  default_margin_pct: number;
  default_tax_label: string;
  default_tax_pct: number;
  default_validity_days: number;
  quote_prefix: string;
  default_terms: string | null;
  bank_details: string | null;
  footer_note: string | null;
  updated_at: string;
};

type ScheduleColumns = {
  sch_5s: number | null;
  sch_10s: number | null;
  sch_10: number | null;
  sch_20: number | null;
  sch_30: number | null;
  sch_40s: number | null;
  sch_std: number | null;
  sch_40: number | null;
  sch_60: number | null;
  sch_80s: number | null;
  sch_xs: number | null;
  sch_80: number | null;
  sch_100: number | null;
  sch_120: number | null;
  sch_140: number | null;
  sch_160: number | null;
  sch_xxs: number | null;
};

export type PipeSizeRow = {
  id: number;
  nps: string;
  nps_value: number;
  dn: number | null;
  od_mm: number;
  created_at: string;
  updated_at: string;
} & ScheduleColumns;

export type InventoryItemRow = {
  id: string;
  item_code: string | null;
  description: string;
  weight_kg: number | null;
  unit_price: number | null;
  stock_qty: number;
  /** CNY for the whole row (not per piece). */
  loading_charges: number;
  /** As written by the supplier, e.g. "5.5-5.6MM". */
  actual_weight: string | null;
  note: string | null;
  total_weight_kg: number;
  total_amount: number;
  created_at: string;
  updated_at: string;
};

export type InventoryItemInsert = Omit<InventoryItemRow, "id" | "total_weight_kg" | "total_amount" | "created_at" | "updated_at"> & {
  /** Set by the server for bulk imports so rows keep their order. */
  created_at?: string;
};

export type QuotationRow = {
  id: string;
  quote_no: string;
  status: QuotationStatus;
  quote_date: string;
  valid_until: string | null;
  reference: string | null;
  customer_name: string;
  contact_person: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  currency: string;
  exchange_rate: number;
  margin_pct: number;
  pricing_basis: PricingBasis;
  rate_per_kg: number | null;
  discount_pct: number;
  freight: number;
  other_charges: number;
  tax_label: string;
  tax_pct: number;
  adjustments: { kind: "discount" | "charge" | "tax"; label: string; mode: "percent" | "amount"; value: number }[];
  charges_amount: number;
  notes: string | null;
  terms: string | null;
  total_qty: number;
  total_weight_kg: number;
  /** Final total of the lines in the base currency (RMB), before conversion. */
  base_subtotal: number;
  /** Sheet tabs, e.g. ["Quotation", "Sheet 2"]. */
  sheet_names: string[];
  extra_columns: import("../quotation/types").ExtraColumn[];
  hidden_columns: import("../quotation/types").HideableColumn[];
  column_titles: Partial<Record<import("../quotation/types").StandardColumn, string>>;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  grand_total: number;
  prepared_by: string | null;
  search_text: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QuotationItemRow = {
  id: string;
  quotation_id: string;
  position: number;
  inventory_item_id: string | null;
  item_code: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_weight_kg: number | null;
  base_price: number | null;
  unit_price: number;
  price_overridden: boolean;
  remarks: string | null;
  /** Index into quotations.sheet_names. */
  sheet: number;
  /** Values of the quotation's extra columns, by column key. */
  extra: Record<string, string>;
  /** Cell formatting, by column id. */
  fmt: Record<string, import("../quotation/types").CellFmt>;
  actual_weight: string | null;
  loading_charges: number;
  total_weight_kg: number;
  amount: number;
  /** amount + loading_charges (generated). */
  net_amount: number;
};

export type DashboardSummary = {
  inventory: {
    items: number;
    total_qty: number;
    total_weight_kg: number;
    total_value: number;
    low_stock: number;
  };
  quotations: { total: number; draft: number; sent: number; accepted: number; this_month: number };
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Partial<ProfileRow> & { id: string }>;
      company_settings: Table<CompanySettingsRow, Partial<CompanySettingsRow>>;
      pipe_sizes: Table<
        PipeSizeRow,
        Omit<PipeSizeRow, "id" | "created_at" | "updated_at"> & { id?: number }
      >;
      inventory_items: Table<InventoryItemRow, InventoryItemInsert>;
      quotations: Table<QuotationRow, Partial<QuotationRow> & { customer_name: string }>;
      quotation_items: Table<
        QuotationItemRow,
        Omit<QuotationItemRow, "id" | "total_weight_kg" | "amount" | "net_amount">
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      save_quotation: {
        Args: { p_id: string | null; p_header: Record<string, unknown>; p_items: Record<string, unknown>[] };
        Returns: { id: string; quote_no: string };
      };
      dashboard_summary: { Args: Record<string, never>; Returns: DashboardSummary };
      current_app_role: { Args: Record<string, never>; Returns: AppRole | null };
    };
    Enums: {
      app_role: AppRole;
      quotation_status: QuotationStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
