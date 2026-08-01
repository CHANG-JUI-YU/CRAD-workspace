import { readFile, writeFile } from "node:fs/promises";
import { importCardSource, writeCorrectedCard } from "@card-workspace/compiler";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { cardImportTools, loadCardInspection } from "../src/tools/card-import.js";
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

// Card-import defensive branch coverage.
describe("legacy card import boundary matrix", () => {
  it("fails closed for context, inspection, and disposition guards", async () => {
    const original = await setupMcpWorkspace("card-boundary-original", "original");
    cleanups.push(original.workspace.cleanup);
    const originalLoaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(original.workspace.projectsRoot, "card-boundary-original"));
    if (!originalLoaded.workflow) throw new Error("original workflow missing");
    const wrongContext = { trusted: { agentId: "director" }, projectRoot: original.projectRoot, workflow: originalLoaded.workflow, args: {} } as never;
    await expect(cardImportTools.card_inspect_local(wrongContext)).rejects.toMatchObject({ code: "CARD_IMPORT_CONTEXT_REQUIRED" });

    const fixture = await setupMcpWorkspace("card-boundary", "card_import");
    cleanups.push(fixture.workspace.cleanup);
    const loaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(fixture.workspace.projectsRoot, "card-boundary"));
    if (!loaded.workflow) throw new Error("card workflow missing");
    const workflow = workflowStateSchema.parse({
      ...loaded.workflow,
      stage: "blueprint",
      tasks: [{ id: "analyze-import", kind: "analyze-import", status: "pending", assigned_agent: "card-import-analyst", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: { stage: "blueprint" } }],
    });
    const context = (args: Record<string, unknown>) => ({ trusted: { agentId: "director" }, projectRoot: fixture.projectRoot, workflow, args });
    await expect(cardImportTools.card_inspect_local(context({ file_path: "unsupported.txt", expected_workflow_revision: 0, event_id: "e", occurred_at: "2026-07-21T00:00:00.000Z" }) as never)).rejects.toMatchObject({ code: "CARD_IMPORT_EXTENSION_DENIED" });
    await expect(cardImportTools.card_import_report(context({}) as never)).rejects.toMatchObject({ code: "CARD_INSPECTION_UNAVAILABLE" });
    await expect(cardImportTools.card_import_disposition(context({ disposition: "unknown" }) as never)).rejects.toMatchObject({ code: "CARD_IMPORT_DISPOSITION_INVALID" });
    await expect(loadCardInspection(fixture.projectRoot)).rejects.toMatchObject({ code: "CARD_INSPECTION_UNAVAILABLE" });
  });
});
describe("legacy card import extended branch matrix", () => {
  it("covers JSON and PNG source formats, inspection revision guards, and incomplete analysis", async () => {
    const fixture = await setupMcpWorkspace("card-json-branches", "card_import");
    cleanups.push(fixture.workspace.cleanup);
    const jsonPath = path.join(fixture.workspace.root, "legacy-card.json");
    await writeFile(jsonPath, JSON.stringify({
      name: "JSON Fixture",
      description: "JSON description.",
      personality: "Careful and direct.",
      scenario: "A deterministic JSON scenario.",
      first_mes: "Hello, {{user}}.",
      mes_example: "<START>\n{{char}}: Hello.",
    }), "utf8");
    const director = await clientFor(fixture.environment, "director");
    const started = await director.client.callTool({ name: "workflow_start", arguments: {
      project_id: "card-json-branches", expected_workflow_revision: 0, event_id: "json-started",
      occurred_at: "2026-07-22T00:00:00.000Z",
      intake_answers: [{ decision_id: "json-path", question_id: "legacy-card", answer: "JSON fixture" }],
      intake_completion: { decision_id: "json-ready", answer: "No additional settings", confirmed_no_additional_settings: true },
    } });
    expect(started.isError).not.toBe(true);
    await director.client.close();
    await director.server.close();
    const loaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(fixture.workspace.projectsRoot, "card-json-branches"));
    if (!loaded.workflow) throw new Error("JSON workflow missing");
    const withExtraTask = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: loaded.workflow.revision,
      eventId: "json-extra-task",
      actor: "director",
      occurredAt: "2026-07-22T00:00:30.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        tasks: [...state.tasks, { ...state.tasks[0]!, id: "extra-import-task", status: "completed" }],
      }),
    });
    const context = (workflow: typeof withExtraTask, args: Record<string, unknown>) => ({
      trusted: { agentId: "director", workspaceRoot: fixture.workspace.root },
      projectRoot: fixture.projectRoot,
      workflow,
      args,
    });
    const inspected = await cardImportTools.card_inspect_local(context(withExtraTask, {
      file_path: jsonPath,
      expected_workflow_revision: withExtraTask.revision,
      event_id: "json-inspected",
      occurred_at: "2026-07-22T00:01:00.000Z",
    }) as never);
    expect(inspected).toMatchObject({ inspection: { source: { media_type: "application/json" } } });
    const after = await import("@card-workspace/project").then((m) => m.loadAuthorProject(fixture.workspace.projectsRoot, "card-json-branches"));
    if (!after.workflow) throw new Error("JSON post-inspection workflow missing");
    await expect(cardImportTools.card_inspect_local(context(after.workflow, {
      file_path: jsonPath,
      expected_workflow_revision: after.workflow.revision,
      event_id: "json-inspected-again",
      occurred_at: "2026-07-22T00:02:00.000Z",
    }) as never)).rejects.toMatchObject({ code: "CARD_INSPECTION_EXISTS" });
    const pngPath = path.join(fixture.workspace.root, "legacy-card.png");
    await writeFile(pngPath, Buffer.from("not-a-real-png", "utf8"));
    const withoutInspection = workflowStateSchema.parse({
      ...after.workflow,
      artifacts: after.workflow.artifacts.filter((artifact) => artifact.id !== "card-inspection"),
    });
    await expect(cardImportTools.card_inspect_local(context(withoutInspection, {
      file_path: pngPath,
      expected_workflow_revision: after.workflow.revision,
      event_id: "png-inspected",
      occurred_at: "2026-07-22T00:03:00.000Z",
    }) as never)).rejects.toBeDefined();
    await expect(loadCardInspection(fixture.projectRoot, `sha256:${"0".repeat(64)}`)).rejects.toMatchObject({ code: "CARD_INSPECTION_REVISION_MISMATCH" });
    const missingRevisionWorkflow = workflowStateSchema.parse({ ...after.workflow, artifacts: after.workflow.artifacts.map((artifact) => artifact.id === "card-inspection" ? { ...artifact, revision: undefined } : artifact) });
    await expect(cardImportTools.card_import_report(context(missingRevisionWorkflow, {}) as never)).rejects.toMatchObject({ code: "CARD_INSPECTION_UNAVAILABLE" });
    await expect(cardImportTools.card_import_disposition(context(missingRevisionWorkflow, { disposition: "retain_report" }) as never)).rejects.toMatchObject({ code: "CARD_INSPECTION_UNAVAILABLE" });
    const unavailableTaskWorkflow = workflowStateSchema.parse({ ...after.workflow, tasks: after.workflow.tasks.map((task) => task.id === "analyze-import" ? { ...task, status: "completed" as const } : task) });
    await expect(cardImportTools.card_inspect_local(context(unavailableTaskWorkflow, { file_path: jsonPath, expected_workflow_revision: after.workflow.revision, event_id: "json-task-unavailable", occurred_at: "2026-07-22T00:03:30.000Z" }) as never)).rejects.toMatchObject({ code: "CARD_IMPORT_TASK_UNAVAILABLE" });
    await expect(cardImportTools.card_import_report(context(after.workflow, {}) as never)).rejects.toMatchObject({ code: "CARD_IMPORT_ANALYSIS_INCOMPLETE" });
    const analyst = await clientFor(fixture.environment, "card-import-analyst");
    const claimed = await analyst.client.callTool({ name: "task_claim", arguments: { project_id: "card-json-branches", task_id: "analyze-import", lease_id: "json-analysis-lease", lease_duration_ms: 60000, expected_workflow_revision: after.workflow.revision, event_id: "json-analysis-claimed", occurred_at: "2026-07-22T00:04:00.000Z" } });
    expect(claimed.isError).not.toBe(true);
    const claimedWorkflow = await import("@card-workspace/project").then((m) => m.loadAuthorProject(fixture.workspace.projectsRoot, "card-json-branches"));
    const submitted = await analyst.client.callTool({ name: "import_submit_analysis", arguments: { project_id: "card-json-branches", task_id: "analyze-import", lease_id: "json-analysis-lease", expected_workflow_revision: claimedWorkflow.workflow!.revision, event_id: "json-analysis-submitted", occurred_at: "2026-07-22T00:05:00.000Z", proposal: { schema_version: 1, id: "json-analysis", owner: "card-import-analyst", base_workflow_revision: claimedWorkflow.workflow!.revision, value: { kind: "import_analysis", mappings: [], losses: [], recommendations: ["Keep JSON fields."] } } } });
    expect(submitted.isError).not.toBe(true);
    await analyst.client.close();
    await analyst.server.close();
    const completed = await import("@card-workspace/project").then((m) => m.loadAuthorProject(fixture.workspace.projectsRoot, "card-json-branches"));
    const analysisTask = completed.workflow!.tasks.find((task) => task.id === "analyze-import")!;
    const analysisPath = path.join(fixture.projectRoot, ".workflow", "results", analysisTask.id, `${analysisTask.result!.id}.json`);
    const analysisRaw = await readFile(analysisPath, "utf8");
    const analysisValue = JSON.parse(analysisRaw) as Record<string, unknown>;
    await writeFile(analysisPath, JSON.stringify({ ...analysisValue, value: { ...(analysisValue.value as Record<string, unknown>), recommendations: ["changed"] } }), "utf8");
    await expect(cardImportTools.card_import_report(context(completed.workflow!, {}) as never)).rejects.toMatchObject({ code: "CARD_IMPORT_ANALYSIS_INVALID" });
    await writeFile(analysisPath, analysisRaw, "utf8");
    const pngPathForExport = path.join(fixture.workspace.root, "legacy-card-valid.png");
    const jsonBytes = Buffer.from(await readFile(jsonPath));
    const pngEnvelope = importCardSource(jsonBytes, {});
    const pngSeed = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await writeFile(pngPathForExport, writeCorrectedCard(pngSeed, pngEnvelope, "png"));
    const pngPrepared = await prepareAnalyzedImport("card-png-branches", pngPathForExport);
    const pngLoaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(pngPrepared.fixture.workspace.projectsRoot, "card-png-branches"));
    const pngCopy = await cardImportTools.card_import_disposition({ trusted: { agentId: "director", workspaceRoot: pngPrepared.fixture.workspace.root }, projectRoot: pngPrepared.fixture.projectRoot, workflow: pngLoaded.workflow!, args: { disposition: "corrected_copy", decision_id: "png-copy", summary: "Export PNG copy", expected_workflow_revision: pngLoaded.workflow!.revision, event_id: "png-copy-event", occurred_at: "2026-07-22T00:07:00.000Z" } } as never);
    expect(pngCopy).toMatchObject({ disposition: "corrected_copy", export_path: "exports/card-png-branches/corrected-card.v3.png" });
    await pngPrepared.director.client.close();
    await pngPrepared.director.server.close();
    const jsonCopy = await cardImportTools.card_import_disposition(context(completed.workflow!, { disposition: "corrected_copy", decision_id: "json-copy", summary: "Export JSON copy", expected_workflow_revision: completed.workflow!.revision, event_id: "json-copy-event", occurred_at: "2026-07-22T00:06:00.000Z" }) as never);
    expect(jsonCopy).toMatchObject({ disposition: "corrected_copy", export_path: "exports/card-json-branches/corrected-card.v3.json" });
  });

  it("covers corrected-copy source CAS and duplicate disposition guards", async () => {
    const sourcePath = path.join(repositoryRoot, ".agents/skills/card-import-analysis/fixtures/legacy-card.yaml");
    const mismatch = await prepareAnalyzedImport("card-revision-mismatch", sourcePath);
    const mismatchReport = await loadCardInspection(mismatch.fixture.projectRoot);
    const mismatchRevisionPath = path.join(mismatch.fixture.projectRoot, "sources", "revisions", "legacy-card", mismatchReport.source.revision.slice("sha256:".length) + ".json");
    const mismatchRevision = JSON.parse(await readFile(mismatchRevisionPath, "utf8")) as Record<string, unknown>;
    const mismatchLoaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(mismatch.fixture.workspace.projectsRoot, "card-revision-mismatch"));
    const mismatchedRevision = `sha256:${"0".repeat(64)}`;
    await writeFile(mismatchRevisionPath, JSON.stringify({ ...mismatchRevision, id: mismatchedRevision, raw_hash: mismatchedRevision, snapshot: { ...(mismatchRevision.snapshot as Record<string, unknown>), raw_hash: mismatchedRevision } }), "utf8");
    await expect(cardImportTools.card_import_disposition({
      trusted: { agentId: "director", workspaceRoot: mismatch.fixture.workspace.root }, projectRoot: mismatch.fixture.projectRoot, workflow: mismatchLoaded.workflow!,
      args: { disposition: "corrected_copy", decision_id: "mismatch-choice", summary: "mismatch", expected_workflow_revision: mismatchLoaded.workflow!.revision, event_id: "mismatch-event", occurred_at: "2026-07-22T01:00:00.000Z" },
    } as never)).rejects.toMatchObject({ code: "CARD_IMPORT_SOURCE_REVISION_MISMATCH" });
    await mismatch.director.client.close();
    await mismatch.director.server.close();

    const changed = await prepareAnalyzedImport("card-snapshot-changed", sourcePath);
    const changedReport = await loadCardInspection(changed.fixture.projectRoot);
    const changedRevisionPath = path.join(changed.fixture.projectRoot, "sources", "revisions", "legacy-card", changedReport.source.revision.slice("sha256:".length) + ".json");
    const changedRevision = JSON.parse(await readFile(changedRevisionPath, "utf8")) as { snapshot: { path: string } };
    const changedLoaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(changed.fixture.workspace.projectsRoot, "card-snapshot-changed"));
    const originalSnapshot = await readFile(sourcePath, "utf8");
    await writeFile(path.join(changed.fixture.projectRoot, changedRevision.snapshot.path), originalSnapshot + "\n# changed\n", "utf8");
    await expect(cardImportTools.card_import_disposition({
      trusted: { agentId: "director", workspaceRoot: changed.fixture.workspace.root }, projectRoot: changed.fixture.projectRoot, workflow: changedLoaded.workflow!,
      args: { disposition: "corrected_copy", decision_id: "changed-choice", summary: "changed", expected_workflow_revision: changedLoaded.workflow!.revision, event_id: "changed-event", occurred_at: "2026-07-22T02:00:00.000Z" },
    } as never)).rejects.toMatchObject({ code: "CARD_IMPORT_SOURCE_REVISION_MISMATCH" });
    await changed.director.client.close();
    await changed.director.server.close();

    const duplicate = await prepareAnalyzedImport("card-disposition-duplicate", sourcePath);
    const duplicateLoaded = await import("@card-workspace/project").then((m) => m.loadAuthorProject(duplicate.fixture.workspace.projectsRoot, "card-disposition-duplicate"));
    if (!duplicateLoaded.workflow) throw new Error("duplicate workflow missing");
    const marked = await commitWorkflowMutation(duplicate.fixture.projectRoot, {
      expectedRevision: duplicateLoaded.workflow.revision,
      eventId: "duplicate-marked",
      actor: "director",
      occurredAt: "2026-07-22T03:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        decisions: [...state.decisions, { id: "existing-disposition", kind: "card_import.disposition", actor: "opencode-user", decided_at: "2026-07-22T02:59:00.000Z", input_revisions: [], summary: "already selected", option: "retain_report", extensions: {} }],
      }),
    });
    await expect(cardImportTools.card_import_disposition({
      trusted: { agentId: "director", workspaceRoot: duplicate.fixture.workspace.root }, projectRoot: duplicate.fixture.projectRoot, workflow: marked,
      args: { disposition: "retain_report", decision_id: "duplicate-choice", summary: "duplicate", expected_workflow_revision: marked.revision, event_id: "duplicate-event", occurred_at: "2026-07-22T03:01:00.000Z" },
    } as never)).rejects.toMatchObject({ code: "CARD_IMPORT_DISPOSITION_EXISTS" });
    await duplicate.director.client.close();
    await duplicate.director.server.close();
  });
});