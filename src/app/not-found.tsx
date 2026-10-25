import { FileQuestion } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[70dvh] place-items-center px-4">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500">
          <FileQuestion className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The page or record you are looking for does not exist, or you no longer have access to it.</p>
        <ButtonLink href="/dashboard" className="mt-6">
          Back to dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
