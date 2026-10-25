import type { ScheduleKey } from "./schedules";

export type PipeSize = {
  id: number;
  nps: string;
  nps_value: number;
  dn: number | null;
  od_mm: number;
} & Record<ScheduleKey, number | null>;

/**
 * Parses an NPS written in any of the common ways into inches:
 * `1/2`, `1 1/2`, `1-1/2`, `1.5`, `2"`, and the compact Chinese-catalogue
 * style `11/2` (= 1 1/2) / `21/2` (= 2 1/2) used in the loading plan.
 */
export function parseNpsValue(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input
    .trim()
    .replace(/(["”″]|\binch(es)?\b|\bin\b)/gi, "")
    .trim();
  if (!s) return null;

  const fraction = s.match(/^(\d*?)[\s-]*([13])\/([248])$/);
  if (fraction) {
    const whole = fraction[1] ? Number(fraction[1]) : 0;
    return whole + Number(fraction[2]) / Number(fraction[3]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

export function formatNps(nps: string | null | undefined) {
  return nps ? `${nps}"` : "";
}

