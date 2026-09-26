import { useCallback, useEffect, useState } from "react";

export const useExpandableGroups = <Key extends string>(keys: readonly Key[], focusedKey: Key | null) => {
  const [expanded, setExpanded] = useState<ReadonlySet<Key>>(() => new Set());

  useEffect(() => {
    if (focusedKey === null) return;
    setExpanded(current => (current.has(focusedKey) ? current : new Set(current).add(focusedKey)));
  }, [focusedKey]);

  const toggle = useCallback((key: Key) => {
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const areAllExpanded = keys.length > 0 && keys.every(key => expanded.has(key));
  const toggleAll = () => setExpanded(areAllExpanded ? new Set() : new Set(keys));
  const isExpanded = (key: Key) => expanded.has(key);

  return { isExpanded, toggle, areAllExpanded, toggleAll };
};
