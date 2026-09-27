import type { FC, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type ReportSectionProps = { number: number; titleRo: string; titleEn: string; children: ReactNode };

export const ReportSection: FC<ReportSectionProps> = ({ number, titleRo, titleEn, children }) => {
  return (
    <section className="break-inside-avoid-page border-t border-black/15 pt-4 pb-5">
      <h2 className="mb-3 text-[0.9375rem] font-semibold">
        {number}. {titleRo} <span className="font-normal text-black/55">/ {titleEn}</span>
      </h2>
      {children}
    </section>
  );
};

type FieldProps = { label: string; value?: string | null; className?: string };

export const Field: FC<FieldProps> = ({ label, value, className }) => {
  return (
    <div className={cn("grid gap-0.5", className)}>
      <dt className="text-xs text-black/55">{label}</dt>
      <dd className={cn("min-h-6 text-sm", !value && "border-b border-dotted border-black/40")}>{value ?? ""}</dd>
    </div>
  );
};

type ChoiceProps = { label: string };

export const Choice: FC<ChoiceProps> = ({ label }) => {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="size-3.5 border border-black/60" aria-hidden />
      {label}
    </span>
  );
};

type RuledLinesProps = { count: number };

export const RuledLines: FC<RuledLinesProps> = ({ count }) => {
  return (
    <div aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-7 border-b border-dotted border-black/40" />
      ))}
    </div>
  );
};
