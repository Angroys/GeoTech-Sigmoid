import { ChevronRight } from "lucide-react";
import { useEffect, useState, type FC, type ReactNode } from "react";

type CollapsiblePanelSectionProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  openWhen?: boolean;
  children: ReactNode;
};

export const CollapsiblePanelSection: FC<CollapsiblePanelSectionProps> = ({
  title,
  description,
  defaultOpen = false,
  openWhen = false,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (openWhen) setIsOpen(true);
  }, [openWhen]);

  return (
    <details
      open={isOpen}
      onToggle={event => setIsOpen(event.currentTarget.open)}
      className="group border-border border-t"
    >
      <summary className="hover:bg-muted/60 focus-visible:ring-ring/50 flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</span>
          {description && <span className="text-muted-foreground mt-1 block text-sm leading-snug">{description}</span>}
        </span>
        <ChevronRight
          className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="px-6 pb-6">{children}</div>
    </details>
  );
};
