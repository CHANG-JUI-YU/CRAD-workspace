import { canonicalJson, contentHash } from "./core-utilities.js";
import { canonicalEntityReference, createEntityMatcher, factReferencesAnyEntity, resolveEntityReferences, type EntityMatcher } from "./entity-matcher.js";
import type { ArtifactRecord, FactRecord, ProjectState } from "./project-state.js";

export const ARTIFACT_DEPENDENCY_FINGERPRINT_VERSION = 2;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseArtifact(artifact: ArtifactRecord): Record<string, unknown> | undefined {
  try { return record(JSON.parse(artifact.content)); } catch { return undefined; }
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined; }

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function modeCharacterId(artifact: ArtifactRecord): string | undefined {
  const parsed = parseArtifact(artifact);
  return stringValue(parsed?.character_id) ?? stringValue(record(parsed?.module)?.character_id) ?? stringValue(artifact.name.split("/")[0]);
}

function artifactCharacterId(artifact: ArtifactRecord, matcher: EntityMatcher): string | undefined {
  const parsed = parseArtifact(artifact);
  const raw = stringValue(record(parsed?.document)?.id) ?? modeCharacterId(artifact);
  return raw === undefined ? undefined : canonicalEntityReference(matcher, raw);
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

function factSlice(state: ProjectState, matcher: EntityMatcher, predicate: (fact: FactRecord) => boolean): unknown[] {
  return state.facts.filter((fact) => fact.status === "accepted" && predicate(fact)).map((fact) => ({
    id: fact.id,
    fact_revision: fact.fact_revision,
    accepted_fact_revision: fact.accepted_fact_revision,
    evidence_revision: fact.evidence_revision,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    classification: fact.classification,
    entity_refs: fact.entity_refs,
    coverage: fact.coverage,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function artifactDocument(artifact: ArtifactRecord): Record<string, unknown> | undefined {
  const parsed = parseArtifact(artifact);
  return record(parsed?.document) ?? parsed;
}

function relationshipParticipants(artifact: ArtifactRecord, matcher: EntityMatcher): string[] {
  return resolveEntityReferences(matcher, stringValues(artifactDocument(artifact)?.character_ids)).sort();
}

function greetingParticipants(artifact: ArtifactRecord, matcher: EntityMatcher): string[] {
  const greetings = artifactDocument(artifact)?.greetings;
  if (!Array.isArray(greetings)) return [];
  const rawParticipants = greetings.flatMap((greeting) => stringValues(record(greeting)?.character_ids));
  return resolveEntityReferences(matcher, rawParticipants).sort();
}

/**
 * Calculate only the inputs that can invalidate an artifact. The artifact's
 * own content is intentionally excluded: a new authored revision receives a
 * new fingerprint for the dependencies it consumed.
 */
export function artifactDependencyFingerprint(state: ProjectState, artifact: ArtifactRecord): string {
  const matcher = createEntityMatcher(state);
  const blueprint = latestBlueprint(state);
  const characterId = artifactCharacterId(artifact, matcher);
  const participants = artifact.kind === "greeting"
    ? greetingParticipants(artifact, matcher)
    : relationshipParticipants(artifact, matcher);
  const payload: Record<string, unknown> = {
    version: ARTIFACT_DEPENDENCY_FINGERPRINT_VERSION,
    kind: artifact.kind,
    key: artifact.key,
  };
  if (artifact.kind === "blueprint") {
    payload.blueprint = parseArtifact(artifact);
  } else if (artifact.kind === "character" || artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe") {
    payload.blueprint = blueprintCharacterSlice(blueprint, characterId);
    payload.facts = factSlice(state, matcher, (fact) => characterId !== undefined && factReferencesAnyEntity(fact, matcher, [characterId]));
    payload.character_id = characterId;
  } else if (artifact.kind === "world_lore") {
    payload.world = parseArtifact(artifact)?.document ?? parseArtifact(artifact)?.entries;
    payload.facts = factSlice(state, matcher, (fact) => fact.classification === "world" || fact.coverage?.includes("world_context") === true);
  } else if (artifact.kind === "relationship") {
    payload.participants = participants;
    payload.facts = factSlice(state, matcher, (fact) => fact.classification === "relationship" && (
      factReferencesAnyEntity(fact, matcher, participants)
      || (fact.subject === undefined && (fact.entity_refs ?? []).length === 0)
    ));
  } else if (artifact.kind === "greeting") {
    const rawPrimary = stringValue(record(blueprint?.primary_character)?.id) ?? stringValue(blueprint?.primary_character_id);
    const primary = rawPrimary === undefined ? undefined : canonicalEntityReference(matcher, rawPrimary);
    payload.primary_character_id = primary;
    payload.participants = participants;
    payload.blueprint = blueprintCharacterSlice(blueprint, primary);
    payload.facts = factSlice(state, matcher, (fact) => factReferencesAnyEntity(fact, matcher, participants));
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
