import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PickerItem } from "@/lib/inventory/types";
import { conflict, kindOf, type Asked } from "./ai-checks";

const item = (description: string, note: string | null = null): PickerItem => ({
  id: description,
  description,
  weight_kg: null,
  unit_price: null,
  stock_qty: 0,
  note,
  actual_weight: null,
});
const asked = (source: string, over: Partial<Asked> = {}): Asked => ({ source, length: null, size_inch: null, ...over });

describe("kindOf", () => {
  it("reads inventory names (no kind word = a 90° elbow)", () => {
    assert.equal(kindOf('2"XSCH40', true), "ELBOW");
    assert.equal(kindOf("114X3.5MM", true), "ELBOW");
    assert.equal(kindOf('4"XSCH40 90°', true), "ELBOW");
    assert.equal(kindOf('2"XSCH40 TEE', true), "TEE");
    assert.equal(kindOf('1"XSCH40 180°', true), "180° BEND");
    assert.equal(kindOf('2"XSCH40 45°', true), "45° ELBOW");
    assert.equal(kindOf('11/2"XSCH80 1D', true), "1D ELBOW");
    assert.equal(kindOf('4"XSCH40 3D BEND', true), "3D BEND");
    assert.equal(kindOf('6"X3"XSCH40 REDUCER', true), "REDUCER");
    assert.equal(kindOf("BLANK RAISE FACE BLRF 16\" CL150 FLANGE", true), "FLANGE");
  });

  it("reads customers' words, and says nothing when they don't", () => {
    assert.equal(kindOf("ECC reducer 10 x 8 inch sch40", false), "REDUCER");
    assert.equal(kindOf("RED,CONC,BW,CS,A234,WPB,4x2IN,40x80", false), "REDUCER");
    assert.equal(kindOf("4x2 reducing tee sch40", false), "TEE");
    assert.equal(kindOf("ELBO,90,LR,BW,CS,A234,WPB,2IN,S40", false), "ELBOW");
    assert.equal(kindOf('1.1/2" S/80 45 deg elbow', false), "45° ELBOW");
    assert.equal(kindOf("Weld Neck Flange, 500nb Class 1500#", false), "FLANGE");
    assert.equal(kindOf('2"XSCH40', false), null);
    assert.equal(kindOf("457 x 5.8mm 1280mm long", false), null);
  });
});

describe("conflict", () => {
  it("passes an item that agrees with everything the line says", () => {
    assert.equal(conflict(asked('4" SCH40 LR 90 deg elbow BW A234 WPB', { size_inch: "4" }), item('4"XSCH40 90°', "Standard")), null);
    assert.equal(conflict(asked("457 x 5.8mm elbow 1280mm long", { size_inch: "18", length: "1280MM" }), item("457X5.8MM", "1280MM")), null);
    assert.equal(conflict(asked("ECC reducer 10 x 8 inch sch40", { size_inch: "10", length: "ECCENTRIC" }), item('10"X8"XSCH40 REDUCER', "ECCENTRIC")), null);
    assert.equal(conflict(asked('24" SORF flange 300#', { size_inch: "24" }), item('24" SORF Flange CL300 Q235 ASME B16.5', "FLANGE")), null);
  });

  it("finds another nominal size", () => {
    assert.match(conflict(asked('6" SCH40 elbow', { size_inch: "6" }), item('4"XSCH40 90°')) ?? "", /6"/);
  });

  it("finds another wall written the same way, after a row number", () => {
    assert.match(conflict(asked("1. 355X5MM"), item("355X5.5MM", "1000MM")) ?? "", /wall/);
    assert.match(conflict(asked('4" SCH80 elbow'), item('4"XSCH40 90°')) ?? "", /wall/);
    assert.equal(conflict(asked("114X6MM elbow"), item('4"XSCH40 90°')), null);
  });

  it("finds another kind", () => {
    assert.match(conflict(asked('2" SCH40 equal tee'), item('2"XSCH40')) ?? "", /TEE/);
    assert.match(conflict(asked('2" SCH40 45 deg elbow'), item('2"XSCH40')) ?? "", /45° ELBOW/);
  });

  it("finds another flange class, type or facing", () => {
    const sorf = item('24" SORF Flange CL300 Q235 ASME B16.5', "FLANGE");
    assert.match(conflict(asked('24" SORF flange 150#'), sorf) ?? "", /class 150/);
    assert.match(conflict(asked('24" weld neck flange CL300'), sorf) ?? "", /weld neck/);
    assert.match(conflict(asked('24" slip on RTJ flange class 300'), sorf) ?? "", /RTJ/);
  });

  it("finds stainless steel asked for a plain item", () => {
    assert.match(conflict(asked('4" SCH40 elbow SS316L'), item('4"XSCH40 90°')) ?? "", /stainless/);
    assert.match(conflict(asked("WN flange 24 inch CL300 A182 F321"), item('24" WNRF Flange CL300')) ?? "", /stainless/);
  });

  it("finds an eccentric reducer asked where the item is concentric", () => {
    assert.match(conflict(asked('8"X4" SCH40 reducer', { length: "ECCENTRIC" }), item('8"X4"XSCH40 REDUCER', "CONCENTRIC")) ?? "", /ECCENTRIC/);
  });

  it("finds another length in mm", () => {
    assert.match(conflict(asked("457X5.8MM", { length: "1450MM" }), item("457X5.8MM", "1280MM")) ?? "", /1450MM/);
    assert.match(conflict(asked("114X3.5MM", { length: "300MM" }), item("114X3.5MM", "Standard")) ?? "", /Standard/);
    assert.equal(conflict(asked("114X3.5MM", { length: "Standard" }), item("114X3.5MM", "300MM")), null);
  });
});
