import { describe, expect, it } from "vitest";
import { executionContextFromOperation, type OperationRecord } from "../src/index.js";

const operation = (snapshot?: OperationRecord["execution_snapshot"]): OperationRecord => ({
  id: "operation-context",
  kind: "review",
  request: "Review the current character",
  actor: "session-user",
  status: "running",
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
  progress: [],
  ...(snapshot === undefined ? {} : { execution_snapshot: snapshot }),
});

describe("ExecutionContext", () => {
  it("treats persisted snapshot identity, target, capabilities, and initiation as authoritative", () => {
    const context = executionContextFromOperation(operation({
      execution_agent_id: "character-critic",
      execution_agent_role: "critic",
      initiated_by: "server-session",
      capabilities: ["character"],
      target_artifact_id: "artifact-character",
      target_artifact_kind: "character",
      created_at: "2026-08-12T00:00:00.000Z",
    }), {
      auditActor: "server-session",
      executionAgent: { id: "wrong-agent", role: "creator" },
      initiatedBy: "wrong-initiator",
      target: { artifactId: "wrong-target", artifactKind: "world_lore" },
      capabilities: ["world_lore"],
    });

    expect(context).toMatchObject({
      operationId: "operation-context",
      executionAgent: { id: "character-critic", role: "critic" },
      initiatedBy: "server-session",
      auditActor: "server-session",
      target: { artifactId: "artifact-character", artifactKind: "character" },
      capabilities: ["character"],
    });
  });

  it("uses caller identity only for legacy operations and clones mutable inputs", () => {
    const capabilities = ["review"];
    const context = executionContextFromOperation(operation(), {
      auditActor: "server-session",
      executionAgent: { id: "character-critic", role: "critic" },
      initiatedBy: "server-session",
      target: { artifactId: "artifact-character", artifactKind: "character" },
      capabilities,
    });

    expect(context).toMatchObject({
      operationId: "operation-context",
      executionAgent: { id: "character-critic", role: "critic" },
      initiatedBy: "server-session",
      auditActor: "server-session",
      target: { artifactId: "artifact-character", artifactKind: "character" },
      capabilities: ["review"],
    });
    expect(context.capabilities).not.toBe(capabilities);
  });
});
