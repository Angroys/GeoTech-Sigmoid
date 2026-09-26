import { ArrowLeft } from "lucide-react";
import type { FC } from "react";

import { AddVineyardForm } from "@/features/add-vineyard";
import { ROUTES } from "@/shared/config";
import { AppLink } from "@/shared/ui";
import { AppHeader } from "@/widgets/app-header";

export const AddVineyardPage: FC = () => {
  return (
    <div data-role="owner" className="min-h-dvh">
      <AppHeader role="owner" />

      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-8">
        <AppLink
          href={ROUTES.owner}
          className="text-primary focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All vineyards
        </AppLink>

        <h1 className="mt-6 text-[2rem] leading-tight font-semibold tracking-[-0.02em]">Add a vineyard</h1>
        <p className="text-muted-foreground mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed">
          Upload the processing pipeline&rsquo;s output for one drone survey. Until the register has a server, the
          survey is kept in this browser and is visible to everyone who signs in on it.
        </p>

        <div className="border-border mt-10 border-t pt-10">
          <AddVineyardForm />
        </div>
      </main>
    </div>
  );
};
