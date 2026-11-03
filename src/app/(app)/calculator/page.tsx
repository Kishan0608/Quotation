import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { ContainerCalculator } from "./container-calculator";

export const metadata: Metadata = { title: "Container calculator" };

export default async function CalculatorPage() {
  await requireUser();
  return <ContainerCalculator />;
}
