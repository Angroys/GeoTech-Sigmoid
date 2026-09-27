import type { FC, ReactNode } from "react";

import { WORKSPACE_ROUTE, type Role } from "@/entities/role";
import { useSession } from "@/entities/session";
import { ROUTES } from "@/shared/config";
import { Redirect } from "@/shared/lib/router";

type RequireRoleProps = {
  role: Role;
  children: ReactNode;
};

export const RequireRole: FC<RequireRoleProps> = ({ role, children }) => {
  const session = useSession();

  if (!session) return <Redirect to={`${ROUTES.signIn}?role=${role}`} />;
  if (session.role !== role) return <Redirect to={WORKSPACE_ROUTE[session.role]} />;
  return <>{children}</>;
};
