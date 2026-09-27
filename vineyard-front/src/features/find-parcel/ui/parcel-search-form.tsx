import { Search } from "lucide-react";
import { useState, type FC, type FormEvent } from "react";

import { Button, TextField } from "@/shared/ui";

type ParcelSearchFormProps = {
  isSearching: boolean;
  error: string | undefined;
  onSearch: (cadastralNumber: string) => void;
};

export const ParcelSearchForm: FC<ParcelSearchFormProps> = ({ isSearching, error, onSearch }) => {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(value);
  };

  return (
    <form role="search" noValidate onSubmit={submit} className="flex flex-wrap items-start gap-3">
      <div className="min-w-60 flex-1">
        <TextField
          label="Cadastral number"
          hint="The 10-digit number of the parcel, from the cadastre or the owner's documents."
          error={error}
          name="cadastralNumber"
          inputMode="numeric"
          autoComplete="off"
          placeholder="3631204101"
          className="tabular-nums"
          value={value}
          onValueChange={setValue}
        />
      </div>
      <Button type="submit" size="lg" className="mt-7" disabled={isSearching}>
        <Search aria-hidden />
        {isSearching ? "Searching" : "Find parcel"}
      </Button>
    </form>
  );
};
