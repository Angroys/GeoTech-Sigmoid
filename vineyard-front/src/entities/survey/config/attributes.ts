export const ROW_STRUCTURES = ["regular", "disrupted", "unassessable"] as const;
export type RowStructure = (typeof ROW_STRUCTURES)[number];

export const INTERROW_COVERS = ["bare_soil", "vegetation", "mixed", "unassessable"] as const;
export type InterrowCover = (typeof INTERROW_COVERS)[number];

type HexColor = `#${string}`;
type AttributeStyle = { label: string; color: HexColor };

export const ROW_STRUCTURE_STYLE = {
  regular: { label: "Regular", color: "#f4f2ea" },
  disrupted: { label: "Disrupted", color: "#f2a93b" },
  unassessable: { label: "Unassessable", color: "#9aa39c" },
} as const satisfies Record<RowStructure, AttributeStyle>;

export const INTERROW_COVER_STYLE = {
  bare_soil: { label: "Bare soil", color: "#d4a86a" },
  vegetation: { label: "Vegetation", color: "#8fcf6a" },
  mixed: { label: "Mixed", color: "#c8c46a" },
  unassessable: { label: "Unassessable", color: "#9aa39c" },
} as const satisfies Record<InterrowCover, AttributeStyle>;

export const FEATURE_COLORS = {
  canopy: "#7ccb4a",
  waste: "#ef4b4b",
  inspectionPoint: "#f2a93b",
  route: "#2b4a7e",
  routeCasing: "#ffffff",
  blockOutline: "#ffffff",
  selection: "#ffe066",
} as const satisfies Record<string, HexColor>;
