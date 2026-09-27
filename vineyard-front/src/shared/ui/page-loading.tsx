import { LoaderCircle } from "lucide-react";
import type { FC } from "react";

type PageLoadingProps = { label: string };

export const PageLoading: FC<PageLoadingProps> = ({ label }) => {
  return (
    <div role="status" className="text-muted-foreground grid min-h-dvh place-items-center text-sm">
      <p className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {label}
      </p>
    </div>
  );
};
