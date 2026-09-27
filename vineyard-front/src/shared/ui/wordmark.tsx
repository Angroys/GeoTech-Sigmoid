import logoUrl from "./logo.svg";

export const Wordmark = () => (
  <p className="inline-flex items-center gap-2.5">
    <img src={logoUrl} alt="" className="size-7" />
    <span className="text-lg font-semibold tracking-tight">Vineyard</span>
  </p>
);
