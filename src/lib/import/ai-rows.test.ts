import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PickerItem } from "@/lib/inventory/types";
import { buildCatalog } from "./ai-prompt";
import { resolvePicks, toImportRows, type AiLine } from "./ai-rows";

const item = (id: string, description: string, note: string | null = null, extra: Partial<PickerItem> = {}): PickerItem => ({
  id,
  description,
  weight_kg: 1,
  unit_price: 10,
  stock_qty: 0,
  note,
  actual_weight: null,
  ...extra,
});

const inventory = [
  item("elbow4mm", "114X3.5MM", "300MM"),
  item("elbow4sch", '4"XSCH40 90°', "Standard"),
  item("elbow2", '2"XSCH40', "Standard"),
  item("tee2", '2"XSCH40 TEE'),
  item("tee2copy", '2"XSCH40 TEE'),
  item("redCon", '6"X3"XSCH40 REDUCER', "CONCENTRIC"),
  item("redEcc", '6"X3"XSCH40 REDUCER', "ECCENTRIC"),
  item("bend1280", "457X5.8MM", "1280MM"),
  item("bend1450", "457X5.8MM", "1450MM"),
  item("flange24", '24" SORF Flange CL300 Q235 ASME B16.5', "FLANGE"),
];
const catalog = buildCatalog(inventory);
const n = (id: string) => catalog.items.findIndex((i) => i.id === id) + 1;
const pick = (id: string) => ({ n: n(id), name: inventory.find((i) => i.id === id)!.description });

const line = (over: Partial<AiLine>): AiLine => ({
  source: "item",
  qty: 5,
  qty_sure: true,
  length: null,
  note: null,
  size_inch: null,
  reason: "Reason.",
  items: [],
  several_fit: false,
  differences: [],
  ...over,
});

describe("resolvePicks", () => {
  it("keeps a pick whose number and name agree", () => {
    assert.deepEqual(
      resolvePicks([pick("elbow2")], catalog).map((i) => i.id),
      ["elbow2"],
    );
  });

  it("finds a pick by its name when the number is off", () => {
    assert.deepEqual(
      resolvePicks([{ n: n("elbow2") + 1, name: '2"XSCH40' }], catalog).map((i) => i.id),
      ["elbow2"],
    );
  });

  it("accepts the name written with its note", () => {
    assert.deepEqual(
      resolvePicks([{ n: 999, name: '6"X3"XSCH40 REDUCER|ECCENTRIC' }], catalog).map((i) => i.id),
      ["redEcc"],
    );
  });

  it("accepts the name copied from its inventory line (size|name|note)", () => {
    assert.deepEqual(
      resolvePicks([{ n: n("bend1450"), name: '18"|457X5.8MM|1450MM' }], catalog).map((i) => i.id),
      ["bend1450"],
    );
    assert.deepEqual(
      resolvePicks([{ n: 999, name: '18"|457X5.8MM|1450MM' }], catalog).map((i) => i.id),
      ["bend1450"],
    );
  });

  it("drops a name that is not in the inventory", () => {
    assert.deepEqual(resolvePicks([{ n: n("elbow2"), name: '20" CL1500 RTJ WN FLANGE' }], catalog), []);
  });

  it("drops a name shared by items of other lengths when the number doesn't say which", () => {
    assert.deepEqual(resolvePicks([{ n: 999, name: "457X5.8MM" }], catalog), []);
  });

  it("counts copies of one item once", () => {
    assert.equal(resolvePicks([pick("tee2"), pick("tee2copy")], catalog).length, 1);
  });
});

