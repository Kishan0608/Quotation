import { round2 } from "../format";

/** The container cost sheet (the user's, 2026-11-02): RMB costs, then INR costs, per RMB of goods. */
export type ContainerInputs = {
  /** Container value (RMB). */
  containerValue: number;
  /** Tax (RMB). */
  tax: number;
  /** Inland transport (RMB). */
  inland: number;
  /** Freight: USD amount x USD -> RMB rate x times (3900 USD @ 6.8 x 2). */
  freightUsd: number;
  usdToRmb: number;
  freightTimes: number;
  /** RMB -> INR rate for the first total. */
  rmbToInr: number;
  /** Customs (INR). */
  custom: number;
  /** Profit (INR). */
  profit: number;
};

export function containerCost(c: ContainerInputs) {
  const freight = round2(c.freightUsd * c.usdToRmb * c.freightTimes);
  const totalRmb = round2(c.containerValue + c.tax + c.inland + freight);
  const totalInr = round2(totalRmb * c.rmbToInr);
  const grandTotal = round2(totalInr + c.custom + c.profit);
  // Final: INR per RMB of container value, the second total divided by the container value (not rounded).
  const final = c.containerValue > 0 ? grandTotal / c.containerValue : null;
  return { freight, totalRmb, totalInr, grandTotal, final };
}
