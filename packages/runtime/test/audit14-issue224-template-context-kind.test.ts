import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type ArtifactKind,
  type TemplateKind,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

type JsonContextCase = {
  templateKind: Exclude<TemplateKind, "zhuji" | "wardrobe">;
  artifactKind: ArtifactKind;
  value: Record<string, unknown>;
};

const JSON_CONTEXT_CASES: readonly JsonContextCase[] = [
  { templateKind: "character", artifactKind: "character", value: { kind: "character", document: { id: "character-valid", display_name: "Character" } } },
  { templateKind: "palette", artifactKind: "palette", value: { kind: "palette", character_id: "character-valid" } },
  { templateKind: "greetings", artifactKind: "greeting", value: { kind: "greetings", document: { greetings: [{ character_ids: ["character-valid"] }] } } },
  { templateKind: "relationships", artifactKind: "relationship", value: { kind: "relationships", document: { character_ids: ["character-valid", "character-two"] } } },
  { templateKind: "world", artifactKind: "world_lore", value: { kind: "world", document_id: "world-valid", entries: [] } },
  { templateKind: "conversion", artifactKind: "conversion", value: { kind: "conversion", character_id: "character-valid" } },
  { templateKind: "import_analysis", artifactKind: "import_analysis", value: { kind: "import_analysis", mappings: [] } },
  { templateKind: "review", artifactKind: "review", value: { kind: "review", target: { kind: "character", name: "Character" } } },
  { templateKind: "source_research", artifactKind: "source_research", value: { kind: "source_research", query: "Character" } },
  { templateKind: "fact_curation", artifactKind: "fact_curation", value: { kind: "fact_curation", claims: [] } },
  { templateKind: "fact_review", artifactKind: "fact_review", value: { kind: "fact_review", decisions: [] } },
  { templateKind: "plugin", artifactKind: "plugin", value: { kind: "plugin", plugin_id: "official.html" } },
  { templateKind: "director_routing", artifactKind: "director_routing", value: { kind: "director_routing", phase: "authoring" } },
];

function artifact(id: string, artifactKind: ArtifactKind, value: unknown) {
  const content = JSON.stringify(value);
  const revision = contentHash(`${id}:${content}`);
  return {
    id,
    key: `${artifactKind}:${id}`,
    kind: artifactKind,
    name: id,
    content,
    media_type: "application/json" as const,
    content_hash: contentHash(content),
    revision,
    status: "draft" as const,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    created_by: "audit14",
    operation_id: "audit14-issue224",
  };
}

describe("#224 template context artifact kind integrity", () => {
  it("keeps character context free of greetings and relationships that also contain document", async () => {
    const repository = new MemoryProjectRepository("audit14-issue224-mixed");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [
        artifact("character-valid", "character", { kind: "character", document: { id: "character-valid", display_name: "Character" } }),
        artifact("greetings-valid", "greeting", { kind: "greetings", document: { greetings: [{ character_ids: ["character-valid"] }] } }),
        artifact("relationships-valid", "relationship", { kind: "relationships", document: { character_ids: ["character-valid", "character-two"] } }),
        artifact("character-stored-but-greetings-proposal", "character", { kind: "greetings", document: { greetings: [{ character_ids: ["character-valid"] }] } }),
        artifact("legacy-character-without-proposal-kind", "character", { document: { id: "legacy-character", display_name: "Legacy" } }),
      ],
    }));

    const context = await new WorkspaceRuntime(repository).templateContext("character");
    expect(context.context.existing.map((item) => item.artifact_id)).toEqual(["character-valid"]);
    expect(context.context.existing[0]?.value).toMatchObject({ kind: "character", document: { id: "character-valid" } });
  });

  it("requires both the stored artifact kind and parsed proposal kind for every JSON template context", async () => {
    const repository = new MemoryProjectRepository("audit14-issue224-all-kinds");
    const artifacts = JSON_CONTEXT_CASES.flatMap((entry) => {
      const mismatchKind = entry.templateKind === "character" ? "greetings" : "character";
      return [
        artifact(`valid-${entry.templateKind}`, entry.artifactKind, entry.value),
        artifact(`mismatch-${entry.templateKind}`, entry.artifactKind, {
          kind: mismatchKind,
          document: { id: `wrong-${entry.templateKind}` },
        }),
      ];
    });
    await repository.commit(0, (state) => ({ ...state, artifacts }));
    const runtime = new WorkspaceRuntime(repository);

    for (const entry of JSON_CONTEXT_CASES) {
      const context = await runtime.templateContext(entry.templateKind);
      expect(context.context.existing.map((item) => item.artifact_id), entry.templateKind).toEqual([
        `valid-${entry.templateKind}`,
      ]);
      expect(context.context.existing[0]?.kind).toBe(entry.templateKind);
      expect((context.context.existing[0]?.value as { kind?: unknown } | undefined)?.kind).toBe(entry.templateKind);
    }
  });
});
