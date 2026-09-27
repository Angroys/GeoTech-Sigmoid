import type { FC, ReactNode } from "react";

type WorkspaceLayoutProps = {
  panel: ReactNode;
  map: ReactNode;
};

export const WorkspaceLayout: FC<WorkspaceLayoutProps> = ({ panel, map }) => {
  return (
    <div className="grid h-dvh grid-rows-[minmax(0,45dvh)_minmax(0,1fr)] overflow-hidden md:grid-cols-[22rem_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[25rem_minmax(0,1fr)]">
      <div className="min-h-0 md:order-2">{map}</div>
      <aside className="bg-background border-border relative min-h-0 overflow-y-auto overscroll-contain max-md:border-t md:order-1 md:border-r">
        {panel}
      </aside>
    </div>
  );
};
