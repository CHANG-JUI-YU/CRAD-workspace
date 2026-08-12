import { computeProjectProjection } from "./project-projection.js";
import type { FactRecord, ProjectState } from "./project-state.js";

export interface BlueprintEntity {
  id: string;
  label: string;
  aliases: string[];
}

export interface EntityMatch {
  id: string;
  label: string;
  matched_by: string;
}

export interface EntityMatcher {
  readonly entities: readonly BlueprintEntity[];
  candidates(value: string): readonly EntityMatch[];
  resolve(value: string): EntityMatch | undefined;
}

export type EntityReferencingFact = Pick<FactRecord, "subject" | "entity_refs">;

export function normalizeEntityReference(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function blueprintEntities(state: ProjectState): BlueprintEntity[] {
  return computeProjectProjection(state).intent.roster.map((character) => ({
    id: character.id,
    label: character.label,
    aliases: [...character.aliases],
  }));
}

export function createEntityMatcher(state: ProjectState): EntityMatcher {
  const entities = blueprintEntities(state);
  const byName = new Map<string, EntityMatch[]>();
  for (const entity of entities) {
    for (const name of [entity.id, entity.label, ...entity.aliases]) {
      const key = normalizeEntityReference(name);
      if (key.length === 0) continue;
      const entries = byName.get(key) ?? [];
      if (!entries.some((entry) => entry.id === entity.id)) entries.push({ id: entity.id, label: entity.label, matched_by: name });
      byName.set(key, entries);
    }
  }
  return {
    entities,
    candidates(value: string): readonly EntityMatch[] {
      return [...(byName.get(normalizeEntityReference(value)) ?? [])];
    },
    resolve(value: string): EntityMatch | undefined {
      const matches = byName.get(normalizeEntityReference(value)) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    },
  };
}

/**
 * Resolve one persisted entity reference to its stable Blueprint id.
 *
 * Unknown values are retained for legacy states that have no Blueprint entity
 * index yet. Ambiguous labels/aliases are intentionally not resolved.
 */
export function canonicalEntityReference(matcher: EntityMatcher, value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const matches = matcher.candidates(trimmed);
  if (matches.length > 1) return undefined;
  return matches[0]?.id ?? trimmed;
}

/** Resolve a list of ids, labels and aliases to stable ids where possible. */
export function resolveEntityReferences(matcher: EntityMatcher, values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => {
    const resolved = canonicalEntityReference(matcher, value);
    return resolved === undefined ? [] : [resolved];
  }))];
}

/**
 * Return all entities referred to by a fact. Both legacy `subject` values and
 * typed `entity_refs` participate, so old and new fact records share one
 * matching rule.
 */
export function factEntityReferences(fact: EntityReferencingFact, matcher: EntityMatcher): string[] {
  return resolveEntityReferences(matcher, [
    ...(fact.subject === undefined ? [] : [fact.subject]),
    ...(fact.entity_refs ?? []),
  ]);
}

export function factReferencesEntity(fact: EntityReferencingFact, matcher: EntityMatcher, entity: string): boolean {
  const target = canonicalEntityReference(matcher, entity);
  if (target === undefined) return false;
  return factEntityReferences(fact, matcher).includes(target);
}

export function factReferencesAnyEntity(fact: EntityReferencingFact, matcher: EntityMatcher, entities: readonly string[]): boolean {
  const targets = new Set(resolveEntityReferences(matcher, entities));
  if (targets.size === 0) return false;
  return factEntityReferences(fact, matcher).some((entity) => targets.has(entity));
}
