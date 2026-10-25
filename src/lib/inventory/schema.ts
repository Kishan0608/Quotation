import { z } from "zod";
import { optNum, optText, reqNum, reqText } from "../validation";

/** One inventory item: the columns of the supplier Excel. */
export const inventoryItemSchema = z.object({
  item_code: optText(40),
  description: reqText(200, "Items"),
  weight_kg: optNum(0, 100_000_000),
  unit_price: optNum(0, 100_000_000_000),
  stock_qty: reqNum(0, 100_000_000_000, 0),
  loading_charges: reqNum(0, 100_000_000_000, 0),
  actual_weight: optText(100),
  note: optText(300),
});

export type InventoryInput = z.infer<typeof inventoryItemSchema>;

/** Cells that can be edited straight from the inventory table. */
export const inlineUpdateSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("weight_kg"), value: optNum(0, 100_000_000) }),
  z.object({ field: z.literal("unit_price"), value: optNum(0, 100_000_000_000) }),
  z.object({ field: z.literal("stock_qty"), value: reqNum(0, 100_000_000_000, 0) }),
  z.object({ field: z.literal("loading_charges"), value: reqNum(0, 100_000_000_000, 0) }),
  z.object({ field: z.literal("actual_weight"), value: optText(100) }),
  z.object({ field: z.literal("note"), value: optText(300) }),
]);

export type InlineField = z.infer<typeof inlineUpdateSchema>["field"];

export const MAX_IMPORT_ROWS = 2000;
