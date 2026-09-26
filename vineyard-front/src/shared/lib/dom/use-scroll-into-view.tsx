import { createContext, useContext, useEffect, useRef, type FC, type ReactNode } from "react";

const ScrollRevealContext = createContext(true);

type ScrollRevealProviderProps = { isEnabled: boolean; children: ReactNode };

export const ScrollRevealProvider: FC<ScrollRevealProviderProps> = ({ isEnabled, children }) => {
  return <ScrollRevealContext.Provider value={isEnabled}>{children}</ScrollRevealContext.Provider>;
};

export const useScrollIntoView = <Element extends HTMLElement>(isActive: boolean) => {
  const ref = useRef<Element>(null);
  const isRevealEnabled = useContext(ScrollRevealContext);

  useEffect(() => {
    if (!isActive || !isRevealEnabled) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [isActive, isRevealEnabled]);

  return ref;
};
