import type { FC } from "react";

import { LinkButton } from "./link-button";

type ExpandAllToggleProps = { areAllExpanded: boolean; onToggle: () => void };

export const ExpandAllToggle: FC<ExpandAllToggleProps> = ({ areAllExpanded, onToggle }) => {
  return <LinkButton onClick={onToggle}>{areAllExpanded ? "Collapse all" : "Expand all"}</LinkButton>;
};
