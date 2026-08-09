import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactRecord, type OperationRecord, type TemplateProposalValue } from "@st-workspace/core";
import { ConversionService } from "../src/index.js";

function operation(id: string): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind: "authoring", request: "conversion", status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function artifact(id: string, key: string, kind: "zhuji" | "palette", value: unknown): ArtifactRecord {
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id, key, kind, name: key, content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "creator", operation_id: "source-operation" };
}

const paletteModule = {
  schema_version: 1 as const,
  mode: "palette" as const,
  module: "basic_information" as const,
  title: "Basic information",
  content: "A calm and observant character.",
  sections: {},
  provenance: [],
  extensions: {},
};

const conversion: Extract<TemplateProposalValue, { kind: "conversion" }> = {
  kind: "conversion",
  character_id: "demo",
  source_mode: "zhuji",
  target_mode: "palette",
  modules: [paletteModule],
  mappings: [{ source: "appearance", target: "basic_information", summary: "Maps the stable appearance core.", provenance: "authored", expected_loss: "none" }],
  unmapped: [],
};

const zhujiTarget = {
  schema_version: 1 as const,
  mode: "zhuji" as const,
  module: "trait_dialogue" as const,
  title: "Trait dialogue",
  data: {
    "人物說話節奏": "A clear response pattern.",
    "人物語言習慣": { "自稱": "Direct", "口頭禪": "Calm", "特殊詞彙偏好": "Measured", "方言痕跡": "Honest", "語氣助詞使用": "Reliable", "語言情感程度": "Focused", "用詞程度選擇": "Stable" },
    "扮演關鍵要點": ["Responds with calm directness."],
    Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `Trait ${index + 1}`, Embodiments: ["Visible in dialogue."], instant: ["When pressure rises, she answers clearly and stays calm."], Results: ["The scene remains grounded."] })),
  },
  provenance: [],
  extensions: {},
};

describe("mode conversion materialization", () => {
  it("materializes target drafts without changing the source and reuses identical revisions", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [operation("op-convert" )],
      artifacts: [artifact("source-zhuji", "zhuji:demo-appearance", "zhuji", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Stable source content." } } })],
    }));
    const service = new ConversionService(repository);
    const first = await service.materialize("op-convert", conversion, "mode-conversion");
    const afterFirst = await repository.read();
    const sourceBefore = afterFirst.artifacts.find((item) => item.id === "source-zhuji")!;
    const target = afterFirst.artifacts.find((item) => item.kind === "palette")!;
    expect(first.target_artifact_ids).toEqual([target.id]);
    expect(target.status).toBe("draft");
    expect(target.based_on).toBeUndefined();
    expect(JSON.parse(target.content).module.extensions["card-workspace"].conversion.mapping_digest).toBeDefined();
    expect(sourceBefore.content).toContain("Stable source content.");
    expect(afterFirst.audit.at(-1)?.event).toBe("conversion.materialized");

    await repository.commit(afterFirst.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-convert-again")] }));
    const second = await service.materialize("op-convert-again", conversion, "mode-conversion");
    const afterSecond = await repository.read();
    expect(second.artifact_ids).toEqual(first.artifact_ids);
    expect(afterSecond.artifacts.filter((item) => item.kind === "palette")).toHaveLength(1);
  });

  it("fails closed when the source mode is absent and writes nothing", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-missing-source")] }));
    const before = await repository.read();
    await expect(new ConversionService(repository).materialize("op-missing-source", conversion, "mode-conversion")).rejects.toMatchObject({ code: "CONVERSION_SOURCE_NOT_FOUND" });
    const after = await repository.read();
    expect(after.revision).toBe(before.revision);
    expect(after.artifacts).toEqual(before.artifacts);
  });

  it("materializes the reverse palette-to-zhuji direction", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [operation("op-reverse")],
      artifacts: [artifact("source-palette", "palette:demo-basic_information", "palette", { kind: "palette", character_id: "demo", module: paletteModule })],
    }));
    const reverse: Extract<TemplateProposalValue, { kind: "conversion" }> = {
      kind: "conversion",
      character_id: "demo",
      source_mode: "palette",
      target_mode: "zhuji",
      modules: [zhujiTarget],
      mappings: [{ source: "basic_information", target: "trait_dialogue", summary: "Maps the palette baseline into dialogue behavior." }],
      unmapped: [],
    };
    const result = await new ConversionService(repository).materialize("op-reverse", reverse, "mode-conversion");
    const state = await repository.read();
    expect(result.target_artifact_ids).toHaveLength(1);
    expect(state.artifacts.find((item) => item.id === result.target_artifact_ids[0])).toMatchObject({ kind: "zhuji", name: "demo/trait_dialogue", status: "draft" });
  });
});
