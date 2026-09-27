import type { FC } from "react";

import { WORKSPACE_ROUTE, type Role } from "@/entities/role";
import { useSession } from "@/entities/session";
import { useSurveySource } from "@/entities/survey";
import { AddVineyardPage } from "@/pages/add-vineyard";
import { AuthPage } from "@/pages/auth";
import { VineyardWorkspacePage } from "@/pages/vineyard-workspace";
import { VineyardsPage } from "@/pages/vineyards";
import { Redirect, useLocation } from "@/shared/lib/router";
import { assertNever } from "@/shared/lib/types";
import { PageLoading } from "@/shared/ui";

import { parseAppPath } from "./parse-route";
import { RequireRole } from "./require-role";

type WorkspaceRouteProps = { role: Role; surveyId: string };

const WorkspaceRoute: FC<WorkspaceRouteProps> = ({ role, surveyId }) => {
  const { source, isLoading } = useSurveySource(surveyId);

  if (isLoading) return <PageLoading label="Opening the vineyard" />;
  if (!source) return <Redirect to={WORKSPACE_ROUTE[role]} />;
  return <VineyardWorkspacePage role={role} source={source} />;
};

export const AppRouter: FC = () => {
  const { pathname } = useLocation();
  const session = useSession();
  const route = parseAppPath(pathname);

  switch (route.kind) {
    case "auth":
      return session ? <Redirect to={WORKSPACE_ROUTE[session.role]} /> : <AuthPage />;
    case "vineyards":
      return (
        <RequireRole role={route.role}>
          <VineyardsPage role={route.role} />
        </RequireRole>
      );
    case "add-vineyard":
      return (
        <RequireRole role="owner">
          <AddVineyardPage />
        </RequireRole>
      );
    case "workspace":
      return (
        <RequireRole role={route.role}>
          <WorkspaceRoute role={route.role} surveyId={route.surveyId} />
        </RequireRole>
      );
    default:
      return assertNever(route);
  }
};
