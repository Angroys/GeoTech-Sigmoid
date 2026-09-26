import type { FC } from "react";

import { useSession } from "@/entities/session";
import type { SurveySource } from "@/entities/survey";
import { RemoveVineyardButton } from "@/features/remove-vineyard";

type UploadNoteProps = { source: SurveySource; uploadedBy: NonNullable<SurveySource["uploadedBy"]> };

export const UploadNote: FC<UploadNoteProps> = ({ source, uploadedBy }) => {
  const session = useSession();
  const isUploader = session?.accountId === uploadedBy.accountId;

  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
      <span>Added by {isUploader ? "you" : uploadedBy.fullName}, stored in this browser</span>
      {isUploader && <RemoveVineyardButton source={source} />}
    </p>
  );
};
