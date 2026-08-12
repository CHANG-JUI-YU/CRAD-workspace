import { canonicalJson, contentHash } from "./core-utilities.js";
import type { ArtifactRecord, FactRecord, ProjectState } from "./project-state.js";

export const ARTIFACT_DEPENDENCY_FINGERPRINT_VERSION = 1;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseArtifact(artifact: ArtifactRecord): Record<string, unknown> | undefined {
  try { return record(JSON.parse(artifact.content)); } catch { return undefined; }
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined; }

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function modeCharacterId(artifact: ArtifactRecord): string | undefined {
  const parsed = parseArtifact(artifact);
  return stringValue(parsed?.character_id) ?? stringValue(record(parsed?.module)?.character_id) ?? stringValue(artifact.name.split("/")[0]);
}

function artifactCharacterId(artifact: ArtifactRecord): string | undefined {
  const parsed = parseArtifact(artifact);
  return stringValue(record(parsed?.document)?.id) ?? modeCharacterId(artifact);
}

function latestBlueprint(state: ProjectState): Record<string, unknown> | undefined {
  const artifact = [...state.artifacts].reverse().find((candidate) => candidate.kind === "blueprint");
  return artifact === undefined ? undefined : parseArtifact(artifact);
}

function blueprintCharacterSlice(blueprint: Record<string, unknown> | undefined, characterId: string | undefined): unknown {
  if (blueprint === undefined || characterId === undefined) return blueprint;
  const roster = record(blueprint.roster) ?? record(blueprint.characters);
  const characters = Array.isArray(roster?.characters) ? roster.characters : Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const selected = characters.filter((item) => {
    const value = record(item);
    return stringValue(value?.id) === characterId || stringValue(value?.character_id) === characterId;
  });
  return { character_id: characterId, entries: selected };
}

function factSlice(state: ProjectState, predicate: (fact: FactRecord) => boolean): unknown[] {
  return state.facts.filter((fact) => fact.status === "accepted" && predicate(fact)).map((fact) => ({
    id: fact.id,
    fact_revision: fact.fact_revision,
    accepted_fact_revision: fact.accepted_fact_revision,
    evidence_revision: fact.evidence_revision,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    classification: fact.classification,
    coverage: fact.coverage,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function relationshipParticipants(artifact: ArtifactRecord): string[] {
  const document = record(parseArtifact(artifact)?.document) ?? parseArtifact(artifact);
  return stringValues(document?.character_ids).sort();
}

/**
 * Calculate only the inputs that can invalidate an artifact. The artifact's
 * own content is intentionally excluded: a new authored revision receives a
 * new fingerprint for the dependencies it consumed.
 */
export function artifactDependencyFingerprint(state: ProjectState, artifact: ArtifactRecord): string {
  const blueprint = latestBlueprint(state);
  const characterId = artifactCharacterId(artifact);
  const participants = relationshipParticipants(artifact);
  const payload: Record<string, unknown> = {
    version: ARTIFACT_DEPENDENCY_FINGERPRINT_VERSION,
    kind: artifact.kind,
    key: artifact.key,
  };
  if (artifact.kind === "blueprint") {
    payload.blueprint = parseArtifact(artifact);
  } else if (artifact.kind === "character" || artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe") {
    payload.blueprint = blueprintCharacterSlice(blueprint, characterId);
    payload.facts = factSlice(state, (fact) => fact.subject === characterId || (characterId !== undefined && fact.coverage?.includes(characterId) === true));
    payload.character_id = characterId;
  } else if (artifact.kind === "world_lore") {
    payload.world = parseArtifact(artifact)?.document ?? parseArtifact(artifact)?.entries;
    payload.facts = factSlice(state, (fact) => fact.classification === "world" || fact.coverage?.includes("world_context") === true);
  } else if (artifact.kind === "relationship") {
    payload.participants = participants;
    payload.facts = factSlice(state, (fact) => fact.classification === "relationship" && (fact.subject === undefined || participants.includes(fact.subject)));
  } else if (artifact.kind === "greeting") {
    const primary = stringValue(record(blueprint?.primary_character)?.id) ?? stringValue(blueprint?.primary_character_id);
    payload.primary_character_id = primary;
    payload.participants = participants;
    payload.blueprint = blueprintCharacterSlice(blueprint, primary);
  } else {
    payload.blueprint_revision = contentHash(canonicalJson(blueprint ?? {}));
  }
  return contentHash(canonicalJson(payload));
}

/** Fill fingerprints only for legacy/new records that do not have one. */
export function backfillArtifactDependencyFingerprints(state: ProjectState): ProjectState {
  let changed = false;
  const artifacts = state.artifacts.map((artifact) => {
    if (artifact.dependency_fingerprint !== undefined) return artifact;
    changed = true;
    return { ...artifact, dependency_fingerprint: artifactDependencyFingerprint(state, artifact) };
  });
  return changed ? { ...state, artifacts } : state;
}
