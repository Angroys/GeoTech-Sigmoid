import { ArrowLeft } from "lucide-react";
import type { FC } from "react";

import { AddVineyardForm } from "@/features/add-vineyard";
import { ROUTES } from "@/shared/config";
import { assertNever } from "@/shared/lib/types";
import { AppLink } from "@/shared/ui";
import { AppHeader } from "@/widgets/app-header";

import { useTargetParcel } from "../model/use-target-parcel";

const TargetForm: FC = () => {
  const target = useTargetParcel();
  switch (target.status) {
    case "none":
      return <AddVineyardForm parcel={null} />;
    case "loading":
      return <p role="status" className="text-muted-foreground text-sm">Looking up the parcel in the cadastre</p>;
    case "ready":
      return <AddVineyardForm key={target.parcel.cadastralNumber} parcel={target.parcel} />;
    case "missing":
      return (
        <p role="alert" className="text-destructive text-sm">
          Parcel {target.cadastralNumber} was not found in the cadastre.
        </p>
      );
    default:
      return assertNever(target);
  }
};

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

        <h1 className="mt-6 text-[2rem] leading-tight font-semibold tracking-[-0.02em]">Add a drone survey</h1>
        <p className="text-muted-foreground mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed">
          The processing service finds the vine canopies, rows, inter-rows and waste in the imagery and calculates
          the measurements; the vineyard opens once it has finished.
        </p>

        <div className="border-border mt-10 border-t pt-10">
          <TargetForm />
        </div>
      </main>
    </div>
  );
};
