import { ROUTES, type AppRoute } from "@/shared/config";

import type { Role } from "../model/role";

export const WORKSPACE_ROUTE = { owner: ROUTES.owner, inspector: ROUTES.inspector } as const satisfies Record<
  Role,
  AppRoute
>;

export const vineyardUrl = (role: Role, surveyId: string, blockId?: string) => {
  const path = `${WORKSPACE_ROUTE[role]}/${encodeURIComponent(surveyId)}`;
  return blockId ? `${path}?block=${encodeURIComponent(blockId)}` : path;
};
