import { useSyncExternalStore } from "react";

type NavigateOptions = { replace?: boolean };

export type AppLocation = { pathname: string; searchParams: URLSearchParams };

const NAVIGATION_EVENT = "app:navigate";

export const navigate = (url: string, { replace = false }: NavigateOptions = {}) => {
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
};

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATION_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATION_EVENT, onChange);
  };
};

const readHref = () => window.location.pathname + window.location.search;

export const useLocation = (): AppLocation => {
  const href = useSyncExternalStore(subscribe, readHref);
  const url = new URL(href, window.location.origin);
  return { pathname: url.pathname, searchParams: url.searchParams };
};
