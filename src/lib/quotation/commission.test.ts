import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoUnitPrice, repriceLines } from "./calc";
import type { QuoteLine } from "./types";

const pricing = (commission: number) => ({ pricing_basis: "piece" as const, rate_per_kg: null, margin_pct: commission });
const line = (base: number, over: Partial<QuoteLine> = {}) => ({ base_price: base, unit_weight_kg: 1, unit_price: base, price_overridden: false, ...over }) as QuoteLine;

describe("commission: customer price = China price / (1 - commission)", () => {
  it("0.80 at 20% is 1.00 (the user's example); no commission keeps the China price", () => {
    assert.equal(autoUnitPrice(line(0.8), pricing(20)), 1);
    assert.equal(autoUnitPrice(line(242), pricing(0)), 242);
    assert.equal(autoUnitPrice(line(6.7), pricing(10)), 7.44);
  });

  it("a new commission re-prices every line except prices typed by hand", () => {
    const [auto, typed] = repriceLines([line(0.8), line(0.8, { unit_price: 2, price_overridden: true })], pricing(20));
    assert.equal(auto.unit_price, 1);
    assert.equal(typed.unit_price, 2);
  });
});
