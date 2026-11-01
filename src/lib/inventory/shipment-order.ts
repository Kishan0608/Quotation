/**
 * Supplier files in shipment order: by the date in the name ("FPP201 MOTI 2026-8-2"), then the
 * FPP number on the same day; files without a date keep their place, first. Imported in this
 * order, the newest price is the one that stays.
 */
export function shipmentOrder<T extends { name: string }>(files: T[]): T[] {
  const key = (name: string) => {
    const d = /(20\d{2})[-._ ](\d{1,2})[-._ ](\d{1,2})/.exec(name);
    const fpp = /FPP\s*(\d+)/i.exec(name);
    return [d ? Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) : -Infinity, fpp ? Number(fpp[1]) : 0];
  };
  return files
    .map((f, i) => ({ f, i, k: key(f.name) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((x) => x.f);
}
