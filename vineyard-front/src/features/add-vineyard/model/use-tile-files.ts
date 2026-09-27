import { useCallback, useMemo, useState } from "react";

import { checkTile, type TileCheck } from "../lib/check-tile";

export type TileEntry = { file: File; check: TileCheck };

const DUPLICATE: TileCheck = { status: "invalid", message: "A tile with this name is already added." };

export const useTileFiles = () => {
  const [entries, setEntries] = useState<readonly TileEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const addFiles = useCallback(async (files: readonly File[]) => {
    setIsChecking(true);
    try {
      const checked = await Promise.all(files.map(async file => ({ file, check: await checkTile(file) })));
      setEntries(current => {
        const names = new Set(current.map(entry => entry.file.name));
        const added = checked.map(entry => {
          if (names.has(entry.file.name)) return { ...entry, check: DUPLICATE };
          names.add(entry.file.name);
          return entry;
        });
        return [...current, ...added];
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  const removeTile = useCallback((name: string) => {
    setEntries(current => current.filter(entry => entry.file.name !== name));
  }, []);

  const removeProblems = useCallback(() => {
    setEntries(current => current.filter(entry => entry.check.status === "valid"));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const summary = useMemo(() => {
    const tiles = entries.filter(entry => entry.check.status === "valid").map(entry => entry.file);
    const problems = entries.filter(entry => entry.check.status === "invalid");
    const totalBytes = tiles.reduce((sum, tile) => sum + tile.size, 0);
    return { tiles, problems, totalBytes };
  }, [entries]);

  return { ...summary, isChecking, addFiles, removeTile, removeProblems, clear };
};

export type TileFilesState = ReturnType<typeof useTileFiles>;
