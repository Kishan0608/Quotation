import type { PickerItem } from "@/lib/inventory/types";
import { autoUnitPrice } from "@/lib/quotation/calc";
import type { QuoteHeader, QuoteLine } from "@/lib/quotation/types";

let counter = 0;
export const newKey = () => `l${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function blankLine(sheet = 0): QuoteLine {
  return {
    key: newKey(),
    sheet,
    inventory_item_id: null,
    item_code: "",
    description: "",
    unit: "PCS",
    qty: null,
    unit_weight_kg: null,
    base_price: null,
    unit_price: null,
    price_overridden: false,
    remarks: "",
    actual_weight: "",
    loading_charges: null,
    extra: {},
    fmt: {},
  };
}

/** A quotation line copied from an inventory item and priced automatically. */
export function lineFromItem(item: PickerItem, qty: number, header: QuoteHeader, sheet = 0): QuoteLine {
  const line: QuoteLine = {
    key: newKey(),
    sheet,
    inventory_item_id: item.id,
    item_code: item.item_code ?? "",
    description: item.description,
    unit: "PCS",
    qty,
    unit_weight_kg: item.weight_kg == null ? null : Number(item.weight_kg),
    base_price: item.unit_price == null ? null : Number(item.unit_price),
    unit_price: null,
    price_overridden: false,
    // Length and actual weight come from inventory; loading charges are entered per quotation.
    remarks: item.note ?? "",
    actual_weight: item.actual_weight ?? "",
    loading_charges: null,
    extra: {},
    fmt: {},
  };
  line.unit_price = autoUnitPrice(line, header) ?? 0;
  return line;
}
