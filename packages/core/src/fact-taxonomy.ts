import type { FactClassification } from "./project-state.js";

/** Canonical dimensions used by typed facts and publish coverage gates. */
export const FACT_COVERAGE_DIMENSIONS = [
  "identity",
  "personality",
  "speech",
  "habits",
  "background",
  "relationships",
  "world_context",
  "appearance",
  "goals",
  "abilities",
] as const;

export type FactCoverageDimension = typeof FACT_COVERAGE_DIMENSIONS[number];

/** Kept only so legacy template payloads remain readable at the boundary. */
export const LEGACY_FACT_COVERAGE_DIMENSIONS = ["character"] as const;
export type FactCoverageInput = FactCoverageDimension | typeof LEGACY_FACT_COVERAGE_DIMENSIONS[number];

export const FACT_CLASSIFICATION_COVERAGE: Readonly<Partial<Record<FactClassification, FactCoverageDimension>>> = {
  identity: "identity",
  trait: "personality",
  event: "background",
  relationship: "relationships",
  world: "world_context",
};

export function isFactCoverageDimension(value: string): value is FactCoverageDimension {
  return (FACT_COVERAGE_DIMENSIONS as readonly string[]).includes(value);
}

export function isFactCoverageInput(value: string): value is FactCoverageInput {
  return isFactCoverageDimension(value) || (LEGACY_FACT_COVERAGE_DIMENSIONS as readonly string[]).includes(value);
}

export function requiredCoverageForClassification(classification: FactClassification): FactCoverageDimension | undefined {
  return FACT_CLASSIFICATION_COVERAGE[classification];
}
