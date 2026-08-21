import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type BlueprintPrecheckRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import { toolDefinitions } from "../src/mcp-tools.js";

const NOW = "2026-08-21T00:00:00.000Z";

function recordedPrecheck(): BlueprintPrecheckRecord {
  const candidateBlueprint = {
    schema_version: 1,
    project_id: "issue229-server",
    flow: "character",
    primary_character_id: "a",
    world: { enabled: false },
    characters: [
      { id: "a", label: "A", ordinal: 1, mode: "zhuji" },
      { id: "b", label: "B", ordinal: 2, mode: "zhuji" },
    ],
    relationships: { enabled: false },
  };
  return {
    id: "precheck-issue229-server",
    schema_version: 1,
    project_id: "issue229-server",
    operation_id: "audit14-issue229",
    collaboration_mode: "assisted",
    candidate_blueprint: candidateBlueprint,
    candidate_blueprint_revision: contentHash(JSON.stringify(candidateBlueprint)),
    checks: [{
      subject_id: "a",
      dimension: "character_core",
      uncertainty: "low",
      impact: "low",
      basis: "Explicit two-character roster for template target boundary regression.",
      action: "preserve_explicit",
    }],
    status: "recorded",
    created_at: NOW,
    created_by: "director",
  };
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const repository = new MemoryProjectRepository("issue229-server");
  await repository.commit(0, (state) => ({ ...state, blueprint_prechecks: [recordedPrecheck()] }));
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

async function callTemplateContext(base: string, args: Record<string, unknown>, id: number): Promise<unknown> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "workspace_template_context", arguments: args } }),
  });
  return response.json();
}

describe("#229 workspace_template_context target boundary", () => {
  it("advertises explicit character and participant targets in the MCP schema", () => {
    const tool = toolDefinitions.find((item) => item.name === "workspace_template_context");
    const properties = tool?.inputSchema.properties as Record<string, unknown> | undefined;
    expect(properties).toHaveProperty("character_id");
    expect(properties).toHaveProperty("participant_ids");
  });

  it("forwards character_id through MCP and REST while missing or invalid targets fail closed", async () => {
    await withServer(async (base) => {
      const targeted = await callTemplateContext(base, { kind: "character", character_id: "b" }, 1);
      expect(JSON.stringify(targeted)).toContain("\\\"target\\\":{\\\"character_id\\\":\\\"b\\\"}");

      const missing = await callTemplateContext(base, { kind: "character" }, 2);
      expect(JSON.stringify(missing)).toContain("TEMPLATE_CHARACTER_TARGET_REQUIRED");

      const invalid = await callTemplateContext(base, { kind: "character", character_id: "missing" }, 3);
      expect(JSON.stringify(invalid)).toContain("TEMPLATE_CHARACTER_TARGET_INVALID");

      const rest = await fetch(`${base}/workspace/template/context?kind=character&character_id=b`);
      expect(rest.status).toBe(200);
      expect(await rest.json()).toMatchObject({ context: { target: { character_id: "b" } } });
    });
  });
});
