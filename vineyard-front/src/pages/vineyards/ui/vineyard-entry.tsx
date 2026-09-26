import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import type { FC } from "react";

import { vineyardUrl, type Role } from "@/entities/role";
import { useSession } from "@/entities/session";
import { describeCapture, useSurvey, type Survey, type SurveySource } from "@/entities/survey";
import { RemoveVineyardButton } from "@/features/remove-vineyard";
import { assertNever } from "@/shared/lib/types";
import { AppLink } from "@/shared/ui";

import { useVineyardFacts } from "../model/use-vineyard-facts";

type VineyardFactsProps = { survey: Survey; source: SurveySource; role: Role };

const VineyardFacts: FC<VineyardFactsProps> = ({ survey, source, role }) => {
  const { facts, blocks } = useVineyardFacts(survey, role);

  return (
    <div className="grid gap-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {facts.map(fact => {
          return (
            <div key={fact.label}>
              <dt className="text-muted-foreground text-xs">{fact.label}</dt>
              <dd className="text-[0.9375rem] font-semibold tabular-nums">{fact.value}</dd>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground mr-1 text-xs">Open a block</span>
        {blocks.map(block => {
          return (
            <AppLink
              key={block.vineyardId}
              href={vineyardUrl(role, source.id, block.vineyardId)}
              className="border-border hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-ring/50 inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-0.5 text-xs outline-none focus-visible:ring-[3px]"
            >
              <span className="font-semibold">{block.vineyardId}</span>
              <span className="text-muted-foreground tabular-nums">{block.rowCount} rows</span>
            </AppLink>
          );
        })}
      </div>
    </div>
  );
};

type SurveyFactsProps = { source: SurveySource; role: Role };

const SurveyFacts: FC<SurveyFactsProps> = ({ source, role }) => {
  const state = useSurvey(source);

  switch (state.status) {
    case "loading":
      return (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading the measurements
        </p>
      );
    case "error":
      return (
        <p className="text-destructive flex gap-2 text-sm" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          The measurements could not be opened.
        </p>
      );
    case "ready":
      return <VineyardFacts survey={state.survey} source={source} role={role} />;
    default:
      return assertNever(state);
  }
};

type UploadNoteProps = { source: SurveySource; uploadedBy: NonNullable<SurveySource["uploadedBy"]> };

const UploadNote: FC<UploadNoteProps> = ({ source, uploadedBy }) => {
  const session = useSession();
  const isUploader = session?.accountId === uploadedBy.accountId;

  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
      <span>Added by {isUploader ? "you" : uploadedBy.fullName}, stored in this browser</span>
      {isUploader && <RemoveVineyardButton source={source} />}
    </p>
  );
};

type ThumbnailProps = { source: SurveySource; href: string };

const Thumbnail: FC<ThumbnailProps> = ({ source, href }) => {
  return (
    <AppLink
      href={href}
      tabIndex={-1}
      aria-hidden
      className="bg-muted block aspect-[16/9] overflow-hidden sm:aspect-auto sm:h-full sm:min-h-44"
    >
      {source.imagery ? (
        <img
          src={source.imagery.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        <span className="text-muted-foreground grid size-full place-items-center bg-[repeating-linear-gradient(115deg,transparent_0_10px,rgb(51_87_63/0.08)_10px_12px)] text-xs">
          No aerial image
        </span>
      )}
    </AppLink>
  );
};

type VineyardEntryProps = { source: SurveySource; role: Role };

export const VineyardEntry: FC<VineyardEntryProps> = ({ source, role }) => {
  const href = vineyardUrl(role, source.id);

  return (
    <article className="grid sm:grid-cols-[13rem_minmax(0,1fr)]">
      <Thumbnail source={source} href={href} />

      <div className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="grid min-w-0 gap-3">
          <header>
            <h2 className="text-lg leading-tight font-semibold tracking-[-0.01em]">
              <AppLink
                href={href}
                className="focus-visible:ring-ring/50 rounded-sm outline-none hover:underline focus-visible:ring-[3px]"
              >
                {source.name}
              </AppLink>
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {source.location}. {describeCapture(source)}
            </p>
            {source.uploadedBy && <UploadNote source={source} uploadedBy={source.uploadedBy} />}
          </header>
          <SurveyFacts source={source} role={role} />
        </div>

        <AppLink
          href={href}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] justify-self-start"
        >
          Open vineyard
          <ArrowRight className="size-4" aria-hidden />
        </AppLink>
      </div>
    </article>
  );
};
