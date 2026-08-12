import { describe, expect, it } from "vitest";
import { artifactBinding, contentHash, createProjectState, computeBuildPlan, type ArtifactRecord } from "../src/index.js";

function artifact(kind: ArtifactRecord["kind"], key: string, content: unknown, name = "artifact"): ArtifactRecord {
  const serialized = typeof content === "string" ? content : JSON.stringify(content);
  const hash = contentHash(serialized);
  return {
    id: `${kind}-1`, key, kind, name, content: serialized, media_type: "application/json",
    content_hash: hash, revision: hash, status: "draft", created_at: "now", updated_at: "now",
    created_by: "test", operation_id: "op-test",
  };
}

describe("artifact binding", () => {
  it("prefers structured character and module ownership over legacy keys", () => {
    expect(artifactBinding(artifact("character", "character:wrong", { document: { id: "character-1", display_name: "Alice" } }))).toEqual({ characterIds: ["character-1"], global: false });
    expect(artifactBinding(artifact("zhuji", "zhuji:wrong/appearance", { character_id: "character-2", module: { module: "appearance" } }))).toEqual({ characterIds: ["character-2"], global: false });
    expect(artifactBinding(artifact("palette", "palette:wrong/basic_information", { character_id: "character-3", module: { module: "basic_information" } }))).toEqual({ characterIds: ["character-3"], global: false });
    expect(artifactBinding(artifact("wardrobe", "wardrobe:wrong", { character_id: "character-4" }))).toEqual({ characterIds: ["character-4"], global: false });
  });

  it("flattens every greeting participant and keeps greetings project-global", () => {
    expect(artifactBinding(artifact("greeting", "greeting:legacy", {
      document: { greetings: [
        { character_ids: ["character-1", "character-2"] },
        { character_ids: ["character-2", "character-9"] },
      ] },
    }))).toEqual({ characterIds: ["character-1", "character-2", "character-9"], global: true });
  });

  it("decodes production escaped legacy keys reversibly", () => {
    expect(artifactBinding(artifact("character", "character:alice_002ea", "legacy character"))).toEqual({ characterIds: ["alice.a"], global: false });
    expect(artifactBinding(artifact("zhuji", "zhuji:_96ea_4e4b_4e0b/appearance", "legacy module"))).toEqual({ characterIds: ["雪之下"], global: false });
  });

  it("does not exclude a project-global greeting when a participant is outside the roster", () => {
    const state = createProjectState("greeting-global");
    const blueprint = artifact("blueprint", "blueprint:greeting-global", { flow: "source_adaptation", characters: [{ id: "character-1", label: "Alice", mode: "zhuji" }] });
    const greeting = artifact("greeting", "greeting:project", { document: { greetings: [{ character_ids: ["outsider"] }] } });
    state.artifacts = [blueprint, greeting];
    state.interview.flow = "source_adaptation";
    expect(computeBuildPlan(state, "both").entries.map((entry) => entry.artifact_id)).toContain(greeting.id);
  });
});
