import type { QuotationStatus } from "@/lib/supabase/database.types";

export const STATUS_META: Record<QuotationStatus, { label: string; tone: "slate" | "sky" | "green" | "red" | "amber" }> = {
  draft: { label: "Draft", tone: "slate" },
  sent: { label: "Sent", tone: "sky" },
  accepted: { label: "Accepted", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  expired: { label: "Expired", tone: "amber" },
};
