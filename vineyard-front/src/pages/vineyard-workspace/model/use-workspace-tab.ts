import { useCallback, useEffect } from "react";
import { z } from "zod";

import { navigate, useLocation } from "@/shared/lib/router";
import { readItem, writeItem } from "@/shared/lib/storage";

export const WORKSPACE_TABS = ["vineyard", "route"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const TAB_PARAM = "tab";
const STORAGE_KEY = "vineyard:workspace-tab:v1";
const tabSchema = z.enum(WORKSPACE_TABS);

const parseTab = (value: string | null): WorkspaceTab | null => {
  const result = tabSchema.safeParse(value);
  return result.success ? result.data : null;
};

const withTab = (pathname: string, tab: WorkspaceTab) => {
  const params = new URLSearchParams(window.location.search);
  params.set(TAB_PARAM, tab);
  return `${pathname}?${params.toString()}`;
};

export const useWorkspaceTab = () => {
  const { pathname, searchParams } = useLocation();
  const tabInUrl = parseTab(searchParams.get(TAB_PARAM));
  const activeTab = tabInUrl ?? readItem(STORAGE_KEY, tabSchema) ?? "vineyard";

  useEffect(() => {
    if (!tabInUrl) navigate(withTab(pathname, activeTab), { replace: true });
  }, [tabInUrl, pathname, activeTab]);

  const selectTab = useCallback(
    (tab: WorkspaceTab) => {
      if (tab === activeTab) return;
      writeItem(STORAGE_KEY, tab);
      navigate(withTab(pathname, tab));
    },
    [activeTab, pathname],
  );

  return { activeTab, selectTab };
};
