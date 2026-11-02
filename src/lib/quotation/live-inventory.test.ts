import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankLine } from "@/components/quotation/line-utils";
import type { PickerItem } from "../inventory/types";
import { applyInventoryChanges } from "./live-inventory";
import type { QuoteLine } from "./types";

const pricing = { pricing_basis: "piece" as const, rate_per_kg: null, margin_pct: 20 };
const item = (id: string, description: string, unit_price: number, note: string | null = null): PickerItem => ({ id, description, weight_kg: 1.5, unit_price, stock_qty: 0, note, actual_weight: "3.3-3.5MM" });
const line = (over: Partial<QuoteLine>): QuoteLine => ({ ...blankLine(0), qty: 10, ...over });

describe("inventory changes reach an open quotation", () => {
  it("a line of a changed item takes the new China price; the customer price follows the commission", () => {
    const r = applyInventoryChanges([line({ inventory_item_id: "a", description: "114X3.5MM", base_price: 6.7, unit_price: 8.38 })], [item("a", "114X3.5MM", 8)], pricing);
    assert.equal(r.updated, 1);
    assert.equal(r.lines[0].base_price, 8);
    assert.equal(r.lines[0].unit_price, 9.6);
  });

  it("a price typed by hand stays", () => {
    const r = applyInventoryChanges([line({ inventory_item_id: "a", description: "114X3.5MM", base_price: 6.7, unit_price: 9, price_overridden: true })], [item("a", "114X3.5MM", 8)], pricing);
    assert.equal(r.lines[0].base_price, 8);
    assert.equal(r.lines[0].unit_price, 9);
  });

  it("a new line whose item is now in inventory is linked and priced, its red mark cleared", () => {
    const r = applyInventoryChanges([line({ description: "610X8MM", check: "Not in your inventory" })], [item("n", "610 X 8MM", 400, "1750MM")], pricing);
    assert.equal(r.linked, 1);
    assert.equal(r.lines[0].inventory_item_id, "n");
    assert.equal(r.lines[0].unit_price, 480);
    assert.equal(r.lines[0].remarks, "1750MM");
    assert.equal(r.lines[0].check, undefined);
  });

  it("with the same name in two lengths, only the length the line names is linked", () => {
    const items = [item("s", "165X4.75MM", 25.3, "Standard"), item("l", "165X4.75MM", 18.7, "440MM")];
    const r = applyInventoryChanges([line({ description: "165X4.75MM", remarks: "440MM, B CLASS" }), line({ description: "165X4.75MM" })], items, pricing);
    assert.equal(r.lines[0].inventory_item_id, "l");
    assert.equal(r.lines[1].inventory_item_id, null, "no length: not guessed");
  });

  it("nothing changed: the same lines back", () => {
    const lines = [line({ description: "Something else" })];
    assert.equal(applyInventoryChanges(lines, [item("a", "114X3.5MM", 8)], pricing).lines, lines);
  });
});
