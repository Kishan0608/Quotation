// Wall-thickness schedules in the order they appear on the ANSI B36.10 / B36.19 chart.
export const SCHEDULES = [
  { key: "sch_5s", code: "5S", label: "SCH 5S" },
  { key: "sch_10s", code: "10S", label: "SCH 10S" },
  { key: "sch_10", code: "10", label: "SCH 10" },
  { key: "sch_20", code: "20", label: "SCH 20" },
  { key: "sch_30", code: "30", label: "SCH 30" },
  { key: "sch_40s", code: "40S", label: "SCH 40S" },
  { key: "sch_std", code: "STD", label: "STD" },
  { key: "sch_40", code: "40", label: "SCH 40" },
  { key: "sch_60", code: "60", label: "SCH 60" },
  { key: "sch_80s", code: "80S", label: "SCH 80S" },
  { key: "sch_xs", code: "XS", label: "XS" },
  { key: "sch_80", code: "80", label: "SCH 80" },
  { key: "sch_100", code: "100", label: "SCH 100" },
  { key: "sch_120", code: "120", label: "SCH 120" },
  { key: "sch_140", code: "140", label: "SCH 140" },
  { key: "sch_160", code: "160", label: "SCH 160" },
  { key: "sch_xxs", code: "XXS", label: "XXS" },
] as const;

export type ScheduleKey = (typeof SCHEDULES)[number]["key"];
