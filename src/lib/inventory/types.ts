/** Inventory fields returned to the quotation item picker. */
export type PickerItem = {
  id: string;
  item_code: string | null;
  description: string;
  weight_kg: number | null;
  unit_price: number | null;
  stock_qty: number;
  note: string | null;
  actual_weight: string | null;
};
