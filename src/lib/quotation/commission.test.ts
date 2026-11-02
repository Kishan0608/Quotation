import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoUnitPrice, commissionOfMultiplier, multiplierOf, repriceLines } from "./calc";
import type { QuoteLine } from "./types";

const pricing = (commission: number) => ({ pricing_basis: "piece" as const, rate_per_kg: null, margin_pct: commission });
const line = (base: number, over: Partial<QuoteLine> = {}) => ({ base_price: base, unit_weight_kg: 1, unit_price: base, price_overridden: false, ...over }) as QuoteLine;

describe("commission: customer price = China price + commission % on top", () => {
  it("5.70 at 10% is 6.27 (the user's example); no commission keeps the China price", () => {
    assert.equal(autoUnitPrice(line(5.7), pricing(10)), 6.27);
    assert.equal(autoUnitPrice(line(0.8), pricing(20)), 0.96);
    assert.equal(autoUnitPrice(line(242), pricing(15)), 278.3);
    assert.equal(autoUnitPrice(line(242), pricing(0)), 242);
  });

  it("typed as a multiplier it is the same commission: × 1.1 = 10% (5.70 -> 6.27), × 1.25 = 25%", () => {
    assert.equal(commissionOfMultiplier(1.1), 10);
    assert.equal(commissionOfMultiplier(1.15), 15, "no 15.000000000000014");
    assert.equal(commissionOfMultiplier(1.25), 25);
    assert.equal(commissionOfMultiplier(1), 0);
    assert.equal(multiplierOf(25), 1.25);
    assert.equal(multiplierOf(12.34), 1.1234);
    assert.equal(autoUnitPrice(line(5.7), pricing(commissionOfMultiplier(1.1))), 6.27);
    assert.equal(autoUnitPrice(line(5.7), pricing(commissionOfMultiplier(1.25))), 7.13);
  });

  it("a new commission re-prices every line except prices typed by hand", () => {
    const [auto, typed] = repriceLines([line(5.7), line(5.7, { unit_price: 7, price_overridden: true })], pricing(10));
    assert.equal(auto.unit_price, 6.27);
    assert.equal(typed.unit_price, 7);
  });
});
