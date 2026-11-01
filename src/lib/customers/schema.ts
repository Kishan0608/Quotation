import { z } from "zod";
import { optText, reqText } from "../validation";

/** One saved customer: the details a quotation's Customer box is filled with. */
export const customerSchema = z.object({
  name: reqText(160, "Customer / company"),
  contact_person: optText(120),
  phone: optText(60),
  email: optText(160),
  address: optText(500),
  note: optText(500),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export const MAX_CUSTOMER_IMPORT_ROWS = 5000;

/** The same customer however the name is spaced or capitalised ("ROYAL  Tube" = "royal tube"). */
export const customerKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Customer fields as the quotation picker gets them. */
export type CustomerPick = { id: string; name: string; contact_person: string | null; phone: string | null; email: string | null; address: string | null };
