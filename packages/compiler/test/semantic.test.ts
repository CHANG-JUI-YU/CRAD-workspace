import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactKind, type ArtifactRecord } from "@st-workspace/core";
import { compileProject } from "../src/index.js";

function artifact(id: string, key: string, kind: ArtifactKind, name: string, value: unknown): ArtifactRecord {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id, key, kind, name, content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "test", operation_id: "op" };
}

describe("semantic project compilation", () => {
  it("maps mode content and preserves relationships, roster and provenance", async () => {
    const repository = new MemoryProjectRepository("demo");
    const state = await repository.read();
    const artifacts = [
      artifact("character-demo", "character:demo", "character", "Demo", {
        kind: "character",
        document: { schema_version: 1, id: "demo", display_name: "Demo", aliases: [], summary: "The primary character.", relationships: [], sections: [], provenance: [], extensions: {} },
      }),
      artifact("palette-basic", "palette:demo-basic_information", "palette", "demo/basic_information", {
        kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "A precise and calm baseline.", sections: {}, provenance: [], extensions: {} },
      }),
      artifact("palette-personality", "palette:demo-personality_palette", "palette", "demo/personality_palette", {
        kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "personality_palette", title: "Personality", content: "Calm, direct, and observant.", sections: { undercoat: "quiet focus" }, provenance: [], extensions: {} },
      }),
      artifact("palette-other", "palette:other-basic_information", "palette", "other/basic_information", {
        kind: "palette", character_id: "other", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Other", content: "A second roster member.", sections: {}, provenance: [], extensions: {} },
      }),
      artifact("relationship-team", "relationship:team", "relationship", "team", {
        kind: "relationships",
        document: {
          schema_version: 1,
          team_code: "ABC123",
          character_ids: ["demo", "other"],
          character_summaries: [{ character_id: "demo", summary: "The anchor." }, { character_id: "other", summary: "The counterpoint." }],
          perspectives: [{ source_character_id: "demo", target_character_id: "other", summary: "Trusts the counterpoint." }, { source_character_id: "other", target_character_id: "demo", summary: "Challenges the anchor." }],
          groups: [],
          summary: { network_character: "A balanced pair.", inter_group_relations: "None.", stability: "Stable.", conflict_triggers: [], intimacy_opportunities: [] },
          provenance: [],
          extensions: {},
        },
      }),
      artifact("conversion-record", "conversion:demo-zhuji-to-palette", "conversion", "demo/zhuji-to-palette", { kind: "conversion", source_mode: "zhuji", target_mode: "palette", character_id: "demo" }),
    ];
    await repository.commit(state.revision, (current) => ({ ...current, artifacts }));

    const first = compileProject(await repository.read());
    const second = compileProject(await repository.read());
    expect(first.content_hash).toBe(second.content_hash);
    expect(first.card.data.description).toBe("");
    expect(first.card.data.personality).toBe("");
    expect(first.card.data.character_book?.entries).toHaveLength(4);
    expect(first.card.data.character_book?.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "Demo_基本資訊",
      "Demo_性格調色盤",
      "other_基本資訊",
      "關係",
    ]));
    expect(first.card.data.character_book?.entries.some((entry) => entry.content.includes("Trusts the counterpoint."))).toBe(true);
    expect(first.card.data.character_book?.entries.some((entry) => entry.content.includes("demo/zhuji-to-palette"))).toBe(false);
    const workspace = first.card.data.extensions["card-workspace"] as { project?: { primary_character_id?: string; characters?: Array<{ id: string }>; mode_artifacts?: unknown[] } };
    expect(workspace.project?.primary_character_id).toBe("demo");
    expect(workspace.project?.characters?.map((character) => character.id)).toEqual(["demo", "other"]);
    expect(workspace.project?.mode_artifacts).toHaveLength(3);
  });
});
