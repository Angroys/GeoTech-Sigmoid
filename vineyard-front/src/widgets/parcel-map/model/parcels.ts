import type { Role } from "@/entities/role";

type Point = readonly [number, number];

type ParcelSpec = {
  id: string;
  outline: readonly Point[];
  rowAngle: number;
  rowSpacing: number;
};

export type RowLine = { x1: number; y1: number; x2: number; y2: number };

export type Parcel = {
  id: string;
  points: string;
  rows: RowLine[];
};

export type ParcelFocus = {
  parcelId: string;
  title: string;
  detail: string;
};

export const MAP_WIDTH = 600;
export const MAP_HEIGHT = 800;

const PARCEL_SPECS: readonly ParcelSpec[] = [
  {
    id: "5531208.012",
    outline: [
      [40, 60],
      [300, 40],
      [310, 250],
      [60, 280],
    ],
    rowAngle: 82,
    rowSpacing: 11,
  },
  {
    id: "5531208.013",
    outline: [
      [330, 38],
      [570, 20],
      [580, 210],
      [338, 246],
    ],
    rowAngle: 14,
    rowSpacing: 10,
  },
  {
    id: "5531208.017",
    outline: [
      [62, 306],
      [312, 276],
      [322, 470],
      [30, 500],
    ],
    rowAngle: 96,
    rowSpacing: 12,
  },
  {
    id: "5531208.041",
    outline: [
      [342, 272],
      [582, 236],
      [590, 440],
      [350, 468],
    ],
    rowAngle: 68,
    rowSpacing: 10,
  },
  {
    id: "5531208.044",
    outline: [
      [30, 528],
      [324, 496],
      [330, 760],
      [50, 780],
    ],
    rowAngle: 22,
    rowSpacing: 11,
  },
  {
    id: "5531208.052",
    outline: [
      [356, 494],
      [592, 466],
      [596, 772],
      [360, 760],
    ],
    rowAngle: 104,
    rowSpacing: 12,
  },
];

export const PARCEL_FOCUS = {
  owner: {
    parcelId: "5531208.041",
    title: "Your parcel 5531208.041",
    detail: "Fetească Neagră, 2.4 ha",
  },
  inspector: {
    parcelId: "5531208.017",
    title: "Next inspection, parcel 5531208.017",
    detail: "Rara Neagră, 3.1 ha",
  },
} as const satisfies Record<Role, ParcelFocus>;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const round = (value: number) => Math.round(value * 10) / 10;

const buildRows = ({ outline, rowAngle, rowSpacing }: ParcelSpec): RowLine[] => {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const radius = Math.hypot(Math.max(...xs) - centerX, Math.max(...ys) - centerY);

  const angle = toRadians(rowAngle);
  const [alongX, alongY] = [Math.cos(angle), Math.sin(angle)];
  const [acrossX, acrossY] = [-alongY, alongX];

  const rowCount = Math.floor((radius * 2) / rowSpacing);
  return Array.from({ length: rowCount + 1 }, (_, index) => {
    const offset = -radius + index * rowSpacing;
    const midX = centerX + acrossX * offset;
    const midY = centerY + acrossY * offset;
    return {
      x1: round(midX - alongX * radius),
      y1: round(midY - alongY * radius),
      x2: round(midX + alongX * radius),
      y2: round(midY + alongY * radius),
    };
  });
};

export const PARCELS: readonly Parcel[] = PARCEL_SPECS.map(spec => ({
  id: spec.id,
  points: spec.outline.map(point => point.join(",")).join(" "),
  rows: buildRows(spec),
}));