describe("toImportRows", () => {
  it("an exact pick of the right size is matched, with qty, length and note", () => {
    const [row] = toImportRows(
      [line({ source: "457 x 5.8mm elbow 1280mm long", qty: 10, size_inch: "18", length: "1280MM", note: "galvanised", items: [pick("bend1280")] })],
      catalog,
    );
    assert.equal(row.status, "matched");
    assert.deepEqual(row.issues, []);
    assert.equal(row.matches[0].item.id, "bend1280");
    assert.equal(row.matches[0].score, 1);
    assert.equal(row.qty, 10);
    assert.equal(row.length, "1280MM");
    assert.equal(row.note, "galvanised");
    assert.equal(row.why, "Reason.");
  });

  it("an exact pick of another nominal size is only offered (a pick from the wrong row)", () => {
    const [row] = toImportRows([line({ source: '6" SCH40 elbow', size_inch: "6", items: [pick("elbow4sch")] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("size"));
  });

  it("an exact pick with another wall is only offered (355X5MM is not 355X5.5MM)", () => {
    const own = buildCatalog([...inventory, item("thick", "355X5.5MM", "1000MM")]);
    const [row] = toImportRows([line({ source: "355X5MM", size_inch: "14", items: [{ n: own.items.findIndex((i) => i.id === "thick") + 1, name: "355X5.5MM" }] })], own);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("size"));
  });

  it("when the AI's pick fails the checks and the standard matcher is sure, the standard item comes first", () => {
    const own = buildCatalog([...inventory, item("thin", "355X5MM", "1000MM"), item("thick", "355X5.5MM", "1000MM")]);
    const [row] = toImportRows([line({ source: "355X5MM", size_inch: "14", items: [{ n: own.items.findIndex((i) => i.id === "thick") + 1, name: "355X5.5MM" }] })], own);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("similar"));
    assert.equal(row.matches[0].item.id, "thin");
  });

  it("several items that fit equally are a choice for the user", () => {
    const [row] = toImportRows([line({ source: "457x5.8 elbow", size_inch: "18", several_fit: true, items: [pick("bend1280"), pick("bend1450")] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("similar"));
    assert.deepEqual(
      row.matches.filter((m) => m.score === 1).map((m) => m.item.id),
      ["bend1280", "bend1450"],
    );
  });

  it("an ambiguous answer cut down to one checked pick stays a choice, with that item's other lengths", () => {
    const [row] = toImportRows([line({ source: "457x5.8 elbow", size_inch: "18", several_fit: true, items: [pick("bend1280"), { n: 999, name: "457X5.8MM" }] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("similar"));
    assert.deepEqual(
      row.matches
        .filter((m) => m.score === 1)
        .map((m) => m.item.id)
        .sort(),
      ["bend1280", "bend1450"],
    );
  });

  it("a first item that isn't in the inventory is not sure, whatever follows it", () => {
    const [row] = toImportRows([line({ source: '2"XSCH40', size_inch: "2", items: [{ n: 999, name: '2"XSCH40 SPECIAL' }, pick("elbow2")] })], catalog);
    assert.notEqual(row.status, "matched");
  });

  it("an exact pick of another kind is only offered, with the reason", () => {
    const [row] = toImportRows([line({ source: '2" SCH40 45 deg elbow', size_inch: "2", items: [pick("elbow2")] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("size"));
    assert.match(row.why ?? "", /45° ELBOW/);
  });

  it("a quantity too big to be pieces is flagged", () => {
    const [row] = toImportRows([line({ qty: 5_000_000, size_inch: "2", items: [pick("elbow2")] })], catalog);
    assert.ok(row.issues.includes("qty-unclear"));
  });

  it("copies the AI calls ambiguous are one sure item", () => {
    const [row] = toImportRows([line({ source: "2 inch sch40 equal tee", size_inch: "2", several_fit: true, items: [pick("tee2"), pick("tee2copy")] })], catalog);
    assert.equal(row.status, "matched");
  });

  it("a close item is not taken for the asked one", () => {
    const [row] = toImportRows([line({ source: "24 inch WNRF flange 1500#", size_inch: "24", differences: ["weld neck vs slip-on", "class 1500 vs 300"], items: [pick("flange24")] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("size"));
    assert.ok(row.matches[0].score < 1);
  });

  it("nothing found is missing", () => {
    const [row] = toImportRows([line({ source: "Weld Neck Flange, 500nb Class 1500#, RTJ", qty: 2, size_inch: "20", items: [] })], catalog);
    assert.equal(row.status, "none");
    assert.ok(row.issues.includes("missing"));
    assert.equal(row.qty, 2);
  });

  it("alternatives listed after a checked first item don't stop the match, and come after it", () => {
    const [row] = toImportRows([line({ source: "457 x 5.8mm elbow 1280mm long", size_inch: "18", length: "1280MM", items: [pick("bend1280"), pick("bend1450"), { n: 999, name: "NOT AN ITEM" }] })], catalog);
    assert.equal(row.status, "matched");
    assert.equal(row.matches[0].item.id, "bend1280");
    assert.ok(row.matches.slice(1).every((m) => m.score < 1));
  });

  it("a line the AI says differs is offered with the differences as the reason", () => {
    const [row] = toImportRows([line({ source: '4" SCH80 90 elbow', size_inch: "4", differences: ["SCH40 vs SCH80"], items: [pick("elbow4sch")] })], catalog);
    assert.equal(row.status, "check");
    assert.equal(row.why, "Differs: SCH40 vs SCH80.");
  });

  it("when the standard matcher is sure of an item the AI didn't find, it is offered to check", () => {
    const [row] = toImportRows([line({ source: '2"XSCH40 TEE', size_inch: "2", items: [] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("fuzzy"));
    assert.ok(["tee2", "tee2copy"].includes(row.matches[0].item.id));
  });

  it("an AI pick that doesn't resolve but points at the standard matcher's sure item is a match", () => {
    const rows = toImportRows(
      [
        // Right name with other spacing and a wrong number; right number with a garbled name.
        line({ source: "TEE,EQ,BW,CS,A234,WPB,2IN,40", size_inch: "2", items: [{ n: 999, name: '2" X SCH40 TEE (EQ)' }] }),
        line({ source: "TEE,EQ,BW,CS,A234,WPB,2IN,40", size_inch: "2", items: [{ n: n("tee2"), name: "2IN SCH40 EQUAL TEE" }] }),
      ],
      catalog,
    );
    // "(EQ)" makes the first name differ: still red. The second points at the item by number.
    assert.equal(rows[0].status, "check");
    assert.equal(rows[1].status, "matched");
    assert.deepEqual(rows[1].issues, []);
    const [spaced] = toImportRows([line({ source: "TEE,EQ,BW,CS,A234,WPB,2IN,40", size_inch: "2", items: [{ n: 999, name: '2" X SCH40 TEE' }] })], catalog);
    assert.equal(spaced.status, "matched");
  });

  it('"Standard" asked for an item stocked in one mm length only is that item; with a Standard length in stock it is not', () => {
    const inv = [...inventory, item("elbow76", "76X4MM", "190MM"), item("e165short", "165X4.75MM", "440MM"), item("e165std", "165X4.75MM", "Standard")];
    const cat = buildCatalog(inv);
    const at = (id: string) => ({ n: cat.items.findIndex((i) => i.id === id) + 1, name: inv.find((i) => i.id === id)!.description });
    const [only, other] = toImportRows(
      [
        line({ source: "76X4MM", size_inch: "2 1/2", length: "Standard", items: [at("elbow76")], differences: ["190MM long vs Standard"] }),
        line({ source: "165X4.75MM", size_inch: "6", length: "Standard", items: [at("e165short")], differences: ["440MM long vs Standard"] }),
      ],
      cat,
    );
    assert.equal(only.status, "matched");
    assert.equal(only.matches[0].item.id, "elbow76");
    assert.equal(only.length, undefined);
    assert.equal(other.status, "check");
  });

  it("an AI pick that doesn't resolve and names a difference stays to check", () => {
    const [row] = toImportRows([line({ source: "TEE,EQ,BW,CS,A234,WPB,2IN,40", size_inch: "2", items: [{ n: n("tee2"), name: "x" }], differences: ["SCH80 vs SCH40"] })], catalog);
    assert.equal(row.status, "check");
  });

  it("when the standard matcher is sure of another item, both are offered (the AI's pick first when it passes the checks)", () => {
    const [row] = toImportRows([line({ source: "114X3.5MM", size_inch: "4", items: [pick("elbow4sch")] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("similar"));
    assert.deepEqual(
      row.matches.filter((m) => m.score === 1).map((m) => m.item.id),
      ["elbow4sch", "elbow4mm"],
    );
  });

  it("when the AI's pick is another kind and the standard matcher is sure, the standard item comes first", () => {
    const [row] = toImportRows([line({ source: '2"XSCH40 TEE', size_inch: "2", items: [pick("elbow2")] })], catalog);
    assert.equal(row.status, "check");
    assert.ok(row.issues.includes("similar"));
    const top = row.matches.filter((m) => m.score === 1).map((m) => m.item.id);
    assert.ok(["tee2", "tee2copy"].includes(top[0]));
    assert.ok(top.includes("elbow2"));
  });

  it("a missing or unclear quantity is flagged", () => {
    const rows = toImportRows(
      [line({ qty: null, size_inch: "2", items: [pick("elbow2")] }), line({ qty: 3, qty_sure: false, size_inch: "2", items: [pick("elbow2")] }), line({ qty: 0, size_inch: "2", items: [pick("elbow2")] })],
      catalog,
    );
    assert.ok(rows[0].issues.includes("qty-missing"));
    assert.ok(rows[1].issues.includes("qty-unclear"));
    assert.equal(rows[2].qty, null);
  });

  it("the standard matcher's suggestions come after the AI's picks, never tied with them", () => {
    const [row] = toImportRows([line({ source: "114X3.5MM 300MM", size_inch: "4", items: [pick("elbow4mm")] })], catalog);
    assert.equal(row.matches[0].item.id, "elbow4mm");
    for (const m of row.matches.slice(1)) assert.ok(m.score <= 0.95);
    assert.equal(new Set(row.matches.map((m) => m.item.id)).size, row.matches.length);
  });

  it("keeps one row per AI line, in order", () => {
    const rows = toImportRows([line({ source: "MS ELBOW", qty: null, items: [] }), line({ source: '2"XSCH40', size_inch: "2", items: [pick("elbow2")] })], catalog);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].matches[0].item.id, "elbow2");
  });
});
