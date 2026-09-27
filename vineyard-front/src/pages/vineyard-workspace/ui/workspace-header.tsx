import type { FC } from "react";

import { ArrowLeft } from "lucide-react";

import { ROLE_COPY, WORKSPACE_ROUTE, type Role } from "@/entities/role";
import { useSession } from "@/entities/session";
import { describeCapture, ResultsOriginNote, SAM3_MOCK_ID, type SurveySource } from "@/entities/survey";
import { SignOutButton } from "@/features/sign-out";
import { navigate } from "@/shared/lib/router";
import { LinkButton, Wordmark } from "@/shared/ui";

type WorkspaceHeaderProps = {
  role: Role;
  source: SurveySource;
};

export const WorkspaceHeader: FC<WorkspaceHeaderProps> = ({ role, source }) => {
  const session = useSession();

  return (
    <header className="px-6 pt-6 pb-6">
      <div className="flex items-center justify-between gap-4">
        <Wordmark />
        <SignOutButton />
      </div>

      <LinkButton onClick={() => navigate(WORKSPACE_ROUTE[role])} className="mt-6 inline-flex items-center gap-1.5">
        <ArrowLeft className="size-4" aria-hidden />
        All vineyards
      </LinkButton>

      <p className="mt-4 text-sm">
        <span className="text-primary font-medium">{ROLE_COPY[role].label}</span>
        {session && <span className="text-muted-foreground">, signed in as {session.fullName}</span>}
      </p>
      <h1 className="mt-1 text-[1.625rem] leading-tight font-semibold tracking-[-0.02em]">{source.name} survey</h1>
      <p className="text-muted-foreground mt-1.5 text-sm leading-snug">{describeCapture(source)}</p>
      <ResultsOriginNote source={source} showMessage className="mt-2" />
      {source.id === SAM3_MOCK_ID && <p className="text-muted-foreground mt-3 text-sm">
        All 311 tiles of SAM3 predictions. Rows are shown as tile segments; block outlines are approximate.
        Routes visit waste detections using the supplied paths. Missing-vine inspection points are not included.
      </p>}
    </header>
  );
};
