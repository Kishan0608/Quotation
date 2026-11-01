import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { parseInventoryWorkbook } from "../inventory/excel-import";
import { buildNewItemsWorkbook, mergeNewItems } from "./export-new-items";

describe("new items for the supplier", () => {
  it("one row per item (name ignoring spaces, and length), quantities added", () => {
    const items = mergeNewItems([
      { description: '8"XSCH80 TEE', qty: 10, length: "" },
      { description: '8" XSCH80 TEE', qty: 4, length: "" },
      { description: '8"XSCH80 TEE', qty: 2, length: "B CLASS" },
      { description: "  ", qty: 1, length: "" },
    ]);
    assert.deepEqual(items, [
      { description: '8"XSCH80 TEE', qty: 14, length: "" },
      { description: '8"XSCH80 TEE', qty: 2, length: "B CLASS" },
    ]);
  });

  it("the filled-in file imports back into Inventory with the supplier's prices", async () => {
    const buffer = await buildNewItemsWorkbook([{ description: "610X8MM", qty: 3, length: "1750MM" }], "NEW ITEMS");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    // The supplier fills the yellow columns.
    const row = wb.worksheets[0].getRow(3);
    row.getCell(2).value = 120;
    row.getCell(3).value = 512.5;
    row.getCell(5).value = "7.8-8.0MM";
    const result = parseInventoryWorkbook(wb);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].data, { description: "610X8MM", weight_kg: 120, unit_price: 512.5, stock_qty: 3, actual_weight: "7.8-8.0MM", note: "1750MM" });
  });
});
