import { ArrowRight } from "lucide-react";
import type { FC } from "react";

import { vineyardUrl, type Role } from "@/entities/role";
import { describeCapture, isProcessing, type SurveySource } from "@/entities/survey";
import { AppLink } from "@/shared/ui";

import { SurveyFacts } from "./survey-facts";
import { UploadNote } from "./upload-note";
import { VineyardThumbnail } from "./vineyard-thumbnail";

type OpenVineyardLinkProps = { href: string };

const OpenVineyardLink: FC<OpenVineyardLinkProps> = ({ href }) => {
  return (
    <AppLink
      href={href}
      className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex h-10 items-center justify-center gap-2 justify-self-start rounded-md px-4 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
    >
      Open vineyard
      <ArrowRight className="size-4" aria-hidden />
    </AppLink>
  );
};

type VineyardEntryProps = { source: SurveySource; role: Role };

export const VineyardEntry: FC<VineyardEntryProps> = ({ source, role }) => {
  const href = vineyardUrl(role, source.id);

  return (
    <article className="grid sm:grid-cols-[13rem_minmax(0,1fr)]">
      <VineyardThumbnail source={source} href={href} />

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

        {!isProcessing(source) && <OpenVineyardLink href={href} />}
      </div>
    </article>
  );
};
