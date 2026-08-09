import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactRecord, type TemplateProposalValue } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

function sourceArtifact(): ArtifactRecord {
  const value = { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Stable source content." } } };
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id: "source-zhuji", key: "zhuji:demo-appearance", kind: "zhuji", name: "demo/appearance", content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "creator", operation_id: "source-operation" };
}

const proposal: Extract<TemplateProposalValue, { kind: "conversion" }> = {
  kind: "conversion",
  character_id: "demo",
  source_mode: "zhuji",
  target_mode: "palette",
  modules: [{ schema_version: 1, mode: "palette", module: "basic_information", title: "Basic information", content: "A calm and observant character.", sections: {}, provenance: [], extensions: {} }],
  mappings: [{ source: "appearance", target: "basic_information", summary: "Maps the stable appearance core." }],
  unmapped: [],
};

describe("runtime mode conversion", () => {
  it("returns the conversion report and generated target draft IDs", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, artifacts: [sourceArtifact()] }));
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.submitTemplateProposal(proposal, { actor: "mode-conversion", attachments: [] }, { agent: "mode-conversion" });
    expect(result.status).toBe("completed");
    expect(result.completed).toHaveLength(2);
    expect((await repository.read()).artifacts.map((artifact) => artifact.kind)).toEqual(["zhuji", "conversion", "palette"]);
  });
});
