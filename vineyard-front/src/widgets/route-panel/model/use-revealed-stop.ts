import { useEffect, useState } from "react";

import type { TargetId } from "@/entities/survey";

export const useRevealedStop = (selectedTargetId: TargetId | null) => {
  const [revealedId, setRevealedId] = useState<TargetId | null>(selectedTargetId);

  useEffect(() => {
    setRevealedId(selectedTargetId);
  }, [selectedTargetId]);

  const forgetRevealed = () => setRevealedId(null);

  return { revealedId, forgetRevealed };
};
