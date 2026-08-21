import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type FactReviewDecisionRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";

const NOW = "2026-08-21T00:00:00.000Z";

function precheck(): BlueprintPrecheckRecord {
  const candidateBlueprint = {
    schema_version: 1,
    project_id: "issue225-server",
    flow: "character",
    primary_character_id: "a",
    world: { enabled: false },
    characters: [
      { id: "a", label: "Alice", aliases: [], ordinal: 1, mode: "zhuji" },
      { id: "b", label: "Bob", aliases: [], ordinal: 2, mode: "zhuji" },
    ],
    relationships: { enabled: true },
  };
  return {
    id: "precheck-issue225-server",
    schema_version: 1,
    project_id: "issue225-server",
    operation_id: "audit14-issue225",
    collaboration_mode: "assisted",
    candidate_blueprint: candidateBlueprint,
    candidate_blueprint_revision: contentHash(JSON.stringify(candidateBlueprint)),
    checks: [{
      subject_id: "a",
      dimension: "character_core",
      uncertainty: "low",
      impact: "low",
      basis: "MCP unresolved fact context regression.",
      action: "preserve_explicit",
    }],
    status: "recorded",
    created_at: NOW,
    created_by: "director",
  };
}

function fact(id: string, status: FactRecord["status"], characterId: string): FactRecord {
  return {
    id,
    candidate_occurrence_id: `occ-${id}`,
    statement: `${id} statement`,
    subject: characterId,
    predicate: "has_trait",
    value: id,
    classification: "trait",
    entity_refs: [characterId],
    coverage: ["personality"],
    status,
    confidence: 0.8,
    source_ids: [],
    evidence: [],
    created_at: NOW,
    updated_at: NOW,
    created_by: "fact-curator",
  };
}

function needsEvidenceDecision(): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id: "decision-needs-a",
    operation_id: "op-review-a",
    review_run_id: "run-issue225-server",
    candidate_occurrence_id: "occ-needs-a",
    fact_id: "needs-a",
    reviewer_identity: "fact-reviewer-2",
    decision: "needs_evidence",
    reason: "Need stronger evidence.",
    evidence: [],
    candidate_revision: contentHash("needs-a:candidate"),
    expected_projection_revision: contentHash("needs-a:projection"),
    created_at: NOW,
  };
}

async function callTool(base: string, name: string, args: Record<string, unknown>, id: number): Promise<unknown> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
  return response.json();
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const repository = new MemoryProjectRepository("issue225-server");
  await repository.commit(0, (state) => ({
    ...state,
    blueprint_prechecks: [precheck()],
    facts: [
      fact("accepted-a", "accepted", "a"),
      fact("candidate-a", "candidate", "a"),
      fact("needs-a", "candidate", "a"),
      fact("conflict-a", "conflict", "a"),
      fact("rejected-a", "rejected", "a"),
      fact("candidate-b", "candidate", "b"),
    ],
    fact_review_decisions: [needsEvidenceDecision()],
  }));
  const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(repository), actor: "audit14", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describe("#225 unresolved authoring facts over MCP", () => {
  it("returns unresolved facts with traceable needs_evidence metadata and excludes rejected facts", async () => {
    await withServer(async (base) => {
      const response = JSON.stringify(await callTool(base, "workspace_authoring_context", {}, 1));
      expect(response).toContain("accepted-a");
      expect(response).toContain("candidate-a");
      expect(response).toContain("needs-a");
      expect(response).toContain("conflict-a");
      expect(response).toContain("candidate-b");
      expect(response).not.toContain("rejected-a");
      expect(response).toContain("unresolved_fact_reviews");
      expect(response).toContain("needs_evidence");
      expect(response).toContain("decision-needs-a");
      expect(response).toContain("Need stronger evidence.");
    });
  });

  it("keeps unresolved facts scoped to the explicit template target", async () => {
    await withServer(async (base) => {
      const a = JSON.stringify(await callTool(base, "workspace_template_context", { kind: "character", character_id: "a" }, 2));
      expect(a).toContain("candidate-a");
      expect(a).toContain("needs-a");
      expect(a).toContain("conflict-a");
      expect(a).not.toContain("candidate-b");
      expect(a).not.toContain("rejected-a");

      const participants = JSON.stringify(await callTool(base, "workspace_template_context", { kind: "relationships", participant_ids: ["b"] }, 3));
      expect(participants).toContain("candidate-b");
      expect(participants).not.toContain("candidate-a");
      expect(participants).not.toContain("needs-a");
    });
  });
});
