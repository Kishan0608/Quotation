import type { AppRole } from "@/lib/supabase/database.types";

const RANK: Record<AppRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function hasRole(role: AppRole, minimum: AppRole) {
  return RANK[role] >= RANK[minimum];
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "full access",
  editor: "inventory and own quotations",
  viewer: "view only",
};
