import { useState, type FC } from "react";

import { removeUploadedVineyard, type SurveySource } from "@/entities/survey";
import { LinkButton } from "@/shared/ui";

type RemoveVineyardButtonProps = { source: SurveySource };

export const RemoveVineyardButton: FC<RemoveVineyardButtonProps> = ({ source }) => {
  const [isRemoving, setIsRemoving] = useState(false);

  const remove = async () => {
    const isConfirmed = window.confirm(
      `Remove ${source.name} and its survey data from this browser? This cannot be undone.`,
    );
    if (!isConfirmed) return;
    setIsRemoving(true);
    try {
      await removeUploadedVineyard(source.id);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <LinkButton onClick={remove} disabled={isRemoving} className="text-destructive">
      {isRemoving ? "Removing" : "Remove"}
    </LinkButton>
  );
};
