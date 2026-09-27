import { ArrowRight, Plus } from "lucide-react";
import type { FC } from "react";

import { ParcelFacts, ParcelOutline, type Parcel } from "@/entities/parcel";
import { vineyardUrl, type Role } from "@/entities/role";
import { describeCapture, isProcessing, type SurveySource } from "@/entities/survey";
import { OrderDroneSurveyLink } from "@/features/order-drone-survey";
import { ROUTES } from "@/shared/config";
import { AppLink } from "@/shared/ui";

import { SurveyFacts } from "./survey-facts";
import { UploadNote } from "./upload-note";

const addSurveyUrl = (parcel: Parcel) => `${ROUTES.addVineyard}?parcel=${encodeURIComponent(parcel.cadastralNumber)}`;

type ParcelSurveyProps = { source: SurveySource; role: Role };

const ParcelSurvey: FC<ParcelSurveyProps> = ({ source, role }) => {
  return (
    <li className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-1">
        <p className="text-sm">
          <span className="font-semibold">{source.name}</span>{" "}
          <span className="text-muted-foreground">{describeCapture(source)}</span>
        </p>
        {source.uploadedBy && <UploadNote source={source} uploadedBy={source.uploadedBy} />}
        {isProcessing(source) && <SurveyFacts source={source} role={role} />}
      </div>
      {!isProcessing(source) && (
        <AppLink
          href={vineyardUrl(role, source.id)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex h-9 items-center gap-2 justify-self-start rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
        >
          Open vineyard
          <ArrowRight className="size-4" aria-hidden />
        </AppLink>
      )}
    </li>
  );
};

type NoSurveyProps = { parcel: Parcel; role: Role };

const NoSurvey: FC<NoSurveyProps> = ({ parcel, role }) => {
  if (role === "inspector") {
    return <p className="text-muted-foreground text-sm">No drone survey has been added for this parcel yet.</p>;
  }
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        No drone survey yet. Add the survey&rsquo;s image tiles or orthomosaic link, or order a drone survey.
      </p>
      <div className="flex flex-wrap gap-2">
        <AppLink
          href={addSurveyUrl(parcel)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px]"
        >
          <Plus className="size-4" aria-hidden />
          Add survey
        </AppLink>
        <OrderDroneSurveyLink />
      </div>
    </div>
  );
};

type ParcelEntryProps = { parcel: Parcel; surveys: readonly SurveySource[]; role: Role };

export const ParcelEntry: FC<ParcelEntryProps> = ({ parcel, surveys, role }) => {
  return (
    <article className="grid gap-4 p-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:p-5">
      <ParcelOutline outline={parcel.outline} className="size-24 rounded-md" />
      <div className="grid min-w-0 gap-4">
        <ParcelFacts parcel={parcel} />
        {surveys.length > 0 ? (
          <div className="grid gap-2">
            <ul className="grid gap-2">
              {surveys.map(source => (
                <ParcelSurvey key={source.id} source={source} role={role} />
              ))}
            </ul>
            {role === "owner" && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <AppLink
                  href={addSurveyUrl(parcel)}
                  className="text-primary focus-visible:ring-ring/50 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                >
                  Add a newer survey
                </AppLink>
                <OrderDroneSurveyLink />
              </div>
            )}
          </div>
        ) : (
          <NoSurvey parcel={parcel} role={role} />
        )}
      </div>
    </article>
  );
};
