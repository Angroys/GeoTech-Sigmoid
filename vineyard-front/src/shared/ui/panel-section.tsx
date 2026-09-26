import { useId, type FC, type ReactNode } from "react";

type PanelSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export const PanelSection: FC<PanelSectionProps> = ({ title, description, children }) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="border-border border-t px-6 py-6">
      <h2 id={headingId} className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {description && <p className="text-muted-foreground mt-1 text-sm leading-snug">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
};
