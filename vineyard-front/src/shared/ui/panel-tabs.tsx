import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export type PanelTab<Id extends string> = { id: Id; label: ReactNode; content: ReactNode };

type PanelTabsProps<Id extends string> = {
  label: string;
  tabs: readonly PanelTab<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
};

const KEY_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

export const PanelTabs = <Id extends string>({ label, tabs, activeId, onChange }: PanelTabsProps<Id>) => {
  const baseId = useId();
  const tabRefs = useRef(new Map<Id, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find(tab => tab.id === activeId) ?? tabs[0];

  useEffect(() => {
    const list = listRef.current;
    const panel = panelRef.current;
    if (!list || !panel) return;
    if (panel.getBoundingClientRect().top < list.getBoundingClientRect().bottom) {
      panel.scrollIntoView({ block: "start" });
    }
  }, [activeId]);

  const tabId = (id: Id) => `${baseId}-tab-${id}`;
  const panelId = (id: Id) => `${baseId}-panel-${id}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[event.key];
    if (!step || !activeTab) return;
    event.preventDefault();
    const next = tabs[step(tabs.indexOf(activeTab), tabs.length)];
    if (!next) return;
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="bg-background/95 border-border sticky top-0 z-10 flex gap-1 border-y px-4 backdrop-blur-sm"
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeTab?.id;
          return (
            <button
              key={tab.id}
              ref={element => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId(tab.id)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                "focus-visible:ring-ring/50 -mb-px flex items-center gap-2 border-b-2 px-2 py-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                isActive
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab && (
        <div
          ref={panelRef}
          role="tabpanel"
          id={panelId(activeTab.id)}
          aria-labelledby={tabId(activeTab.id)}
          className="scroll-mt-12"
        >
          {activeTab.content}
        </div>
      )}
    </>
  );
};
