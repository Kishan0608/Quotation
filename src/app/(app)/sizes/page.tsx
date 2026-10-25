import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getPipeSizes } from "@/lib/data/pipe-sizes";
import { SizeChart } from "./size-chart";

export const metadata: Metadata = { title: "Pipe size chart" };

export default async function SizesPage() {
  const [user, sizes] = await Promise.all([requireUser(), getPipeSizes()]);
  return <SizeChart sizes={sizes} isAdmin={user.role === "admin"} />;
}
