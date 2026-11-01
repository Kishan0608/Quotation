import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shipmentOrder } from "./shipment-order";

const names = (list: string[]) => shipmentOrder(list.map((name) => ({ name }))).map((f) => f.name);

describe("supplier files in shipment order", () => {
  it("by the date in the name, then the FPP number; whatever order they were picked in", () => {
    assert.deepEqual(
      names(["CN3#NAVEEN 2026-10-26.xlsx", "FPP201 MOTI 2026-8-2.xlsx", "LOADING PLAN FOR MOTI 2026-10-14.xlsx", "FPP212 ROYAL 2026-8-22.xlsx", "FPP199 KA 2026-8-2.xlsx"]),
      ["FPP199 KA 2026-8-2.xlsx", "FPP201 MOTI 2026-8-2.xlsx", "FPP212 ROYAL 2026-8-22.xlsx", "LOADING PLAN FOR MOTI 2026-10-14.xlsx", "CN3#NAVEEN 2026-10-26.xlsx"],
    );
  });

  it("files without a date go first, in the order picked", () => {
    assert.deepEqual(names(["B 2026-9-1.xlsx", "NAVEEN.xlsx", "DEEPAK.xlsx"]), ["NAVEEN.xlsx", "DEEPAK.xlsx", "B 2026-9-1.xlsx"]);
  });
});
