import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containerCost } from "./container-cost";

// The user's sheet: 220000 + 25000 + 10000 + 3900 USD @ 6.8 x 2 = 308040 RMB; x 14.35 = 4420374 INR;
// + 600000 customs + 300000 profit = 5320374; / 220000 = 24.1835... (final, not rounded).
const sheet = { containerValue: 220000, tax: 25000, inland: 10000, freightUsd: 3900, usdToRmb: 6.8, freightTimes: 2, rmbToInr: 14.35, custom: 600000, profit: 300000 };

describe("container cost calculator", () => {
  it("gives the same figures as the user's Excel sheet", () => {
    const r = containerCost(sheet);
    assert.equal(r.freight, 53040);
    assert.equal(r.totalRmb, 308040);
    assert.equal(r.totalInr, 4420374);
    assert.equal(r.grandTotal, 5320374);
    assert.equal(r.final?.toFixed(8), "24.18351818");
  });

  it("no container value: no per-RMB figure", () => {
    assert.equal(containerCost({ ...sheet, containerValue: 0 }).final, null);
  });
});
