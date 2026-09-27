import type { RouteStop } from "@/entities/survey";

export const FINDINGS = ["confirmed", "present", "collected", "not_found", "not_checked"] as const;
export type Finding = (typeof FINDINGS)[number];

export const FINDING_LABEL = {
  confirmed: "Confirmed",
  present: "Present",
  collected: "Collected",
  not_found: "Not found",
  not_checked: "Could not check",
} as const satisfies Record<Finding, string>;

export const FINDINGS_BY_KIND = {
  inspection_point: ["confirmed", "not_found", "not_checked"],
  waste: ["present", "collected", "not_found", "not_checked"],
} as const satisfies Record<RouteStop["kind"], readonly Finding[]>;

export const NOTE_MAX_LENGTH = 280;
