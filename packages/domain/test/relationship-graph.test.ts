import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, type OperationRecord } from "@st-workspace/core";
import { AuthoringService } from "../src/index.js";

function operation(id: string): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind: "authoring", request: "create relationships", status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

const legacyDocument = {
  schema_version: 1 as const,
  document_id: "alice-beth-network",
  team_code: "ABC123",
  character_ids: ["alice", "beth"],
  character_summaries: [
    { character_id: "alice", summary: "Careful planner." },
    { character_id: "beth", summary: "Bold improviser." },
  ],
  perspectives: [
    { source_character_id: "alice", target_character_id: "alice", summary: "Sees herself as careful." },
    { source_character_id: "alice", target_character_id: "beth", summary: "Trusts Beth's courage." },
    { source_character_id: "beth", target_character_id: "alice", summary: "Relies on Alice's plans." },
    { source_character_id: "beth", target_character_id: "beth", summary: "Sees herself as direct." },
  ],
  groups: [],
  summary: { network_character: "Complementary partners.", inter_group_relations: "One small team.", stability: "Stable with occasional friction." },
};

describe("relationship graph migration", () => {
  it("stores a legacy full matrix as the canonical sparse graph", async () => {
    const repository = new MemoryProjectRepository("relationships");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-relationships")] }));
    const result = await new AuthoringService(repository).createTemplate("op-relationships", { kind: "relationships", document: legacyDocument }, "relationship-creator");
    expect(result.status).toBe("completed");
    const artifact = (await repository.read()).artifacts[0];
    const stored = JSON.parse(artifact?.content ?? "{}") as { document?: Record<string, unknown> };
    expect(stored.document).toMatchObject({ schema_version: 2, self_perspectives: expect.any(Array), edges: expect.any(Array) });
    expect((stored.document?.self_perspectives as unknown[] | undefined)).toHaveLength(2);
    expect((stored.document?.edges as unknown[] | undefined)).toHaveLength(2);
    expect(stored.document).not.toHaveProperty("perspectives");
  });
});
