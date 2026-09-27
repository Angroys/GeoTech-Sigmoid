import { useMemo } from "react";

import {
  groupRowsByBlock,
  ROW_STRUCTURES,
  type RowProperties,
  type RowStructure,
  type Survey,
  type VineyardId,
} from "@/entities/survey";

export type BlockGroup = {
  vineyardId: VineyardId;
  rows: RowProperties[];
  rowLengthM: number;
  disruptedCount: number;
};

export const useBlockGroups = (survey: Survey, visibleStructures: ReadonlySet<RowStructure>) => {
  const allGroups = useMemo(() => [...groupRowsByBlock(survey)], [survey]);

  const structureCounts = useMemo(() => {
    const counts: Record<RowStructure, number> = { regular: 0, disrupted: 0, unassessable: 0 };
    for (const [, rows] of allGroups) for (const row of rows) counts[row.row_structure] += 1;
    return ROW_STRUCTURES.map(structure => {
      return { structure, count: counts[structure] };
    });
  }, [allGroups]);

  const filtered = useMemo(() => {
    const groups: BlockGroup[] = allGroups
      .map(([vineyardId, rows]) => {
        const visibleRows = rows.filter(row => visibleStructures.has(row.row_structure));
        return {
          vineyardId,
          rows: visibleRows,
          rowLengthM: visibleRows.reduce((total, row) => total + row.length_m, 0),
          disruptedCount: visibleRows.filter(row => row.row_structure === "disrupted").length,
        };
      })
      .filter(group => group.rows.length > 0);
    const rowCount = groups.reduce((total, group) => total + group.rows.length, 0);
    return { groups, rowCount };
  }, [allGroups, visibleStructures]);

  return { ...filtered, blockCount: allGroups.length, structureCounts };
};
