import { CircleAlert, CircleCheck } from "lucide-react";

import { cn } from "@/shared/lib/cn";

import type { SubmitStatus } from "@/shared/lib/form";

type StatusMessageProps = { status: SubmitStatus };

export const StatusMessage = ({ status }: StatusMessageProps) => {
  const isError = status.kind === "error";
  const Icon = isError ? CircleAlert : CircleCheck;
  const message = status.kind === "success" || status.kind === "error" ? status.message : undefined;

  return (
    <div aria-live="polite" aria-atomic="true">
      {message && (
        <div
          className={cn(
            "flex gap-2.5 rounded-md border px-3.5 py-3 text-sm leading-snug",
            isError ? "border-destructive/30 text-destructive" : "border-primary/30 text-primary",
          )}
        >
          <Icon className="mt-px size-4 shrink-0" aria-hidden />
          <p>{message}</p>
        </div>
      )}
    </div>
  );
};
