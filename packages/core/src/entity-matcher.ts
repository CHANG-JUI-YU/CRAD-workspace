import { computeProjectProjection } from "./project-projection.js";
import type { ProjectState } from "./project-state.js";

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
