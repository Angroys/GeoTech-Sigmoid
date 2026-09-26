import { ChevronDown } from "lucide-react";
import type { FC } from "react";

import { AGENCIES, toAgency, type Agency } from "@/entities/agency";
import { cn } from "@/shared/lib/cn";
import { FormField } from "@/shared/ui";

type AgencySelectProps = {
  value: Agency | "";
  error: string | undefined;
  onChange: (agency: Agency | "") => void;
};

export const AgencySelect: FC<AgencySelectProps> = ({ value, error, onChange }) => {
  return (
    <FormField label="Agency" error={error}>
      {control => (
        <div className="relative">
          <select
            {...control}
            name="agency"
            value={value}
            onChange={event => onChange(toAgency(event.target.value))}
            className={cn(
              "border-input bg-popover focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-11 w-full appearance-none rounded-md border px-3 pr-10 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm [&>option]:text-foreground",
              value === "" && "text-muted-foreground",
            )}
          >
            <option value="" disabled>
              Choose your agency
            </option>
            {AGENCIES.map(agency => (
              <option key={agency.value} value={agency.value}>
                {agency.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
            aria-hidden
          />
        </div>
      )}
    </FormField>
  );
};
