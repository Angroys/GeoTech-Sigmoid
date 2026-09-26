import { useCallback, useState } from "react";

import { NO_SELECTION, type SurveySelection } from "./types";

type SelectionState = { selection: SurveySelection; origin: "map" | "list" };

export const useSurveySelection = (initialSelection: SurveySelection = NO_SELECTION) => {
  const [state, setState] = useState<SelectionState>(() => {
    return { selection: initialSelection, origin: initialSelection.kind === "none" ? "list" : "map" };
  });

  const selectFromMap = useCallback((selection: SurveySelection) => setState({ selection, origin: "map" }), []);
  const selectFromList = useCallback((selection: SurveySelection) => setState({ selection, origin: "list" }), []);

  return {
    selection: state.selection,
    shouldRevealInLists: state.origin === "map",
    selectFromMap,
    selectFromList,
  };
};
