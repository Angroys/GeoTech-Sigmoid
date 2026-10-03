import { LoaderCircle, Search } from "lucide-react";
import { useState, type FC, type FormEvent } from "react";

import { cn } from "@/shared/lib/cn";
import { FormField, Input } from "@/shared/ui";

type ParcelSearchFormProps = {
  isSearching: boolean;
  error: string | undefined;
  onSearch: (cadastralNumber: string) => void;
};

export const ParcelSearchForm: FC<ParcelSearchFormProps> = ({ isSearching, error, onSearch }) => {
  const [value, setValue] = useState("");
  const SearchIcon = isSearching ? LoaderCircle : Search;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(value);
  };

  return (
    <form role="search" noValidate onSubmit={submit} className="max-w-xl">
      <FormField
        label="Cadastral number"
        hint="The 10- or 11-digit number of the parcel, from the cadastre or the owner's documents."
        error={error}
      >
        {control => (
          <div className="relative">
            <Input
              {...control}
              name="cadastralNumber"
              inputMode="numeric"
              autoComplete="off"
              placeholder="80371140111"
              className="pr-11 tabular-nums"
              value={value}
              onChange={event => setValue(event.target.value)}
            />
            <button
              type="submit"
              disabled={isSearching}
              aria-label={isSearching ? "Searching" : "Find parcel"}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md outline-none focus-visible:ring-[3px] disabled:pointer-events-none"
            >
              <SearchIcon
                className={cn("size-[1.125rem]", isSearching && "animate-spin motion-reduce:animate-none")}
                aria-hidden
              />
            </button>
          </div>
        )}
      </FormField>
    </form>
  );
};
