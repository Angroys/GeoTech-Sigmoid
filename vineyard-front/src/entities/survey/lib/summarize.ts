import type { RowProperties, Survey, VineyardId } from "../model/types";

export type BlockSummary = {
  vineyardId: VineyardId;
  rowCount: number;
  rowLengthM: number;
  canopyCount: number;
  canopyAreaM2: number;
  interrowAreaM2: number;
};

export type SurveySummary = {
  blockCount: number;
  rowCount: number;
  rowLengthM: number;
  canopyCount: number;
  canopyAreaM2: number;
  interrowAreaM2: number;
  blocks: BlockSummary[];
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const emptyBlock = (vineyardId: VineyardId): BlockSummary => {
  return { vineyardId, rowCount: 0, rowLengthM: 0, canopyCount: 0, canopyAreaM2: 0, interrowAreaM2: 0 };
};

export const summarizeSurvey = (survey: Survey): SurveySummary => {
  const blocks = new Map(
    survey.blocks.features.map(({ properties }) => [properties.vineyard_id, emptyBlock(properties.vineyard_id)]),
  );
  const blockFor = (vineyardId: VineyardId) => {
    const existing = blocks.get(vineyardId);
    if (existing) return existing;
    const created = emptyBlock(vineyardId);
    blocks.set(vineyardId, created);
    return created;
  };

  for (const { properties } of survey.rows.features) {
    const block = blockFor(properties.vineyard_id);
    block.rowCount += 1;
    block.rowLengthM += properties.length_m;
  }
  for (const { properties } of survey.canopy.features) {
    const block = blockFor(properties.vineyard_id);
    block.canopyCount += 1;
    block.canopyAreaM2 += properties.area_m2;
  }
  for (const { properties } of survey.interrows.features) {
    blockFor(properties.vineyard_id).interrowAreaM2 += properties.area_m2;
  }

  const blockList = [...blocks.values()].sort((a, b) => a.vineyardId.localeCompare(b.vineyardId));
  return {
    blockCount: blockList.length,
    rowCount: survey.rows.features.length,
    rowLengthM: sum(blockList.map(block => block.rowLengthM)),
    canopyCount: survey.canopy.features.length,
    canopyAreaM2: sum(blockList.map(block => block.canopyAreaM2)),
    interrowAreaM2: sum(blockList.map(block => block.interrowAreaM2)),
    blocks: blockList,
  };
};

export const groupRowsByBlock = (survey: Survey): Map<VineyardId, RowProperties[]> => {
  const groups = new Map<VineyardId, RowProperties[]>();
  for (const { properties } of survey.rows.features) {
    groups.set(properties.vineyard_id, [...(groups.get(properties.vineyard_id) ?? []), properties]);
  }
  return groups;
};
