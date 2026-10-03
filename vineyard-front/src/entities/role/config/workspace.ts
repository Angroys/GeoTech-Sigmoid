import { ROUTES, type AppRoute } from "@/shared/config";

import type { Role } from "../model/role";

export const WORKSPACE_ROUTE = { owner: ROUTES.owner, inspector: ROUTES.inspector } as const satisfies Record<
  Role,
  AppRoute
>;

type VineyardQuery = { block?: string; delegation?: string };

export const vineyardUrl = (role: Role, surveyId: string, query: VineyardQuery = {}) => {
  const path = `${WORKSPACE_ROUTE[role]}/${encodeURIComponent(surveyId)}`;
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
};
