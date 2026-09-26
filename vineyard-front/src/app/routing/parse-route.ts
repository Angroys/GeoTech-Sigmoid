import { isRole, type Role } from "@/entities/role";
import { ADD_VINEYARD_SEGMENT } from "@/shared/config";

type AppRouteMatch =
  | { kind: "auth" }
  | { kind: "vineyards"; role: Role }
  | { kind: "add-vineyard" }
  | { kind: "workspace"; role: Role; surveyId: string };

const ROLE_PATH = /^\/([a-z]+)(?:\/([a-z0-9-]+))?\/?$/;

export const parseAppPath = (pathname: string): AppRouteMatch => {
  const match = ROLE_PATH.exec(pathname);
  const role = match?.[1];
  if (!match || !isRole(role)) return { kind: "auth" };

  const segment = match[2];
  if (!segment) return { kind: "vineyards", role };
  if (role === "owner" && segment === ADD_VINEYARD_SEGMENT) return { kind: "add-vineyard" };
  return { kind: "workspace", role, surveyId: segment };
};
