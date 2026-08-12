import { describe, expect, it } from "vitest";
import { contentHash, createEntityMatcher, createProjectState, factEntityReferences, factReferencesAnyEntity, validateState, type ArtifactRecord, type FactRecord } from "../src/index.js";

function blueprintArtifact(projectId: string): ArtifactRecord {
  const content = JSON.stringify({
    kind: "blueprint",
    flow: "source_adaptation",
    characters: [
      { id: "character-1", label: "雪之下雪乃", aliases: ["雪乃", "Yukino"] },
      { id: "character-2", label: "比企谷八幡", aliases: ["八幡", "Hachiman"] },
    ],
  });
  const hash = contentHash(content);
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "project-blueprint",
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "director",
    operation_id: "interview",
  };
}

describe("Blueprint entity matcher", () => {
  it("resolves stable ids, labels and aliases to one stable character id", () => {
    const state = createProjectState("entity-matcher");
    state.artifacts = [blueprintArtifact(state.project_id)];
    const matcher = createEntityMatcher(state);
    expect(matcher.resolve("character-1")?.id).toBe("character-1");
    expect(matcher.resolve("雪乃")?.id).toBe("character-1");
    expect(matcher.resolve("HACHIMAN")?.id).toBe("character-2");
    expect(matcher.candidates("missing")).toHaveLength(0);
  });

  it("reads legacy facts that omit entity_refs and backfills an empty list", () => {
    const state = createProjectState("legacy-fact");
    const timestamp = new Date().toISOString();
    const legacyFact: FactRecord = {
      id: "fact-legacy",
      statement: "A character is calm.",
      subject: "A character",
      predicate: "has_property",
      value: "calm",
      classification: "trait",
      status: "candidate",
      confidence: 0.5,
      source_ids: [],
      evidence: ["legacy"],
      created_at: timestamp,
      updated_at: timestamp,
      created_by: "legacy",
    };
    state.facts = [legacyFact];
    expect(validateState(state).facts[0]?.entity_refs).toEqual([]);
  });

  it("resolves fact ids, labels, aliases and legacy subjects through one semantic helper", () => {
    const state = createProjectState("fact-entity-semantics");
    const content = JSON.stringify({
      kind: "blueprint",
      flow: "source_adaptation",
      characters: [{ id: "c02", label: "Alice", aliases: ["Alicia"] }],
    });
    const hash = contentHash(content);
    state.artifacts = [{
      id: "blueprint-fact-entities",
      key: `blueprint:${state.project_id}`,
      kind: "blueprint",
      name: "project-blueprint",
      content,
      media_type: "application/json",
      content_hash: hash,
      revision: hash,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: "director",
      operation_id: "interview",
    }];
    const matcher = createEntityMatcher(state);
    const facts: FactRecord[] = [
      { id: "fact-id", statement: "c02 is calm", subject: "c02", status: "candidate", confidence: 1, source_ids: [], evidence: [], created_at: "now", updated_at: "now", created_by: "test" },
      { id: "fact-label", statement: "Alice is calm", subject: "Alice", status: "candidate", confidence: 1, source_ids: [], evidence: [], created_at: "now", updated_at: "now", created_by: "test" },
      { id: "fact-alias", statement: "Alicia is calm", subject: "Alicia", status: "candidate", confidence: 1, source_ids: [], evidence: [], created_at: "now", updated_at: "now", created_by: "test" },
      { id: "fact-ref", statement: "typed entity is calm", entity_refs: ["c02"], status: "candidate", confidence: 1, source_ids: [], evidence: [], created_at: "now", updated_at: "now", created_by: "test" },
    ];
    for (const fact of facts) {
      expect(factReferencesAnyEntity(fact, matcher, ["c02"])).toBe(true);
      expect(factEntityReferences(fact, matcher)).toEqual(["c02"]);
    }
  });
});
