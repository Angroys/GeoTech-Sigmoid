import type { ComponentProps, FC } from "react";

import { cn } from "@/shared/lib/cn";

type LinkButtonProps = Omit<ComponentProps<"button">, "type">;

export const LinkButton: FC<LinkButtonProps> = ({ className, ...props }) => {
  return (
    <button
      type="button"
      className={cn(
        "text-primary focus-visible:ring-ring/50 shrink-0 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
};
