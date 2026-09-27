import { Check, Undo2 } from "lucide-react";
import type { FC } from "react";

import { Button } from "@/shared/ui";

type ReachedToggleProps = {
  isReached: boolean;
  onChange: (isReached: boolean) => void;
};

export const ReachedToggle: FC<ReachedToggleProps> = ({ isReached, onChange }) => {
  if (isReached) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange(false)}>
        <Undo2 aria-hidden />
        Mark as not reached
      </Button>
    );
  }
  return (
    <Button type="button" size="sm" onClick={() => onChange(true)}>
      <Check aria-hidden />
      Mark as reached
    </Button>
  );
};
