import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PipeSize } from "@/lib/pipe/sizes";
import { SCHEDULES } from "@/lib/pipe/schedules";

const COLUMNS = ["id", "nps", "nps_value", "dn", "od_mm", ...SCHEDULES.map((s) => s.key)].join(", ");

/** The pipe dimension chart, ordered by NPS. RLS limits it to active users. */
export const getPipeSizes = cache(async (): Promise<PipeSize[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("pipe_sizes").select(COLUMNS).order("nps_value");
  if (error) throw new Error("Could not load the pipe size chart.");
  return (data ?? []) as unknown as PipeSize[];
});
