import { useCallback } from "react";

import type { Role } from "@/entities/role";
import { navigate, useLocation } from "@/shared/lib/router";

const VIEW_PARAM = "view";
const REPORT_VIEW = "report";

const withView = (pathname: string, view: string | null) => {
  const params = new URLSearchParams(window.location.search);
  if (view) params.set(VIEW_PARAM, view);
  else params.delete(VIEW_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

export const useReportView = (role: Role) => {
  const { pathname, searchParams } = useLocation();
  const canReport = role === "inspector";
  const isReportOpen = canReport && searchParams.get(VIEW_PARAM) === REPORT_VIEW;

  const openReport = useCallback(() => navigate(withView(pathname, REPORT_VIEW)), [pathname]);
  const closeReport = useCallback(() => navigate(withView(pathname, null)), [pathname]);

  return { canReport, isReportOpen, openReport, closeReport };
};
