import type {
  Fact,
  FactCandidate,
  FactCoverageDimension,
  ProjectCharacter,
} from "@card-workspace/schemas";

export const FACT_PLACEHOLDER_MARKERS = [
  "test",
  "test-char",
  "placeholder",
  "dummy",
  "fixture",
  "測試",
  "佔位",
] as const;

export interface CandidateQualityDiagnostic {
  code: "CANDIDATE_PLACEHOLDER_FORBIDDEN";
  candidate_id: string;
  path: string;
  value: string;
}

function normalizedMarker(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function semanticStrings(value: unknown, path: string): Array<{ path: string; value: string }> {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => semanticStrings(item, `${path}[${index}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => semanticStrings(item, `${path}.${key}`));
  }
  return [];
}

export function diagnoseFactCandidateQuality(candidate: FactCandidate): CandidateQualityDiagnostic[] {
  const markers = new Set<string>(FACT_PLACEHOLDER_MARKERS);
  const values = [
    { path: "subject", value: candidate.subject },
    { path: "predicate", value: candidate.predicate },
    { path: "created_by", value: candidate.created_by },
    ...semanticStrings(candidate.value, "value"),
    ...(candidate.rationale === undefined ? [] : [{ path: "rationale", value: candidate.rationale }]),
  ];
  return values
    .filter((item) => markers.has(normalizedMarker(item.value)))
    .map((item) => ({
      code: "CANDIDATE_PLACEHOLDER_FORBIDDEN" as const,
      candidate_id: candidate.id,
      path: item.path,
      value: item.value,
    }));
}

const PRIMARY_REQUIRED: readonly FactCoverageDimension[] = [
  "identity", "personality", "speech", "habits", "background", "relationships",
];
const PRIMARY_ALTERNATIVES: readonly FactCoverageDimension[] = [
  "appearance", "goals", "abilities", "world_context",
];
const SUPPORTING_REQUIRED: readonly FactCoverageDimension[] = [
  "identity", "personality", "relationships",
];

export interface CharacterFactsCoverage {
  character_id: string;
  role: ProjectCharacter["role"];
  covered_dimensions: FactCoverageDimension[];
  missing_required_dimensions: FactCoverageDimension[];
  alternative_dimensions: FactCoverageDimension[];
  alternative_satisfied: boolean;
  ready: boolean;
}

export interface FactsCoverageReport {
  characters: CharacterFactsCoverage[];
  gate_ready: boolean;
}

export interface BuildFactsCoverageReportInput {
  characters: readonly ProjectCharacter[];
  facts: readonly Fact[];
  activeCandidates: ReadonlyMap<string, FactCandidate>;
  candidateFactIds: ReadonlyMap<string, string>;
}

export function buildFactsCoverageReport(input: BuildFactsCoverageReportInput): FactsCoverageReport {
  const acceptedFactIds = new Set(input.facts
    .filter((fact) => fact.status === "accepted" && fact.classification !== "creative_completion")
    .map((fact) => fact.id));
  const dimensionsByCharacter = new Map<string, Set<FactCoverageDimension>>();

  for (const [candidateId, factId] of input.candidateFactIds) {
    const candidate = input.activeCandidates.get(candidateId);
    if (!candidate || !acceptedFactIds.has(factId) || candidate.classification === "creative_completion") continue;
    const characterIds = new Set([candidate.subject, ...candidate.scope.character_ids]);
    for (const characterId of characterIds) {
      const dimensions = dimensionsByCharacter.get(characterId) ?? new Set<FactCoverageDimension>();
      candidate.coverage_dimensions?.forEach((dimension) => dimensions.add(dimension));
      dimensionsByCharacter.set(characterId, dimensions);
    }
  }

  const characters = input.characters.map((character): CharacterFactsCoverage => {
    const covered = dimensionsByCharacter.get(character.id) ?? new Set<FactCoverageDimension>();
    const required = character.role === "primary" ? PRIMARY_REQUIRED : SUPPORTING_REQUIRED;
    const alternatives = character.role === "primary" ? PRIMARY_ALTERNATIVES.filter((item) => covered.has(item)) : [];
    const missing = required.filter((item) => !covered.has(item));
    const alternativeSatisfied = character.role !== "primary" || alternatives.length > 0;
    return {
      character_id: character.id,
      role: character.role,
      covered_dimensions: [...covered].sort(),
      missing_required_dimensions: missing,
      alternative_dimensions: alternatives,
      alternative_satisfied: alternativeSatisfied,
      ready: missing.length === 0 && alternativeSatisfied,
    };
  });
  return { characters, gate_ready: characters.every((character) => character.ready) };
}
