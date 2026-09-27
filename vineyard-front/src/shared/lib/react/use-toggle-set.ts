import { useCallback, useState } from "react";

export const useToggleSet = <Value extends string>(allValues: readonly Value[]) => {
  const [active, setActive] = useState<ReadonlySet<Value>>(() => new Set(allValues));

  const toggle = useCallback((value: Value) => {
    setActive(current => {
      const next = new Set(current);
      if (!next.delete(value)) next.add(value);
      return next;
    });
  }, []);

  return { active, toggle };
};
