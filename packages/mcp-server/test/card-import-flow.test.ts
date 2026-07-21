import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { repositoryRoot, setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function clientFor(environment: Record<string, string>, agentId: string) {
  const { server } = await createMcpServer({ environment: { ...environment, CARD_WORKSPACE_AGENT_ID: agentId } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: `${agentId}-test`, version: "1" });
  await client.connect(clientTransport);
  return { client, server };
}

function body(response: { content: unknown[] }) {
  return JSON.parse((response.content[0] as { text: string }).text) as {
    result?: unknown;
    error?: { code?: string };
  };
}

async function prepareAnalyzedImport(projectId: string, sourcePath: string) {
  const fixture = await setupMcpWorkspace(projectId, "card_import");
  cleanups.push(fixture.workspace.cleanup);
  const director = await clientFor(fixture.environment, "director");
  await director.client.callTool({ name: "workflow_start", arguments: {
    project_id: projectId, expected_workflow_revision: 0, event_id: `${projectId}-started`,
    occurred_at: "2026-07-16T01:00:00.000Z",
    intake_answers: [{ decision_id: `${projectId}-path`, question_id: "legacy-card", answer: "Explicit fixture" }],
    intake_completion: { decision_id: `${projectId}-ready`, answer: "No additional settings", confirmed_no_additional_settings: true },
  } });
  const inspected = await director.client.callTool({ name: "card_inspect_local", arguments: {
    project_id: projectId, file_path: sourcePath, expected_workflow_revision: 1,
    event_id: `${projectId}-inspected`, occurred_at: "2026-07-16T01:01:00.000Z",
  } });
  expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
  await director.client.close();
  await director.server.close();

  const analyst = await clientFor(fixture.environment, "card-import-analyst");
  await analyst.client.callTool({ name: "task_claim", arguments: {
    project_id: projectId, task_id: "analyze-import", lease_id: `${projectId}-lease`,
    lease_duration_ms: 60_000, expected_workflow_revision: 2,
    event_id: `${projectId}-claimed`, occurred_at: "2026-07-16T01:02:00.000Z",
  } });
  const submitted = await analyst.client.callTool({ name: "import_submit_analysis", arguments: {
    project_id: projectId, task_id: "analyze-import", lease_id: `${projectId}-lease`,
    expected_workflow_revision: 3, event_id: `${projectId}-submitted`, occurred_at: "2026-07-16T01:03:00.000Z",
    proposal: {
      schema_version: 1, id: `${projectId}-analysis`, owner: "card-import-analyst", base_workflow_revision: 3,
      value: { kind: "import_analysis", mappings: [], losses: [], recommendations: ["Normalize only."] },
    },
  } });
  expect(submitted.isError, JSON.stringify(submitted)).not.toBe(true);
  await analyst.client.close();
  await analyst.server.close();
  return { fixture, director: await clientFor(fixture.environment, "director") };
}

describe("legacy card review flow", () => {
  it.each([
    ["retain_report", "report_retained"],
    ["cancel", "cancelled"],
  ] as const)("closes routing for %s without creating a Blueprint task", async (disposition, outcomeKind) => {
    const projectId = disposition === "retain_report" ? "legacy-retain" : "legacy-cancel";
    const sourcePath = path.join(repositoryRoot, ".agents/skills/card-import-analysis/fixtures/legacy-card.yaml");
    const prepared = await prepareAnalyzedImport(projectId, sourcePath);
    const response = await prepared.director.client.callTool({ name: "card_import_disposition", arguments: {
      project_id: projectId, disposition, decision_id: `${projectId}-choice`, summary: `Choose ${disposition}`,
      expected_workflow_revision: 4, event_id: `${projectId}-closed`, occurred_at: "2026-07-16T01:04:00.000Z",
    } });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(body(response).result).toMatchObject({
      workflow_closed: true,
      workflow: { outcome: { status: "closed", kind: outcomeKind }, tasks: [{ id: "analyze-import", status: "completed" }] },
    });
    expect(JSON.stringify(body(response).result)).not.toContain("create-blueprint");
    await prepared.director.client.close();
    await prepared.director.server.close();
  });

  it("exports a deterministic corrected YAML copy once, preserves fields, and closes routing", async () => {
    const sourcePath = path.join(repositoryRoot, ".agents/skills/card-import-analysis/fixtures/legacy-card.yaml");
    const sourceBefore = await readFile(sourcePath);
    const prepared = await prepareAnalyzedImport("legacy-copy", sourcePath);
    const report = await prepared.director.client.callTool({ name: "card_import_report", arguments: { project_id: "legacy-copy" } });
    expect(body(report).result).toMatchObject({ action_availability: { corrected_copy: "available_safe_export" } });
    const copied = await prepared.director.client.callTool({ name: "card_import_disposition", arguments: {
      project_id: "legacy-copy", disposition: "corrected_copy", decision_id: "copy-choice",
      summary: "Create normalized copy", expected_workflow_revision: 4,
      event_id: "copy-exported", occurred_at: "2026-07-16T01:04:00.000Z",
    } });
    expect(copied.isError, JSON.stringify(copied)).not.toBe(true);
    expect(body(copied).result).toMatchObject({
      disposition: "corrected_copy",
      source_modified: false,
      workflow_closed: true,
      export_path: "exports/legacy-copy/corrected-card.v3.yaml",
      workflow: { outcome: { status: "closed", kind: "corrected_copy_exported" } },
    });
    const exported = await readFile(path.join(prepared.fixture.workspace.root, "exports/legacy-copy/corrected-card.v3.yaml"), "utf8");
    expect(exported).toContain("spec: chara_card_v3");
    expect(exported).toContain("description: Legacy description");
    expect(exported).toContain("vendor_future:");
    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    const overwrite = await prepared.director.client.callTool({ name: "card_import_disposition", arguments: {
      project_id: "legacy-copy", disposition: "corrected_copy", decision_id: "copy-again",
      summary: "Do not overwrite", expected_workflow_revision: 5,
      event_id: "copy-again", occurred_at: "2026-07-16T01:05:00.000Z",
    } });
    expect(body(overwrite).error?.code).toBe("WORKFLOW_CLOSED");
    const status = await prepared.director.client.callTool({ name: "workflow_status", arguments: { project_id: "legacy-copy" } });
    expect(body(status).result).toMatchObject({ routing: "closed", workflow: { stage: "blueprint" } });
    await prepared.director.client.close();
    await prepared.director.server.close();
  });

  it("inspects YAML read-only, gives the leased Analyst typed context, and stops full rebuild at Blueprint gate", async () => {
    const fixture = await setupMcpWorkspace("legacy-review", "card_import");
    cleanups.push(fixture.workspace.cleanup);
    const sourcePath = path.join(repositoryRoot, ".agents/skills/card-import-analysis/fixtures/legacy-card.yaml");
    const sourceBefore = await readFile(sourcePath);
    const director = await clientFor(fixture.environment, "director");

    const started = await director.client.callTool({ name: "workflow_start", arguments: {
      project_id: "legacy-review", expected_workflow_revision: 0, event_id: "review-started",
      occurred_at: "2026-07-16T00:00:00.000Z",
      intake_answers: [{ decision_id: "legacy-path", question_id: "legacy-card", answer: "Explicit YAML fixture" }],
      intake_completion: { decision_id: "legacy-ready", answer: "No additional settings", confirmed_no_additional_settings: true },
    } });
    expect(started.isError).not.toBe(true);
    const inspected = await director.client.callTool({ name: "card_inspect_local", arguments: {
      project_id: "legacy-review", file_path: sourcePath, expected_workflow_revision: 1,
      event_id: "legacy-inspected", occurred_at: "2026-07-16T00:01:00.000Z",
    } });
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    expect(body(inspected).result).toMatchObject({
      inspection: {
        id: "card-inspection",
        source: { media_type: "application/yaml" },
        envelope: { card: { data: { name: "Legacy Fixture" } } },
        canonical_passthrough: { source_envelope: { root: { vendor_future: { retained: true } } } },
      },
    });
    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    await director.client.close();
    await director.server.close();

    const analyst = await clientFor(fixture.environment, "card-import-analyst");
    const claimed = await analyst.client.callTool({ name: "task_claim", arguments: {
      project_id: "legacy-review", task_id: "analyze-import", lease_id: "analysis-lease",
      lease_duration_ms: 60_000, expected_workflow_revision: 2,
      event_id: "analysis-claimed", occurred_at: "2026-07-16T00:02:00.000Z",
    } });
    expect(claimed.isError, JSON.stringify(claimed)).not.toBe(true);
    const context = await analyst.client.callTool({ name: "task_context", arguments: {
      project_id: "legacy-review", task_id: "analyze-import", lease_id: "analysis-lease",
    } });
    expect(body(context).result).toMatchObject({ inspection: { source: { original_name: "legacy-card.yaml" } } });
    const submitted = await analyst.client.callTool({ name: "import_submit_analysis", arguments: {
      project_id: "legacy-review", task_id: "analyze-import", lease_id: "analysis-lease",
      expected_workflow_revision: 3, event_id: "analysis-submitted", occurred_at: "2026-07-16T00:03:00.000Z",
      proposal: {
        schema_version: 1, id: "legacy-analysis", owner: "card-import-analyst", base_workflow_revision: 3,
        value: {
          kind: "import_analysis",
          mappings: [{ source_field: "/data/name", target_contract: "blueprint@1", target_field: "/characters/0/display_name", summary: "Deterministic name mapping." }],
          losses: [], recommendations: ["Retain passthrough."],
        },
      },
    } });
    expect(submitted.isError, JSON.stringify(submitted)).not.toBe(true);
    await analyst.client.close();
    await analyst.server.close();

    const resumed = await clientFor(fixture.environment, "director");
    const report = await resumed.client.callTool({ name: "card_import_report", arguments: { project_id: "legacy-review" } });
    expect(body(report).result).toMatchObject({
      analyst_analysis: { value: { kind: "import_analysis" } },
      action_availability: { corrected_copy: "available_safe_export" },
    });
    const rebuild = await resumed.client.callTool({ name: "card_import_disposition", arguments: {
      project_id: "legacy-review", disposition: "full_rebuild", decision_id: "rebuild-choice",
      summary: "User chose a full rebuild", expected_workflow_revision: 4,
      event_id: "rebuild-requested", occurred_at: "2026-07-16T00:05:00.000Z",
    } });
    expect(rebuild.isError, JSON.stringify(rebuild)).not.toBe(true);
    const rebuildResult = JSON.stringify(body(rebuild).result);
    expect(rebuildResult).toContain('"blueprint_gate":"pending_user_approval"');
    expect(rebuildResult).toContain('"id":"blueprint","status":"pending"');
    expect(rebuildResult).toContain('"id":"create-blueprint","kind":"create-blueprint","status":"pending"');
    const rebuiltWorkflow = (body(rebuild).result as { workflow: { revision: number } }).workflow;
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: rebuiltWorkflow.revision,
      eventId: "rebuild-blueprint-terminal-failure",
      actor: "engine",
      occurredAt: "2026-07-16T00:05:30.000Z",
      update: (current) => workflowStateSchema.parse({
        ...current,
        revision: current.revision + 1,
        tasks: current.tasks.map((task) => task.id === "create-blueprint" ? {
          ...task,
          status: "failed",
          attempt: task.max_attempts,
          failure_summary: "Provider timeout",
          failure: { category: "provider_timeout", summary: "Provider timeout", failed_at: "2026-07-16T00:05:30.000Z", failed_by: "director", attempt: task.max_attempts },
        } : task),
      }),
    });
    const recovered = await resumed.client.callTool({ name: "task_recovery_begin", arguments: {
      project_id: "legacy-review", task_id: "create-blueprint", run_id: "full-rebuild-blueprint",
      failure_category: "provider_timeout", reason: "Recover the transient full rebuild Blueprint failure",
      expected_workflow_revision: rebuiltWorkflow.revision + 1, event_id: "rebuild-blueprint-recovered",
      occurred_at: "2026-07-16T00:06:00.000Z",
    } });
    expect(recovered.isError, JSON.stringify(recovered)).not.toBe(true);
    const recoveredTasks = (body(recovered).result as { tasks: Array<{ id: string; kind: string; status: string }> }).tasks;
    expect(recoveredTasks.find((task) => task.id === "create-blueprint")).toMatchObject({ status: "superseded" });
    expect(recoveredTasks.find((task) => task.id === "recover-full-rebuild-blueprint")).toMatchObject({ kind: "create-blueprint", status: "pending" });
    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    await resumed.client.close();
    await resumed.server.close();
  });
});
