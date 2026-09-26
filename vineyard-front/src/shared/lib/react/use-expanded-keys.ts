import { useCallback, useEffect, useState } from "react";

export const useExpandedKeys = <Key extends string>(focusedKey: Key | null) => {
  const [expanded, setExpanded] = useState<ReadonlySet<Key>>(() => new Set());

  useEffect(() => {
    if (focusedKey === null) return;
    setExpanded(current => {
      return current.has(focusedKey) ? current : new Set(current).add(focusedKey);
    });
  }, [focusedKey]);

  const toggle = useCallback((key: Key) => {
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback((keys: readonly Key[]) => setExpanded(new Set(keys)), []);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  return { expanded, toggle, expandAll, collapseAll };
};
