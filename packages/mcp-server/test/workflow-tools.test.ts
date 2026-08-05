/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeRevision, loadAuthorProject } from "@card-workspace/project";
import { getJobStatus, intakeRetrievedSource, readSourceManifest } from "@card-workspace/ingestion";
import { workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { writeYamlFixture } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createTrustedContext } from "../src/context.js";
import { createMcpServer } from "../src/server.js";
import { toolRegistry } from "../src/tool-registry.js";
import { sourceTools } from "../src/tools/sources.js";
import { factTools } from "../src/tools/facts.js";
import { workflowTools } from "../src/tools/workflow.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("workflow MCP tools", () => {
  it("advertises typed task failure and recovery contracts", () => {
    const failTool = toolRegistry.task_fail;
    const recoveryTool = toolRegistry.task_recovery_begin;
    const repairResumeTool = toolRegistry.task_repair_resume;
    if (!failTool || failTool.scope !== "project" || !recoveryTool || recoveryTool.scope !== "project" || !repairResumeTool || repairResumeTool.scope !== "project") {
      throw new Error("task failure/recovery tools are not project-scoped");
    }
    const event = { project_id: "demo", expected_workflow_revision: 1, event_id: "event-1", occurred_at: "2026-07-14T00:00:00.000Z" };
    expect(failTool.inputSchema.safeParse({ ...event, task_id: "task-1", lease_id: "lease-1", summary: "Timed out" }).success).toBe(false);
    expect(failTool.inputSchema.safeParse({ ...event, task_id: "task-1", lease_id: "lease-1", summary: "Timed out", failure_category: "provider_timeout" }).success).toBe(true);
    expect(recoveryTool.inputSchema.safeParse({ ...event, task_id: "task-1", run_id: "recover-1", reason: "Retry timeout", failure_category: "provider_timeout" }).success).toBe(true);
    expect(recoveryTool.inputSchema.safeParse({ ...event, task_id: "task-1", run_id: "recover-1", reason: "Retry semantic failure", failure_category: "semantic_failure" }).success).toBe(true);
    expect(repairResumeTool.inputSchema.safeParse({ ...event, task_id: "recover-task-1", run_id: "fixed-1", reason: "Removed invalid project file" }).success).toBe(true);
    expect(repairResumeTool.inputSchema.safeParse({ ...event, task_id: "recover-task-1", reason: "Missing run ID" }).success).toBe(false);
  });

  it("advertises complete Source Adaptation task, review, and repair contracts", () => {
    const create = toolRegistry.source_create_chunks;
    const submit = toolRegistry.fact_submit_candidates;
    const finalize = toolRegistry.fact_finalize_curation;
    const status = toolRegistry.facts_review_status;
    const repair = toolRegistry.source_processing_repair_begin;
    const recuration = toolRegistry.facts_recuration_begin;
    for (const tool of [create, submit, finalize, status, repair, recuration]) {
      expect(tool?.scope).toBe("project");
    }
    expect(status?.inputSchema.safeParse({ project_id: "source-project" }).success).toBe(true);
    expect(status?.inputSchema.safeParse({ project_id: "source-project", limit: 51 }).success).toBe(false);
    const review = toolRegistry.fact_review;
    const reviewInput = {
      project_id: "source-project",
      decision: {
        schema_version: 1,
        id: "review-1",
        candidate_id: "raw-candidate-id",
        fact_id: "fact-1",
        type: "accepted",
        rationale: "Exact evidence",
        actor: "director",
        decided_at: "2026-07-18T00:00:00.000Z",
        extensions: {},
      },
      expected_projection_revision: `sha256:${"a".repeat(64)}`,
    };
    expect(review?.inputSchema.safeParse(reviewInput).success).toBe(false);
    expect(review?.inputSchema.safeParse({
      ...reviewInput,
      decision: { ...reviewInput.decision, candidate_id: `candidate-occurrence-${"a".repeat(64)}` },
    }).success).toBe(true);
    const task = { project_id: "source-project", task_id: "curate-facts", lease_id: "task-lease" };
    const workflowEvent = { expected_workflow_revision: 3, event_id: "source-event", occurred_at: "2026-07-18T00:00:00.000Z" };
    expect(create?.inputSchema.safeParse({ ...task, ...workflowEvent, source_id: "novel", source_revision_id: `sha256:${"a".repeat(64)}` }).success).toBe(true);
    expect(create?.inputSchema.safeParse({ project_id: "source-project", source_id: "novel", source_revision_id: `sha256:${"a".repeat(64)}` }).success).toBe(false);
    expect(submit?.inputSchema.safeParse({ ...task, expected_job_revision: 1, batch: {}, chunk_lease_id: "chunk-lease" }).success).toBe(false);
    const draft = {
      schema_version: 1,
      source_id: "novel",
      source_revision_id: `sha256:${"a".repeat(64)}`,
      chunk_set_id: "set-1",
      chunk_id: "chunk-1",
      chunk_hash: `sha256:${"b".repeat(64)}`,
      job_id: "job-1",
      input_revision: `sha256:${"c".repeat(64)}`,
      candidates: [{
        schema_version: 1,
        subject: "alice",
        predicate: "appearance.hair",
        value: "silver",
        classification: "source_fact",
        confidence: 1,
        evidence: [{ id: "evidence-1", quote: "exact quote" }],
        status: "submitted",
      }],
      created_at: "2026-07-18T00:00:00.000Z",
    };
    expect(submit?.inputSchema.safeParse({ ...task, expected_job_revision: 1, batch: draft, chunk_lease_id: "chunk-lease" }).success).toBe(true);
    const callerIdentityDraft = structuredClone(draft);
    Object.assign(callerIdentityDraft.candidates[0]!, { id: "candidate-1", created_by: "fact-curator", created_at: "2026-07-18T00:00:00.000Z" });
    expect(submit?.inputSchema.safeParse({ ...task, expected_job_revision: 1, batch: callerIdentityDraft, chunk_lease_id: "chunk-lease" }).success).toBe(false);
    const rangedDraft = structuredClone(draft);
    Object.assign(rangedDraft.candidates[0]!.evidence[0]!, { normalized_character_range: [0, 11] });
    expect(submit?.inputSchema.safeParse({ ...task, expected_job_revision: 1, batch: rangedDraft, chunk_lease_id: "chunk-lease" }).success).toBe(false);
    expect(finalize?.inputSchema.safeParse({ ...task, ...workflowEvent, result_id: "facts-summary" }).success).toBe(true);
    expect(status?.inputSchema.safeParse({ project_id: "source-project" }).success).toBe(true);
    expect(repair?.inputSchema.safeParse({ project_id: "source-project", ...workflowEvent, run_id: "repair-1", reason: "Legacy contract failed" }).success).toBe(true);
    expect(recuration?.inputSchema.safeParse({ project_id: "source-project", ...workflowEvent, run_id: "quality-2", reason: "Coverage is incomplete" }).success).toBe(true);
  });

  it("rejects raw candidate IDs at the fact_review handler boundary", () => {
    try {
      void factTools.fact_review({
        args: {
          decision: { candidate_id: "raw-candidate-id" },
          expected_projection_revision: `sha256:${"a".repeat(64)}`,
        },
      } as never);
      throw new Error("fact_review unexpectedly accepted a raw candidate ID");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("FACT_CANDIDATE_OCCURRENCE_ID_REQUIRED");
    }
  });

  it("advertises the complete recovery input contract", () => {
    const tool = toolRegistry.workflow_start;
    if (!tool || tool.scope !== "project") throw new Error("workflow_start is not project-scoped");
    expect(tool.inputSchema.safeParse({ project_id: "workflow-start" }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      project_id: "workflow-start",
      expected_workflow_revision: 0,
      event_id: "workflow-started",
      occurred_at: "2026-07-14T00:00:00.000Z",
      intake_completion: { decision_id: "intake-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    }).success).toBe(true);
    expect(tool.inputSchema.safeParse({
      project_id: "workflow-start",
      expected_workflow_revision: 0,
      event_id: "workflow-started",
      occurred_at: "2026-07-14T00:00:00.000Z",
    }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      project_id: "workflow-start",
      expected_workflow_revision: 0,
      event_id: "workflow-started",
      occurred_at: "2026-07-14T00:00:00.000Z",
      intake_answers: [{ decision_id: "intake-concept", question_id: "concept", answer: "A constrained premise" }],
    }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      project_id: "workflow-start",
      expected_workflow_revision: 0,
      event_id: "workflow-started",
      occurred_at: "2026-07-14T00:00:00.000Z",
      intake_answers: [{ decision_id: "intake-concept", question_id: "concept", answer: "A constrained premise" }],
      intake_completion: { decision_id: "intake-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    }).success).toBe(true);
  });

  it("starts from project_initialize decisions without duplicating intake answers", async () => {
    const fixture = await setupMcpWorkspace("initialized-intake");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const initialized = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "initialized-intake-saved",
      actor: "director",
      occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 1,
        decisions: [{
          id: "character-concept", kind: "interview.answer", actor: "director",
          decided_at: "2026-07-14T00:00:00.000Z", input_revisions: [],
          summary: "A constrained premise", extensions: { question_id: "concept" },
        }],
      }),
    });
    await expect(workflowTools.workflow_start({
      trusted,
      workflow: initialized,
      projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: 1,
        event_id: "duplicate-intake-rejected",
        occurred_at: "2026-07-14T00:00:30.000Z",
        intake_answers: [{ decision_id: "character-concept", question_id: "concept", answer: "Duplicated premise" }],
        intake_completion: {
          decision_id: "intake-complete",
          answer: "No additional settings",
          confirmed_no_additional_settings: true,
        },
      },
    })).rejects.toThrow();
    const started = await workflowTools.workflow_start({
      trusted,
      workflow: initialized,
      projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: 1,
        event_id: "initialized-workflow-started",
        occurred_at: "2026-07-14T00:01:00.000Z",
        intake_completion: {
          decision_id: "intake-complete",
          answer: "No additional settings",
          confirmed_no_additional_settings: true,
        },
      },
    });
    expect(started.stage).toBe("blueprint");
    expect(started.decisions.filter((decision) => decision.id === "character-concept")).toHaveLength(1);
    expect(started.decisions.some((decision) => decision.id === "intake-complete")).toBe(true);
  });

  it("repairs a legacy exhausted curation task from current exact source refs", async () => {
    const fixture = await setupMcpWorkspace("source-repair", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const intake = await intakeRetrievedSource({
      projectRoot: fixture.projectRoot,
      sourceId: "novel",
      title: "Novel",
      bytes: Buffer.from("Exact source."),
      requestedUrl: "https://example.test/source",
      canonicalUrl: "https://example.test/source",
      fetchedAt: "2026-07-18T00:00:00.000Z",
      actor: "director",
      mediaType: "text/plain",
      extension: ".txt",
    });
    const failed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "legacy-curation-failed",
      actor: "engine",
      occurredAt: "2026-07-18T00:01:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        stage: "source_processing",
        revision: 1,
        tasks: [{
          id: "curate-facts", kind: "curate-facts", status: "failed", assigned_agent: "fact-curator",
          capabilities: ["task.execute", "facts.propose"],
          input_artifacts: [{ id: "source-novel", revision: intake.revision.id }],
          output_contract: "facts-curation-summary@1", dependencies: [], attempt: 3, max_attempts: 3,
          failure_summary: "Legacy output contract failed", extensions: { stage: "source_processing" },
        }],
      }),
    });
    const trusted = await createTrustedContext(fixture.environment);
    const repaired = await workflowTools.source_processing_repair_begin({
      trusted,
      workflow: failed,
      projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: 1,
        event_id: "source-repair-started",
        occurred_at: "2026-07-18T00:02:00.000Z",
        run_id: "legacy-1",
        reason: "Use the corrected task-bound curation contract",
      },
    });
    expect(repaired.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "curate-facts", status: "superseded", failure_summary: "Legacy output contract failed" }),
      expect.objectContaining({
        id: "curate-facts-legacy-1", status: "pending", output_contract: "facts-curation-summary@1",
        input_artifacts: [{ id: "source-novel", revision: intake.revision.id }],
      }),
    ]));
    const failedRepair = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 2,
      eventId: "first-source-repair-failed",
      actor: "fact-curator",
      occurredAt: "2026-07-18T00:03:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        tasks: state.tasks.map((task) => task.id === "curate-facts-legacy-1"
          ? { ...task, status: "failed", attempt: 3, failure_summary: "Correctable source tool contract mismatch" }
          : task),
      }),
    });
    const secondRepair = await workflowTools.source_processing_repair_begin({
      trusted,
      workflow: failedRepair,
      projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: 3,
        event_id: "second-source-repair-started",
        occurred_at: "2026-07-18T00:04:00.000Z",
        run_id: "contract-fix-2",
        reason: "Retry after correcting the source artifact ID contract",
      },
    });
    expect(secondRepair.tasks.at(-1)).toMatchObject({
      id: "curate-facts-contract-fix-2",
      status: "pending",
      input_artifacts: [{ id: "source-novel", revision: intake.revision.id }],
      extensions: {
        repair_of: "curate-facts-legacy-1",
        repair_root: "curate-facts",
        repair_generation: 2,
      },
    });
  });

  it("begins Director facts re-curation from current exact source refs", async () => {
    const fixture = await setupMcpWorkspace("facts-recuration", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const intake = await intakeRetrievedSource({
      projectRoot: fixture.projectRoot, sourceId: "novel", title: "Novel", bytes: Buffer.from("Exact source."),
      requestedUrl: "https://example.test/source", canonicalUrl: "https://example.test/source",
      fetchedAt: "2026-07-18T00:00:00.000Z", actor: "director", mediaType: "text/plain", extension: ".txt",
    });
    const reviewed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "facts-reviewed", actor: "engine", occurredAt: "2026-07-18T00:01:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "facts_review", revision: 1,
        gates: ["facts", "blueprint", "content", "publish"].map((id) => ({ id, status: "approved", input_revisions: [], extensions: {} })),
        tasks: [{
          id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator",
          capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"],
          input_artifacts: [{ id: "source-novel", revision: intake.revision.id }], output_contract: "facts-curation-summary@1",
          dependencies: [], attempt: 1, max_attempts: 3,
          result: { id: "facts-summary", revision: `sha256:${"d".repeat(64)}`, contract: "facts-curation-summary@1" },
          extensions: { stage: "source_processing" },
        }],
      }),
    });
    const trusted = await createTrustedContext(fixture.environment);
    const next = await workflowTools.facts_recuration_begin({
      trusted, workflow: reviewed, projectRoot: fixture.projectRoot,
      args: { expected_workflow_revision: 1, event_id: "recuration-started", occurred_at: "2026-07-18T00:02:00.000Z", run_id: "quality-2", reason: "Coverage is incomplete" },
    });
    expect(next.tasks[0]).toMatchObject({ id: "curate-facts", status: "completed" });
    expect(next.tasks[1]).toMatchObject({
      id: "curate-facts-recurate-quality-2", status: "pending",
      input_artifacts: [{ id: "source-novel", revision: intake.revision.id }],
      extensions: { curation_run_id: "quality-2" },
    });
    expect(next.gates.every((gate) => gate.status === "pending" && gate.input_revisions.length === 0)).toBe(true);
    const curator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "fact-curator" });
    const claimed = await workflowTools.task_claim({
      trusted: curator, workflow: next, projectRoot: fixture.projectRoot,
      args: {
        task_id: "curate-facts-recurate-quality-2", lease_id: "recuration-lease", lease_duration_ms: 60_000,
        expected_workflow_revision: 2, event_id: "recuration-claimed", occurred_at: "2026-07-18T00:03:00.000Z",
      },
    });
    const created = await sourceTools.source_create_chunks({
      trusted: curator, workflow: claimed, projectRoot: fixture.projectRoot,
      args: {
        task_id: "curate-facts-recurate-quality-2", lease_id: "recuration-lease",
        source_id: "novel", source_revision_id: intake.revision.id,
        expected_workflow_revision: 3, event_id: "recuration-job-created", occurred_at: "2026-07-18T00:04:00.000Z",
      },
    });
    const binding = created.workflow.tasks[1]!.extensions.source_jobs as Record<string, { job_id: string }>;
    await expect(getJobStatus(fixture.projectRoot, binding.novel!.job_id)).resolves.toMatchObject({
      extensions: { curation_run_id: "quality-2" },
    });
  });

  it("intakes an appended source and begins facts re-curation atomically", async () => {
    const fixture = await setupMcpWorkspace("source-append-recuration", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const intake = await intakeRetrievedSource({
      projectRoot: fixture.projectRoot, sourceId: "novel", title: "Novel", bytes: Buffer.from("Exact source."),
      requestedUrl: "https://example.test/source", canonicalUrl: "https://example.test/source",
      fetchedAt: "2026-07-18T00:00:00.000Z", actor: "director", mediaType: "text/plain", extension: ".txt",
    });
    const appendPath = path.join(fixture.workspace.root, "habits-notes.txt");
    await writeFile(appendPath, "Additional habits coverage material.", "utf8");
    const reviewed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "facts-reviewed", actor: "engine", occurredAt: "2026-07-18T00:01:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "facts_review", revision: 1,
        gates: ["facts", "blueprint", "content", "publish"].map((id) => ({ id, status: "approved", input_revisions: [], extensions: {} })),
        tasks: [{
          id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator",
          capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"],
          input_artifacts: [{ id: "source-novel", revision: intake.revision.id }], output_contract: "facts-curation-summary@1",
          dependencies: [], attempt: 1, max_attempts: 3,
          result: { id: "facts-summary", revision: `sha256:${"d".repeat(64)}`, contract: "facts-curation-summary@1" },
          extensions: { stage: "source_processing" },
        }],
      }),
    });
    const trusted = await createTrustedContext(fixture.environment);
    await expect(workflowTools.source_append_recuration({
      trusted, workflow: reviewed, projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: 1, event_id: "append-mode-invalid", occurred_at: "2026-07-18T00:02:00.000Z",
        run_id: "quality-2", reason: "Habits dimension lacks coverage", source_id: "habits-notes", title: "Habits notes",
      },
    })).rejects.toMatchObject({ code: "SOURCE_APPEND_RECURATION_INTAKE_MODE" });
    const next = await workflowTools.source_append_recuration({
      trusted, workflow: reviewed, projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: 1, event_id: "append-recuration-started", occurred_at: "2026-07-18T00:02:00.000Z",
        run_id: "quality-2", reason: "Habits dimension lacks coverage",
        source_id: "habits-notes", title: "Habits notes", file_path: appendPath,
      },
    });
    const manifest = await readSourceManifest(fixture.projectRoot);
    const appended = manifest.sources.find((source) => source.id === "habits-notes");
    if (!appended) throw new Error("appended source missing from manifest");
    expect(next.stage).toBe("source_processing");
    expect(next.tasks[1]).toMatchObject({
      id: "curate-facts-recurate-quality-2", status: "pending",
      input_artifacts: [
        { id: "source-novel", revision: intake.revision.id },
        { id: "source-habits-notes", revision: appended.current_revision_id },
      ],
      extensions: { curation_run_id: "quality-2" },
    });
    expect(next.gates.every((gate) => gate.status === "pending" && gate.input_revisions.length === 0)).toBe(true);
    const curator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "fact-curator" });
    const claimed = await workflowTools.task_claim({
      trusted: curator, workflow: next, projectRoot: fixture.projectRoot,
      args: {
        task_id: "curate-facts-recurate-quality-2", lease_id: "append-lease", lease_duration_ms: 60_000,
        expected_workflow_revision: 2, event_id: "append-claimed", occurred_at: "2026-07-18T00:03:00.000Z",
      },
    });
    const created = await sourceTools.source_create_chunks({
      trusted: curator, workflow: claimed, projectRoot: fixture.projectRoot,
      args: {
        task_id: "curate-facts-recurate-quality-2", lease_id: "append-lease",
        source_id: "habits-notes", source_revision_id: appended.current_revision_id,
        expected_workflow_revision: 3, event_id: "append-job-created", occurred_at: "2026-07-18T00:04:00.000Z",
      },
    });
    const binding = created.workflow.tasks[1]!.extensions.source_jobs as Record<string, { job_id: string }>;
    await expect(getJobStatus(fixture.projectRoot, binding["habits-notes"]!.job_id)).resolves.toMatchObject({
      extensions: { curation_run_id: "quality-2" },
    });
  });

  it("advertises the complete task claim contract", () => {
    const tool = toolRegistry.task_claim;
    if (!tool || tool.scope !== "project") throw new Error("task_claim is not project-scoped");
    expect(tool.inputSchema.safeParse({
      project_id: "workflow-start",
      task_id: "create-blueprint",
    }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      project_id: "workflow-start",
      task_id: "create-blueprint",
      lease_id: "blueprint-lease",
      lease_duration_ms: 60_000,
      expected_workflow_revision: 1,
      event_id: "blueprint-claimed",
      occurred_at: "2026-07-15T12:01:00+08:00",
    }).success).toBe(true);
  });

  it("advertises typed Blueprint proposal and conditional chunk claim contracts", () => {
    const blueprintTool = toolRegistry.blueprint_submit_proposal;
    const chunkTool = toolRegistry.source_get_chunk_task;
    if (!blueprintTool || blueprintTool.scope !== "project") throw new Error("blueprint_submit_proposal is not project-scoped");
    if (!chunkTool || chunkTool.scope !== "project") throw new Error("source_get_chunk_task is not project-scoped");
    expect(blueprintTool.inputSchema.safeParse({
      project_id: "kito-ran",
      task_id: "create-blueprint",
      lease_id: "blueprint-lease",
    }).success).toBe(false);
    expect(blueprintTool.inputSchema.safeParse({
      project_id: "kito-ran",
      task_id: "create-blueprint",
      lease_id: "blueprint-lease",
      expected_workflow_revision: 2,
      event_id: "blueprint-submitted",
      occurred_at: "2026-07-15T12:02:00+08:00",
      proposal: {
        schema_version: 1,
        id: "blueprint-proposal-1",
        owner: "director",
        base_workflow_revision: 2,
        value: {
          kind: "blueprint",
          document: {
            schema_version: 1,
            project_id: "kito-ran",
            entry_kind: "original",
            purpose: "Create a detailed original character card.",
            characters: [{ id: "character-1", display_name: "Kito Ran", mode: "zhuji", core_concept: "A charismatic school leader." }],
            world: { enabled: true, categories: [], scope: "Modern urban school." },
            greetings: { enabled: true, character_ids: ["character-1"], requirements: ["Preserve player agency."] },
          },
        },
      },
    }).success).toBe(true);
    expect(chunkTool.inputSchema.safeParse({ project_id: "kito-ran", task_id: "curate-facts", lease_id: "task-lease", job_id: "job-1", claim: false }).success).toBe(true);
    expect(chunkTool.inputSchema.safeParse({ project_id: "kito-ran", task_id: "curate-facts", lease_id: "task-lease", job_id: "job-1", claim: true }).success).toBe(false);
  });

  it("starts an empty intake workflow and lets Director complete the materialized Blueprint task", async () => {
    const fixture = await setupMcpWorkspace("workflow-start");
    cleanups.push(fixture.workspace.cleanup);
    const { server } = await createMcpServer({ environment: fixture.environment });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const started = await client.callTool({
      name: "workflow_start",
      arguments: {
        project_id: "workflow-start",
        expected_workflow_revision: 0,
        event_id: "workflow-started",
        occurred_at: "2026-07-14T00:00:00.000Z",
        intake_answers: [{ decision_id: "intake-concept", question_id: "concept", answer: "A constrained premise" }],
        intake_completion: { decision_id: "intake-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
      },
    });
    expect(started.isError).not.toBe(true);
    const startedState = JSON.parse((started.content[0] as { text: string }).text) as { result: { stage: string; revision: number; tasks: Array<{ id: string }> } };
    expect(startedState.result).toMatchObject({ stage: "blueprint", revision: 1, tasks: [{ id: "create-blueprint" }] });
    const claimed = await client.callTool({
      name: "task_claim",
      arguments: {
        project_id: "workflow-start",
        task_id: "create-blueprint",
        expected_workflow_revision: 1,
        event_id: "blueprint-claimed",
        occurred_at: "2026-07-14T00:01:00.000Z",
        lease_id: "blueprint-lease",
        lease_duration_ms: 60_000,
      },
    });
    expect(claimed.isError).not.toBe(true);
    expect((claimed.content[0] as { text: string }).text).toContain('"status":"claimed"');
    const claimedState = JSON.parse((claimed.content[0] as { text: string }).text) as {
      result: { tasks: Array<{ id: string; lease?: { claimed_at: string; expires_at: string } }> };
    };
    const blueprintLease = claimedState.result.tasks.find((task) => task.id === "create-blueprint")?.lease;
    expect(blueprintLease).toBeDefined();
    expect(Date.parse(blueprintLease!.expires_at) - Date.parse(blueprintLease!.claimed_at)).toBe(30 * 60 * 1000);
    const projectBeforeProposal = await loadAuthorProject(fixture.workspace.projectsRoot, "workflow-start");
    const submitted = await client.callTool({
      name: "blueprint_submit_proposal",
      arguments: {
        project_id: "workflow-start",
        task_id: "create-blueprint",
        lease_id: "blueprint-lease",
        expected_workflow_revision: 2,
        event_id: "blueprint-submitted",
        occurred_at: "2026-07-14T00:02:00.000Z",
        expected_artifact_revisions: {
          "blueprint.yaml": projectBeforeProposal.sourceRevisions["blueprint.yaml"] ?? "absent",
        },
        proposal: {
          schema_version: 1,
          id: "blueprint-proposal-1",
          owner: "director",
          base_workflow_revision: 2,
          value: {
            kind: "blueprint",
            document: {
              schema_version: 1,
              project_id: "workflow-start",
              entry_kind: "original",
              purpose: "Create a detailed original character card.",
              characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "A constrained protagonist." }],
              world: { enabled: false, categories: [] },
              greetings: { enabled: true, character_ids: ["alice"], requirements: ["Preserve player agency."] },
            },
          },
        },
      },
    });
    expect(submitted.isError, JSON.stringify(submitted)).not.toBe(true);
    expect((submitted.content[0] as { text: string }).text).toContain('"status":"completed"');
    expect((submitted.content[0] as { text: string }).text).toContain('"id":"blueprint-proposal-1"');
    const submittedBody = JSON.parse((submitted.content[0] as { text: string }).text) as {
      result: { state: { revision: number; artifacts: Array<{ id: string; revision: string }> } };
    };
    const blueprintArtifact = submittedBody.result.state.artifacts.find((item) => item.id === "blueprint");
    expect(blueprintArtifact).toBeDefined();
    const approved = await client.callTool({
      name: "workflow_approve_gate",
      arguments: {
        project_id: "workflow-start",
        expected_workflow_revision: 3,
        event_id: "blueprint-approved",
        occurred_at: "2026-07-14T00:03:00.000Z",
        decision_id: "blueprint-gate-approved",
        gate_id: "blueprint",
        input_revisions: [{ id: blueprintArtifact!.id, revision: blueprintArtifact!.revision }],
        summary: "User approved the Blueprint.",
      },
    });
    expect(approved.isError, JSON.stringify(approved)).not.toBe(true);
    const advanced = await client.callTool({
      name: "workflow_advance",
      arguments: {
        project_id: "workflow-start",
        expected_workflow_revision: 4,
        event_id: "authoring-started",
        occurred_at: "2026-07-14T00:04:00.000Z",
      },
    });
    expect(advanced.isError, JSON.stringify(advanced)).not.toBe(true);
    const advancedText = (advanced.content[0] as { text: string }).text;
    expect(advancedText).toContain('"stage":"authoring"');
    expect(advancedText).toContain('"id":"create-alice-appearance"');
    expect(advancedText).not.toContain("create-alice-basic_information");
    await client.close();
    await server.close();

    const { server: creatorServer } = await createMcpServer({ environment: { ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" } });
    const [creatorClientTransport, creatorServerTransport] = InMemoryTransport.createLinkedPair();
    await creatorServer.connect(creatorServerTransport);
    const creatorClient = new Client({ name: "creator-test", version: "1" });
    await creatorClient.connect(creatorClientTransport);
    const creatorClaim = await creatorClient.callTool({
      name: "task_claim",
      arguments: {
        project_id: "workflow-start", task_id: "create-character-alice", lease_id: "alice-character-lease",
        lease_duration_ms: 60_000, expected_workflow_revision: 5, event_id: "alice-character-claimed", occurred_at: "2026-07-14T00:05:00.000Z",
      },
    });
    expect(creatorClaim.isError, JSON.stringify(creatorClaim)).not.toBe(true);
    const creatorClaimState = JSON.parse((creatorClaim.content[0] as { text: string }).text) as {
      result: { tasks: Array<{ id: string; lease?: { claimed_at: string; expires_at: string } }> };
    };
    const creatorLease = creatorClaimState.result.tasks.find((task) => task.id === "create-character-alice")?.lease;
    expect(creatorLease).toBeDefined();
    expect(Date.parse(creatorLease!.expires_at) - Date.parse(creatorLease!.claimed_at)).toBe(30 * 60 * 1000);
    const taskContext = await creatorClient.callTool({
      name: "task_context",
      arguments: { project_id: "workflow-start", task_id: "create-character-alice", lease_id: "alice-character-lease" },
    });
    expect(taskContext.isError, JSON.stringify(taskContext)).not.toBe(true);
    const taskContextText = (taskContext.content[0] as { text: string }).text;
    expect(taskContextText).toContain('"id":"create-character-alice"');
    expect(taskContextText).not.toContain('"purpose":"Create a detailed original character card."');
    expect(taskContextText).not.toContain('"characters"');
    const blueprintContext = await creatorClient.callTool({
      name: "task_context",
      arguments: {
        project_id: "workflow-start", task_id: "create-character-alice", lease_id: "alice-character-lease", artifact_id: "blueprint",
      },
    });
    expect(blueprintContext.isError, JSON.stringify(blueprintContext)).not.toBe(true);
    const blueprintText = (blueprintContext.content[0] as { text: string }).text;
    expect(blueprintText).toContain('"artifact":{"id":"blueprint"');
    const blueprintResult = JSON.parse(blueprintText) as { result: Record<string, unknown> };
    expect(blueprintResult.result).not.toHaveProperty("characters");
    expect(blueprintResult.result).not.toHaveProperty("manifest");
    await creatorClient.close();
    await creatorServer.close();
  });

  it("uses bound identity and returns the persisted workflow", async () => {
    const fixture = await setupMcpWorkspace("workflow-mcp");
    cleanups.push(fixture.workspace.cleanup);
    const { server } = await createMcpServer({ environment: fixture.environment });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "workflow_status",
      arguments: { project_id: "workflow-mcp", agent_id: "zhuji-creator" },
    });
    expect(response.isError).not.toBe(true);
    expect((response.content[0] as { text: string }).text).toContain('"project_id":"workflow-mcp"');
    await client.close();
    await server.close();
  });

  it("returns a compact claimable task queue to a specialist by default", async () => {
    const fixture = await setupMcpWorkspace("workflow-task-queue");
    cleanups.push(fixture.workspace.cleanup);
    const revision = `sha256:${"a".repeat(64)}`;
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "task-queue-created",
      actor: "engine",
      occurredAt: "2026-07-19T12:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 1,
        tasks: [{
          id: "completed-history",
          kind: "create-character",
          status: "completed",
          assigned_agent: "zhuji-creator",
          capabilities: ["task.execute"],
          input_artifacts: [],
          output_contract: "proposal@1",
          dependencies: [],
          attempt: 1,
          max_attempts: 3,
          result: { id: "completed-history-result", revision, contract: "proposal@1" },
          extensions: {},
        }, {
          id: "revise-character-base-run-1",
          kind: "create-character",
          status: "claimed",
          assigned_agent: "zhuji-creator",
          capabilities: ["task.execute", "character.propose"],
          input_artifacts: [],
          output_contract: "proposal@1",
          dependencies: [],
          lease: {
            id: "resumable-lease",
            owner: "zhuji-creator",
            claimed_at: "2026-07-19T12:00:00.000Z",
            expires_at: "2099-07-19T12:30:00.000Z",
          },
          attempt: 1,
          max_attempts: 3,
          extensions: { character_id: "alice", output_kind: "character" },
        }, {
          id: "revise-appearance-run-1",
          kind: "create-character-module",
          status: "pending",
          assigned_agent: "zhuji-creator",
          capabilities: ["task.execute", "character.propose"],
          input_artifacts: [{ id: "author-appearance", revision }],
          output_contract: "proposal@1",
          dependencies: ["revise-character-base-run-1"],
          attempt: 0,
          max_attempts: 3,
          extensions: { character_id: "alice", module: "appearance", output_kind: "zhuji" },
        }, {
          id: "other-agent-task",
          kind: "review-character",
          status: "pending",
          assigned_agent: "character-critic",
          capabilities: ["task.execute"],
          input_artifacts: [],
          output_contract: "review-report@1",
          dependencies: [],
          attempt: 0,
          max_attempts: 3,
          extensions: {},
        }],
      }),
    });
    const { server } = await createMcpServer({ environment: {
      ...fixture.environment,
      CARD_WORKSPACE_AGENT_ID: "zhuji-creator",
    } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);

    const response = await client.callTool({
      name: "workflow_status",
      arguments: { project_id: "workflow-task-queue" },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const text = (response.content[0] as { text: string }).text;
    const parsed = JSON.parse(text) as {
      result: {
        workflow: { revision: number; tasks?: unknown[] };
        active_tasks: Array<{ id: string; claimable: boolean; resumable: boolean; blocked_by: string[] }>;
        next_claimable_tasks: Array<{ id: string }>;
        resumable_tasks: Array<{ id: string; lease: { id: string } }>;
      };
    };
    expect(parsed.result.workflow.revision).toBe(1);
    expect(parsed.result.workflow).not.toHaveProperty("tasks");
    expect(parsed.result.active_tasks).toEqual([
      expect.objectContaining({ id: "revise-character-base-run-1", claimable: false, resumable: true, blocked_by: [], lease_expired: false }),
      expect.objectContaining({ id: "revise-appearance-run-1", claimable: false, resumable: false, blocked_by: ["revise-character-base-run-1"] }),
    ]);
    expect(parsed.result.next_claimable_tasks).toEqual([]);
    expect(parsed.result.resumable_tasks).toEqual([
      expect.objectContaining({ id: "revise-character-base-run-1", lease: { id: "resumable-lease", owner: "zhuji-creator", claimed_at: "2026-07-19T12:00:00.000Z", expires_at: "2099-07-19T12:30:00.000Z" } }),
    ]);
    expect(text).not.toContain("completed-history-result");
    expect(text).not.toContain("other-agent-task");

    await client.close();
    await server.close();
  });

  it("persists a published project's world-only authoring run", async () => {
    const fixture = await setupMcpWorkspace("world-authoring");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const published = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "project-published",
      actor: "engine",
      occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        stage: "published",
        revision: 1,
        gates: [
          { id: "content", status: "approved", input_revisions: [], extensions: {} },
          { id: "publish", status: "approved", input_revisions: [], extensions: {} },
        ],
      }),
    });
    const begun = await workflowTools.world_authoring_begin({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: published,
      args: {
        expected_workflow_revision: 1,
        event_id: "world-authoring-begun",
        occurred_at: "2026-07-14T00:01:00.000Z",
        run_id: "world-run-2",
        world: { enabled: true, categories: ["geography"], scope: "Expanded setting" },
      },
    });
    expect(begun).toMatchObject({
      stage: "authoring",
      revision: 2,
      tasks: [{ id: "create-world-world-run-2", kind: "create-world", status: "pending" }],
    });
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "world-authoring");
    expect(loaded.blueprint?.world).toMatchObject({ enabled: true, categories: ["geography"], scope: "Expanded setting" });
    expect(loaded.workflow?.gates.map((gate) => [gate.id, gate.status])).toEqual([["content", "pending"], ["publish", "pending"]]);
  });

  it("creates selected World revision tasks without reopening completed World tasks", async () => {
    const fixture = await setupMcpWorkspace("world-revision");
    cleanups.push(fixture.workspace.cleanup);
    await writeYamlFixture(path.join(fixture.projectRoot, "world/organizations/group.yaml"), {
      schema_version: 1, id: "group", category: "organizations", title: "Group", content: "Existing group", related_ids: [],
    });
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "world-revision");
    const targetId = "author-world-organizations-group.yaml";
    const targetRevision = loaded.sourceRevisions["world/organizations/group.yaml"];
    if (!targetRevision) throw new Error("World revision fixture is missing target revision");
    const reviewed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "world-reviewed", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "pre_world_review", revision: 1,
        artifacts: [{ id: targetId, status: "draft", revision: targetRevision, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
        tasks: [{
          id: "review-world", kind: "review-world", status: "completed", assigned_agent: "world-lore-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "world-review-v1", revision: `sha256:${"a".repeat(64)}` }, extensions: { stage: "pre_world_review" },
        }],
      }),
    });
    const begun = await workflowTools.world_revision_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: reviewed,
      args: {
        expected_workflow_revision: 1, event_id: "world-revision-begun", occurred_at: "2026-07-14T00:01:00.000Z",
        run_id: "world-fix-1", reason: "Fix exact World Critic finding", artifact_ids: [targetId],
      },
    });
    expect(begun).toMatchObject({ stage: "pre_world_authoring", revision: 2 });
    expect(begun.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-world", status: "completed" }),
      expect.objectContaining({ id: "revise-world-organizations-group-world-fix-1", status: "pending", assigned_agent: "world-lore-creator" }),
    ]));
  });

  it("creates a new Greeting revision task without reopening the completed task", async () => {
    const fixture = await setupMcpWorkspace("greetings-revision");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const late = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "late-greetings-state", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "compile_preview", revision: 1,
        gates: [
          { id: "content", status: "approved", input_revisions: [], extensions: {} },
          { id: "publish", status: "approved", input_revisions: [], extensions: {} },
        ],
        tasks: [{
          id: "create-greetings", kind: "create-greetings", status: "completed", assigned_agent: "greetings-creator",
          capabilities: ["task.execute", "greetings.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "greetings-v1", revision: `sha256:${"a".repeat(64)}` }, extensions: { stage: "greetings_authoring" },
        }],
      }),
    });
    const begun = await workflowTools.greetings_revision_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: late,
      args: {
        expected_workflow_revision: 1, event_id: "greetings-revision-begun", occurred_at: "2026-07-14T00:01:00.000Z",
        run_id: "name-fix-1", reason: "Correct an exact name mismatch",
      },
    });
    expect(begun).toMatchObject({ stage: "greetings_authoring", revision: 2 });
    expect(begun.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "create-greetings", status: "completed" }),
      expect.objectContaining({ id: "revise-greetings-name-fix-1", status: "pending" }),
    ]));
  });

  it("creates selected Character revision tasks without reopening completed Creator tasks", async () => {
    const fixture = await setupMcpWorkspace("character-revision");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "character-revision");
    const targetId = "author-characters-alice-zhuji-01-appearance.yaml";
    const targetRevision = loaded.sourceRevisions["characters/alice/zhuji/01-appearance.yaml"];
    if (!targetRevision) throw new Error("Character revision fixture is missing appearance revision");
    const late = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "late-character-state", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "compile_preview", revision: 1,
        gates: [
          { id: "content", status: "approved", input_revisions: [], extensions: {} },
          { id: "publish", status: "approved", input_revisions: [], extensions: {} },
        ],
        artifacts: [{ id: targetId, status: "draft", revision: targetRevision, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
        tasks: [{
          id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "character-review-v1", revision: `sha256:${"a".repeat(64)}` }, extensions: { stage: "semantic_review" },
        }],
      }),
    });
    const begun = await workflowTools.character_revision_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: late,
      args: {
        expected_workflow_revision: 1, event_id: "character-revision-begun", occurred_at: "2026-07-14T00:01:00.000Z",
        run_id: "critic-fix-1", reason: "Fix exact Character Critic finding", artifact_ids: [targetId],
      },
    });
    expect(begun).toMatchObject({ stage: "authoring", revision: 2 });
    expect(begun.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-characters", status: "completed" }),
      expect.objectContaining({ id: "revise-alice-appearance-critic-fix-1", status: "pending", assigned_agent: "zhuji-creator" }),
    ]));
  });

  it("atomically routes a rejected Content Gate to exact Character revision tasks", async () => {
    const fixture = await setupMcpWorkspace("content-gate-character-revision");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "content-gate-character-revision");
    const targetId = "author-characters-alice-zhuji-01-appearance.yaml";
    const targetRevision = loaded.sourceRevisions["characters/alice/zhuji/01-appearance.yaml"];
    if (!targetRevision) throw new Error("Content revision fixture is missing appearance revision");
    const content = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "content-review-ready", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "content_review", revision: 1,
        gates: [
          { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
          { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
          { id: "content", status: "pending", input_revisions: [], extensions: {} },
          { id: "publish", status: "pending", input_revisions: [], extensions: {} },
        ],
        artifacts: [{ id: targetId, status: "draft", revision: targetRevision, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
        tasks: [{
          id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "character-review-v1", revision: `sha256:${"a".repeat(64)}` }, extensions: { stage: "semantic_review" },
        }],
      }),
    });
    const rejected = await workflowTools.workflow_reject_gate({
      trusted, projectRoot: fixture.projectRoot, workflow: content,
      args: {
        expected_workflow_revision: 1,
        event_id: "content-reject-and-route",
        occurred_at: "2026-07-14T00:01:00.000Z",
        decision_id: "content-reject-character",
        gate_id: "content",
        input_revisions: [{ id: targetId, revision: targetRevision }],
        summary: "Revise exact appearance details",
        rejection_route: "content_revision",
        revision_scope: ["character"],
        revision_run_id: "content-character-fix-1",
        revision_artifact_ids: [targetId],
      },
    });
    expect(rejected.stage).toBe("authoring");
    expect(rejected.gates.find((gate) => gate.id === "content")?.status).toBe("pending");
    expect(rejected.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "content-reject-character", kind: "gate.reject" }),
      expect.objectContaining({ id: "character-revision-content-character-fix-1", kind: "character.revision.requested" }),
    ]));
    expect(rejected.tasks.at(-1)).toMatchObject({
      id: "revise-alice-appearance-content-character-fix-1",
      status: "pending",
      assigned_agent: "zhuji-creator",
      extensions: { target_artifact_id: targetId },
    });
  });

  it("binds the initialized relationship placeholder into the materialized Creator task", async () => {
    const fixture = await setupMcpWorkspace("relationship-materialize", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "relationship-materialize");
    const blueprintRevision = loaded.sourceRevisions["blueprint.yaml"]!;
    const relationshipRevision = loaded.sourceRevisions["relationships.yaml"]!;
    const ready = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "relationship-blueprint-ready", actor: "engine", occurredAt: "2026-07-18T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "blueprint", revision: 1,
        gates: [
          { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
          { id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision: blueprintRevision }], extensions: {} },
          { id: "content", status: "pending", input_revisions: [], extensions: {} },
          { id: "publish", status: "pending", input_revisions: [], extensions: {} },
        ],
        artifacts: [{ id: "blueprint", status: "draft", revision: blueprintRevision, contract: "blueprint@1", updated_at: "2026-07-18T00:00:00.000Z", extensions: {} }],
      }),
    });
    const authoring = await workflowTools.workflow_advance({
      trusted, projectRoot: fixture.projectRoot, workflow: ready,
      args: { expected_workflow_revision: 1, event_id: "relationship-authoring", occurred_at: "2026-07-18T00:01:00.000Z" },
    });
    expect(authoring.artifacts).toContainEqual(expect.objectContaining({ id: "author-relationships.yaml", revision: relationshipRevision, contract: "relationships@1" }));
    const relationshipTask = authoring.tasks.find((task) => task.kind === "create-relationships");
    expect(relationshipTask?.assigned_agent).toBe("relationship-creator");
    expect(relationshipTask?.input_artifacts).toContainEqual({ id: "author-relationships.yaml", revision: relationshipRevision, contract: "relationships@1" });
  });

  it("targets the exact relationship artifact with a Relationship Creator revision task", async () => {
    const fixture = await setupMcpWorkspace("relationship-revision", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "relationship-revision");
    const targetRevision = loaded.sourceRevisions["relationships.yaml"]!;
    const late = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "relationship-late-state", actor: "engine", occurredAt: "2026-07-18T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "compile_preview", revision: 1,
        gates: [
          { id: "content", status: "approved", input_revisions: [], extensions: {} },
          { id: "publish", status: "approved", input_revisions: [], extensions: {} },
        ],
        artifacts: [
          { id: "author-relationships.yaml", status: "approved", revision: targetRevision, contract: "relationships@1", updated_at: "2026-07-18T00:00:00.000Z", extensions: {} },
          { id: "preview-old", status: "reviewed", revision: `sha256:${"b".repeat(64)}`, updated_at: "2026-07-18T00:00:00.000Z", extensions: {} },
        ],
        tasks: [{
          id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "review-v1", revision: `sha256:${"c".repeat(64)}` }, extensions: { stage: "semantic_review" },
        }],
      }),
    });
    const begun = await workflowTools.character_revision_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: late,
      args: { expected_workflow_revision: 1, event_id: "relationship-revision-begun", occurred_at: "2026-07-18T00:01:00.000Z", run_id: "graph-fix-1", reason: "Fix directional inconsistency", artifact_ids: ["author-relationships.yaml"] },
    });
    expect(begun).toMatchObject({ stage: "authoring", revision: 2 });
    expect(begun.tasks.at(-1)).toMatchObject({
      id: "revise-relationships-graph-fix-1", kind: "create-relationships", assigned_agent: "relationship-creator",
      capabilities: ["task.execute", "relationships.propose", "task.clarify"],
      extensions: { output_kind: "relationships", participant_ids: ["alice", "beth"], target_artifact_id: "author-relationships.yaml" },
    });
    expect(begun.artifacts.find((item) => item.id === "preview-old")?.status).toBe("stale");
    expect(begun.gates.map((gate) => gate.status)).toEqual(["pending", "pending"]);
  });

  it("atomically expands a Character card, amends a rejected candidate, and materializes only approved work", async () => {
    const fixture = await setupMcpWorkspace("character-expansion");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "character-expansion");
    const appearanceId = "author-characters-alice-zhuji-01-appearance.yaml";
    const appearanceRevision = loaded.sourceRevisions["characters/alice/zhuji/01-appearance.yaml"];
    if (!loaded.blueprint || !appearanceRevision) throw new Error("Expansion fixture is incomplete");
    const late = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "expansion-late-state", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "published", revision: 1,
        gates: [
          { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
          { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
          { id: "content", status: "approved", input_revisions: [], extensions: {} },
          { id: "publish", status: "approved", input_revisions: [], extensions: {} },
        ],
        artifacts: [
          { id: appearanceId, status: "draft", revision: appearanceRevision, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} },
          { id: "preview-old", status: "reviewed", revision: `sha256:${"b".repeat(64)}`, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} },
        ],
        tasks: [{
          id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "review-v1", revision: `sha256:${"c".repeat(64)}` }, extensions: { stage: "semantic_review" },
        }],
      }),
    });
    const candidate = {
      ...loaded.blueprint,
      characters: [...loaded.blueprint.characters, { id: "beth", display_name: "Beth", mode: "palette" as const, core_concept: "Supporting character", relationship_summary: "A supporting relationship" }],
      greetings: { ...loaded.blueprint.greetings, character_ids: ["alice", "beth"] },
      relationships: { enabled: true, character_ids: ["alice", "beth"], requirements: [], extensions: {} },
      approved_revision: 99,
    };
    const formalPaths = ["project.yaml", "blueprint.yaml", "characters/alice/character.yaml"];
    const formalBefore = await Promise.all(formalPaths.map((relative) => readFile(path.join(fixture.projectRoot, relative))));
    const begun = await workflowTools.character_expansion_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: late,
      args: {
        expected_workflow_revision: 1, event_id: "character-expansion-begun", occurred_at: "2026-07-14T00:01:00.000Z",
          run_id: "add-beth-1", reason: "Add a supporting rival", new_title: "Expanded cast",
          new_characters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Supporting character", relationship_summary: "A supporting relationship" }],
        candidate_blueprint: candidate, affected_artifact_ids: [appearanceId], revise_world: false,
      },
    });
    expect(begun).toMatchObject({ stage: "blueprint", revision: 2 });
    expect(begun.tasks.filter((task) => task.status === "pending")).toEqual([]);
    expect(begun.gates.find((gate) => gate.id === "blueprint")?.status).toBe("pending");
    expect(begun.artifacts.find((item) => item.id === "preview-old")?.status).toBe("reviewed");
    const expanded = await loadAuthorProject(fixture.workspace.projectsRoot, "character-expansion");
    expect(expanded.manifest?.characters.map((item) => item.id)).toEqual(["alice"]);
    expect(await Promise.all(formalPaths.map((relative) => readFile(path.join(fixture.projectRoot, relative))))).toEqual(formalBefore);
    await expect(readFile(path.join(fixture.projectRoot, "characters", "beth", "palette", "04-secondary-interpretation.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const rejected = await workflowTools.workflow_reject_gate({
      trusted, projectRoot: fixture.projectRoot, workflow: begun,
      args: { expected_workflow_revision: 2, event_id: "expansion-blueprint-rejected", occurred_at: "2026-07-14T00:02:00.000Z", decision_id: "reject-expansion-blueprint", gate_id: "blueprint", input_revisions: [], summary: "Clarify Beth's role" },
    });
    await expect(workflowTools.character_expansion_blueprint_update({
      trusted, projectRoot: fixture.projectRoot, workflow: rejected,
      args: {
        expected_workflow_revision: 3, event_id: "expansion-roster-change-rejected", occurred_at: "2026-07-14T00:02:30.000Z",
        run_id: "add-beth-1", reason: "Invalid roster change",
        candidate_blueprint: {
          ...expanded.blueprint!,
          characters: [...expanded.blueprint!.characters, { id: "cara", display_name: "?⊥?", mode: "palette", core_concept: "Unexpected" }],
          greetings: { ...expanded.blueprint!.greetings, character_ids: ["alice", "beth", "cara"] },
        },
      },
    })).rejects.toThrow(/摰靽?|identity/u);
    const amendedCandidate = { ...candidate, approved_revision: undefined, purpose: "A sharper two-character rivalry card" };
    const amended = await workflowTools.character_expansion_blueprint_update({
      trusted, projectRoot: fixture.projectRoot, workflow: rejected,
      args: { expected_workflow_revision: 3, event_id: "expansion-blueprint-amended", occurred_at: "2026-07-14T00:03:00.000Z", run_id: "add-beth-1", reason: "Clarified the shared purpose", candidate_blueprint: amendedCandidate },
    });
    expect(amended.gates.find((gate) => gate.id === "blueprint")?.status).toBe("pending");
    expect(amended.tasks.filter((task) => task.extensions.expansion_run_id === "add-beth-1")).toEqual([]);
    const amendedLoaded = await loadAuthorProject(fixture.workspace.projectsRoot, "character-expansion");
    expect(await Promise.all(formalPaths.map((relative) => readFile(path.join(fixture.projectRoot, relative))))).toEqual(formalBefore);
    const blueprintArtifact = amended.artifacts.find((item) => item.id === "character-expansion-candidate-add-beth-1-2");
    if (!blueprintArtifact?.revision) throw new Error("Amended expansion candidate artifact is missing");
    await expect(workflowTools.workflow_approve_gate({
      trusted, projectRoot: fixture.projectRoot, workflow: amended,
      args: { expected_workflow_revision: 4, event_id: "stale-expansion-approval", occurred_at: "2026-07-14T00:04:00.000Z", decision_id: "stale-expansion-approval", gate_id: "blueprint", input_revisions: [], summary: "Invalid approval" },
    })).rejects.toThrow(/exact current (Blueprint|snapshot)/u);
    await expect(workflowTools.workflow_approve_gate({
      trusted, projectRoot: fixture.projectRoot, workflow: amended,
      args: {
        expected_workflow_revision: 4, event_id: "expansion-approval-fault", occurred_at: "2026-07-14T00:04:15.000Z",
        decision_id: "expansion-approval-fault", gate_id: "blueprint",
        input_revisions: [{ id: blueprintArtifact.id, revision: blueprintArtifact.revision }], summary: "Fault injection",
        before_publish: (index: number) => { if (index === 2) throw new Error("materialization fault"); },
      },
    })).rejects.toThrow("materialization fault");
    expect(await Promise.all(formalPaths.map((relative) => readFile(path.join(fixture.projectRoot, relative))))).toEqual(formalBefore);
    const approved = await workflowTools.workflow_approve_gate({
      trusted, projectRoot: fixture.projectRoot, workflow: amended,
      args: { expected_workflow_revision: 4, event_id: "expansion-blueprint-approved", occurred_at: "2026-07-14T00:04:30.000Z", decision_id: "approve-expansion-blueprint", gate_id: "blueprint", input_revisions: [{ id: blueprintArtifact.id, revision: blueprintArtifact.revision }], summary: "Approve exact candidate" },
    });
    const authoring = await workflowTools.workflow_advance({
      trusted, projectRoot: fixture.projectRoot, workflow: approved,
      args: { expected_workflow_revision: 5, event_id: "expansion-authoring-started", occurred_at: "2026-07-14T00:05:00.000Z" },
    });
    const expansionTasks = authoring.tasks.filter((task) => task.extensions.expansion_run_id === "add-beth-1");
    expect(expansionTasks.map((task) => task.id)).toEqual([
      "revise-alice-appearance-add-beth-1", "create-beth-character-add-beth-1", "create-beth-basic_information-add-beth-1",
      "create-beth-personality_palette-add-beth-1", "create-beth-tri_faceted-add-beth-1", "create-beth-secondary_interpretation-add-beth-1",
      "create-relationships-add-beth-1",
    ]);
    expect(expansionTasks.at(-1)).toMatchObject({ assigned_agent: "relationship-creator", dependencies: ["revise-alice-appearance-add-beth-1", "create-beth-secondary_interpretation-add-beth-1"] });
    expect(amendedLoaded.manifest?.id).toBe("character-expansion");
    expect(fixture.projectRoot.endsWith(path.join("projects", "character-expansion"))).toBe(true);
  });

  it("creates a new Character Review retry task without erasing the failed review", async () => {
    const fixture = await setupMcpWorkspace("character-review-retry");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const failed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "character-review-failed", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "semantic_review", revision: 1,
        artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
        tasks: [{
          id: "review-characters", kind: "review-character", status: "failed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [{ id: "blueprint", revision: `sha256:${"a".repeat(64)}` }],
          output_contract: "review-report@1", dependencies: [], attempt: 3, max_attempts: 3,
          failure_summary: "Context truncated",
          failure: { category: "context_limit", summary: "Context truncated", failed_at: "2026-07-14T00:00:00.000Z", failed_by: "character-critic", attempt: 3 },
          extensions: { stage: "semantic_review" },
        }],
      }),
    });
    const begun = await workflowTools.character_review_retry_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: failed,
      args: {
        expected_workflow_revision: 1, event_id: "character-review-retry-begun", occurred_at: "2026-07-14T00:01:00.000Z",
        run_id: "context-1", reason: "Read exact artifacts separately",
      },
    });
    expect(begun.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-characters", status: "superseded", attempt: 3 }),
      expect.objectContaining({ id: "recover-context-1", status: "pending", attempt: 0, max_attempts: 1 }),
    ]));
  });

  it("atomically creates a generic recovery successor and rewires direct dependents", async () => {
    const fixture = await setupMcpWorkspace("task-recovery");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const failed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "task-terminal-failure", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "authoring", revision: 1,
        tasks: [
          {
            id: "create-alice", kind: "create-character", status: "failed", assigned_agent: "zhuji-creator",
            capabilities: ["task.execute", "character.propose"], input_artifacts: [{ id: "blueprint", revision: `sha256:${"a".repeat(64)}` }],
            output_contract: "proposal@1", dependencies: [], attempt: 3, max_attempts: 3, failure_summary: "Provider timeout",
            failure: { category: "provider_timeout", summary: "Provider timeout", failed_at: "2026-07-14T00:00:00.000Z", failed_by: "zhuji-creator", attempt: 3 },
            extensions: { stage: "authoring", character_id: "alice" },
          },
          {
            id: "create-alice-module", kind: "create-character-module", status: "pending", assigned_agent: "zhuji-creator",
            capabilities: ["task.execute", "character.propose"], input_artifacts: [], output_contract: "proposal@1",
            dependencies: ["create-alice"], attempt: 0, max_attempts: 3, extensions: { stage: "authoring", character_id: "alice", module: "appearance" },
          },
        ],
      }),
    });
    const recovered = await workflowTools.task_recovery_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: failed,
      args: {
        expected_workflow_revision: 1, event_id: "task-recovery-begun", occurred_at: "2026-07-14T00:01:00.000Z",
        task_id: "create-alice", run_id: "provider-1", failure_category: "provider_timeout", reason: "Retry transient provider failure",
      },
    });
    expect(recovered.tasks.find((task) => task.id === "create-alice")).toMatchObject({
      status: "superseded",
      failure: { category: "provider_timeout", summary: "Provider timeout", failed_at: "2026-07-14T00:00:00.000Z", failed_by: "zhuji-creator", attempt: 3 },
    });
    expect(recovered.tasks.find((task) => task.id === "recover-provider-1")).toMatchObject({
      status: "pending", max_attempts: 1, extensions: { recovery_of: "create-alice" },
    });
    expect(recovered.tasks.find((task) => task.id === "create-alice-module")).toMatchObject({ dependencies: ["recover-provider-1"] });
    expect(recovered.decisions.at(-1)).toMatchObject({ kind: "task.recovery.requested", extensions: { successor_task_id: "recover-provider-1" } });
  });

  it("resumes the same recovery-exhausted task once after an audited project repair", async () => {
    const fixture = await setupMcpWorkspace("task-repair-resume");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const exhausted = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "recovery-exhausted", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, stage: "greetings_authoring", revision: 1,
        tasks: [{
          id: "recover-greetings-1", kind: "create-greetings", status: "needs_user_decision", assigned_agent: "greetings-creator",
          capabilities: ["task.execute", "greetings.propose"], input_artifacts: [{ id: "blueprint", revision: `sha256:${"a".repeat(64)}` }],
          output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 1,
          failure_summary: "Project invalid", failure: { category: "temporary_unavailable", summary: "Project invalid", failed_at: "2026-07-14T00:00:00.000Z", failed_by: "greetings-creator", attempt: 1 },
          extensions: { stage: "greetings_authoring", recovery_of: "create-greetings", recovery_generation: 1, recovery_exhausted: true },
        }],
      }),
    });
    const resumed = await workflowTools.task_repair_resume({
      trusted: director, workflow: exhausted, projectRoot: fixture.projectRoot,
      args: {
        task_id: "recover-greetings-1", run_id: "project-fixed-1", reason: "Removed invalid stray YAML and project validation passed",
        expected_workflow_revision: 1, event_id: "repair-resumed", occurred_at: "2026-07-14T00:01:00.000Z",
      },
    });
    expect(resumed.tasks[0]).toMatchObject({ status: "pending", attempt: 1, max_attempts: 1, resume_without_attempt: true, extensions: { repair_resume_count: 1 } });
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "greetings-creator" });
    const claimed = await workflowTools.task_claim({
      trusted: creator, workflow: resumed, projectRoot: fixture.projectRoot,
      args: {
        task_id: "recover-greetings-1", lease_id: "repair-resume-lease", lease_duration_ms: 60_000,
        expected_workflow_revision: 2, event_id: "repair-resume-claimed", occurred_at: "2026-07-14T00:02:00.000Z",
      },
    });
    expect(claimed.tasks[0]).toMatchObject({ status: "claimed", attempt: 1, max_attempts: 1 });
    expect(claimed.tasks[0]?.resume_without_attempt).toBeUndefined();
  });

  it("pauses and resumes an assisted Creator task through Director clarification", async () => {
    const fixture = await setupMcpWorkspace("assisted-clarification", "original", "assisted");
    cleanups.push(fixture.workspace.cleanup);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
    const director = await createTrustedContext(fixture.environment);
    const claimed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "clarification-task-created",
      actor: "engine",
      occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        stage: "authoring",
        tasks: [{
          id: "create-alice-extension", kind: "create-character-module", status: "claimed", assigned_agent: "zhuji-creator",
          capabilities: ["task.execute", "task.clarify", "character.propose"], input_artifacts: [], output_contract: "proposal@1",
          dependencies: [], attempt: 1, max_attempts: 3,
          lease: { id: "lease-a", owner: "zhuji-creator", claimed_at: "2026-07-14T00:00:00.000Z", expires_at: "2099-07-14T01:00:00.000Z" },
          extensions: { module: "extension", output_kind: "zhuji", character_id: "alice", stage: "authoring" },
        }],
      }),
    });
    const creatorContext = (workflow: typeof claimed, args: Record<string, unknown>) => ({ trusted: creator, args, workflow, projectRoot: fixture.projectRoot });
    const directorContext = (workflow: typeof claimed, args: Record<string, unknown>) => ({ trusted: director, args, workflow, projectRoot: fixture.projectRoot });
    await expect(workflowTools.task_submit(creatorContext(claimed, {
      task_id: "create-alice-extension", lease_id: "lease-a", expected_workflow_revision: 1,
      event_id: "forged-proposal-submission", occurred_at: "2026-07-14T00:00:30.000Z",
      result: { contract: "proposal@1", id: "missing-proposal", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    }))).rejects.toThrow(/specialized proposal submission tool/u);
    const waiting = await workflowTools.task_request_clarification(creatorContext(claimed, {
      task_id: "create-alice-extension", lease_id: "lease-a", expected_workflow_revision: 1,
      event_id: "clarification-requested", occurred_at: "2026-07-14T00:01:00.000Z",
      clarification_id: "relationship-choice", decision_id: "relationship-request",
      question: "Which relationship direction should be primary?", reason: "Clarify relationship boundaries", affected_modules: ["extension", "scene-dialogue"],
      options: [{ id: "rivals", label: "Rivals", consequence: "Tension" }, { id: "partners", label: "Partners", consequence: "Trust" }],
    }));
    expect(waiting.tasks[0]).toMatchObject({ status: "needs_user_decision", attempt: 1 });
    expect(waiting.tasks[0]?.lease).toBeUndefined();
    const resolved = await workflowTools.task_resolve_clarification(directorContext(waiting, {
      task_id: "create-alice-extension", expected_workflow_revision: 2,
      event_id: "clarification-resolved", occurred_at: "2026-07-14T00:02:00.000Z",
        clarification_id: "relationship-choice", decision_id: "relationship-answer", answer: "Use rivals", selected_option: "rivals",
    }));
    expect(resolved.tasks[0]).toMatchObject({ status: "pending", attempt: 1, resume_without_attempt: true });
    const resumed = await workflowTools.task_claim(creatorContext(resolved, {
      task_id: "create-alice-extension", lease_id: "lease-b", lease_duration_ms: 60_000,
      expected_workflow_revision: 3, event_id: "clarification-resumed", occurred_at: "2026-07-14T00:03:00.000Z",
    }));
    expect(resumed.tasks[0]).toMatchObject({ status: "claimed", attempt: 1, lease: { id: "lease-b" } });
    const taskContext = await workflowTools.task_context(creatorContext(resumed, { task_id: "create-alice-extension", lease_id: "lease-b" })) as { authoring_decisions: Array<{ kind: string }> };
    expect(taskContext.authoring_decisions.map((decision) => decision.kind)).toEqual([
      "task.clarification.requested", "task.clarification.resolved",
    ]);
  });

  it("records a complete assisted Blueprint precheck against the exact candidate", async () => {
    const fixture = await setupMcpWorkspace("assisted-precheck", "original", "assisted");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "assisted-precheck");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("assisted precheck fixture incomplete");
    const claimed = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "blueprint-task-claimed",
      actor: "engine",
      occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        stage: "blueprint",
        revision: 1,
        tasks: [{
          id: "create-blueprint", kind: "create-blueprint", status: "claimed", assigned_agent: "director",
          capabilities: ["task.execute", "blueprint.propose"], input_artifacts: [], output_contract: "proposal@1",
          dependencies: [], attempt: 1, max_attempts: 3,
          lease: { id: "blueprint-lease", owner: "director", claimed_at: "2026-07-14T00:00:00.000Z", expires_at: "2099-07-14T01:00:00.000Z" },
          extensions: { stage: "blueprint" },
        }],
      }),
    });
    const dimensions = ["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"];
    const checks = dimensions.map((dimension) => ({
      subject_id: "alice", dimension, uncertainty: "low", impact: "high",
      basis: `${dimension} 撌脩 intake ?Ⅱ??`, action: "preserve_explicit",
    }));
    const context = (args: Record<string, unknown>) => ({ trusted: director, args, workflow: claimed, projectRoot: fixture.projectRoot });
    await expect(workflowTools.blueprint_precheck_record(context({
      task_id: "create-blueprint", lease_id: "blueprint-lease", expected_workflow_revision: 1,
      event_id: "incomplete-precheck", occurred_at: "2026-07-14T00:01:00.000Z",
      decision_id: "precheck-incomplete", candidate_blueprint: loaded.blueprint, checks: checks.slice(0, 5),
    }))).rejects.toThrow(/exactly one cross_module_impact/u);
    const recorded = await workflowTools.blueprint_precheck_record(context({
      task_id: "create-blueprint", lease_id: "blueprint-lease", expected_workflow_revision: 1,
      event_id: "precheck-recorded", occurred_at: "2026-07-14T00:02:00.000Z",
      decision_id: "precheck-complete", candidate_blueprint: loaded.blueprint, checks,
    }));
    expect(recorded.tasks[0]?.blueprint_precheck).toMatchObject({ schema_version: 1, checks });
    expect(recorded.decisions.at(-1)).toMatchObject({ id: "precheck-complete", kind: "blueprint.precheck.completed" });
  });

  it("executes workflow and task handlers against persistent state", async () => {
    const fixture = await setupMcpWorkspace("workflow-handlers");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "workflow-handlers");
    expect(loaded.workflow).toBeDefined();
    const initial = loaded.workflow!;
    const context = (workflow: typeof initial, args: Record<string, unknown>) => ({
      trusted,
      args,
      workflow,
      projectRoot: fixture.projectRoot,
    });

    await expect(workflowTools.workflow_start(context(initial, {
      expected_workflow_revision: 0,
      event_id: "missing-intake",
      occurred_at: "2026-07-14T00:00:00.000Z",
    }))).rejects.toThrow();

    const started = await workflowTools.workflow_start(context(initial, {
      expected_workflow_revision: 0,
      event_id: "workflow-started",
      occurred_at: "2026-07-14T00:00:00.000Z",
      intake_answers: [{ decision_id: "intake-concept", question_id: "concept", answer: "A constrained premise" }],
      intake_completion: { decision_id: "intake-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    }));
    expect(started).toMatchObject({
      stage: "blueprint",
      revision: 1,
      decisions: [
        { id: "intake-concept", kind: "interview.answer" },
        { id: "intake-complete", kind: "interview.complete", option: "no-additional-settings" },
        { id: "gate-facts-not-required", kind: "gate.not_required" },
      ],
      gates: [
        { id: "facts", status: "not_required" },
        { id: "blueprint", status: "pending" },
        { id: "content", status: "pending" },
        { id: "publish", status: "pending" },
      ],
      tasks: [{
        id: "create-blueprint", assigned_agent: "director", status: "pending",
        capabilities: ["task.execute", "blueprint.propose"], output_contract: "proposal@1",
      }],
    });
    await expect(workflowTools.workflow_start(context({ ...initial, workflow_definition_id: "missing" }, {
      expected_workflow_revision: 0, event_id: "bad-start", occurred_at: "2026-07-14T00:00:00.000Z",
    }))).rejects.toThrow(/does not match/u);

    const interviewed = await workflowTools.workflow_answer_interview(context(started, {
      expected_workflow_revision: 1,
      event_id: "interview-answered",
      occurred_at: "2026-07-14T00:01:00.000Z",
      question_id: "premise",
      decision_id: "decision-1",
      answer: "A constrained premise",
    }));
    expect(interviewed.revision).toBe(2);
    expect(interviewed.decisions.filter((decision) => decision.kind === "interview.answer")).toHaveLength(2);

    const pending = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 2,
      eventId: "task-created",
      actor: "engine",
      occurredAt: "2026-07-14T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 3,
        tasks: [{
          id: "task-1", kind: "draft", status: "pending", assigned_agent: "director",
          capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1",
          dependencies: [], attempt: 0, max_attempts: 2, extensions: {},
        }],
      }),
    });
    const claimed = await workflowTools.task_claim(context(pending, {
      expected_workflow_revision: 3,
      event_id: "task-claimed",
      occurred_at: "2026-07-14T00:03:00.000Z",
      task_id: "task-1",
      lease_id: "lease-1",
      lease_duration_ms: 60_000,
    }));
    expect(claimed.tasks[0]).toMatchObject({ status: "claimed", attempt: 1 });

    const failed = await workflowTools.task_fail(context(claimed, {
      expected_workflow_revision: 4,
      event_id: "task-failed",
      occurred_at: "2026-07-14T00:04:00.000Z",
      task_id: "task-1",
      failure_category: "invalid_output",
      summary: "Needs revision",
    }));
    expect(failed.tasks[0]).toMatchObject({
      status: "retryable", failure_summary: "Needs revision",
      failure: { category: "invalid_output", summary: "Needs revision", failed_at: "2026-07-14T00:04:00.000Z", failed_by: "director", attempt: 1 },
    });
  });

  it("covers workflow handler authorization and task context guards", async () => {
    const fixture = await setupMcpWorkspace("workflow-guard-matrix");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "workflow-guard-matrix");
    if (!loaded.workflow) throw new Error("guard fixture workflow missing");
    const initial = loaded.workflow;
    const context = (trusted: typeof director, workflow: typeof initial, args: Record<string, unknown>) => ({ trusted, workflow, args, projectRoot: fixture.projectRoot });
    const event = { expected_workflow_revision: initial.revision, event_id: "guard-event", occurred_at: "2026-07-21T00:00:00.000Z" };
    await expect(workflowTools.workflow_status(context(director, initial, { detail: "summary" }))).resolves.toMatchObject({ routing: "active" });
    await expect(workflowTools.workflow_status(context(director, initial, { detail: "full" }))).resolves.toMatchObject({ workflow: { stage: "intake" } });
    await expect(workflowTools.workflow_start(context(director, { ...initial, stage: "blueprint" }, event))).resolves.toMatchObject({ stage: "blueprint" });
    await expect(workflowTools.workflow_start(context(director, { ...initial, workflow_definition_id: "missing" }, event))).rejects.toThrow();
    await expect(workflowTools.task_claim(context(creator, initial, { task_id: "missing", lease_id: "lease", lease_duration_ms: 1000, ...event }))).rejects.toThrow();
    await expect(workflowTools.task_context(context(creator, initial, { task_id: "missing" }))).rejects.toThrow();
    await expect(workflowTools.task_submit(context(creator, initial, { task_id: "missing", result: {} }))).rejects.toThrow();
    await expect(workflowTools.task_fail(context(creator, initial, { task_id: "missing", summary: "fail", failure_category: "tool_failure", ...event }))).rejects.toThrow();
    await expect(workflowTools.task_release(context(creator, initial, { task_id: "missing", ...event }))).rejects.toThrow();
    for (const [name, args] of [
      ["world_revision_begin", {}],
      ["greetings_revision_begin", {}],
      ["character_revision_begin", {}],
      ["character_expansion_begin", {}],
      ["character_expansion_blueprint_update", {}],
      ["character_review_retry_begin", {}],
      ["task_recovery_begin", {}],
      ["task_repair_resume", {}],
      ["source_processing_repair_begin", {}],
      ["facts_recuration_begin", {}],
      ["blueprint_precheck_record", {}],
      ["task_resolve_clarification", {}],
    ] as const) {
      const tool = workflowTools[name as keyof typeof workflowTools] as (context: unknown) => Promise<unknown>;
      await expect(tool(context(creator, initial, args))).rejects.toThrow();
    }
    await expect(workflowTools.task_request_clarification(context(creator, initial, { ...event, task_id: "missing" }))).rejects.toThrow(/assisted/u);
    await expect(workflowTools.task_resolve_clarification(context(director, initial, { ...event, task_id: "missing", clarification_id: "missing", answer: "answer", decision_id: "decision" }))).rejects.toThrow();
    await expect(workflowTools.workflow_advance(context(director, initial, { ...event }))).resolves.toMatchObject({ stage: "blueprint" });

    const blueprintRevision = loaded.sourceRevisions["blueprint.yaml"];
    if (!blueprintRevision) throw new Error("guard fixture blueprint revision missing");
    const reviewTaskState = workflowStateSchema.parse({
      ...initial,
      stage: "semantic_review",
      revision: initial.revision + 2,
      tasks: [{
        id: "review-task", kind: "review-character", status: "claimed", assigned_agent: "director",
        capabilities: ["task.execute"], input_artifacts: [{ id: "blueprint", revision: blueprintRevision }],
        output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3,
        lease: { id: "review-lease", owner: "director", claimed_at: event.occurred_at, expires_at: "2099-07-21T00:00:00.000Z" },
        extensions: { stage: "semantic_review" },
      }],
    });
    const persistedReview = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: initial.revision + 1,
      eventId: "review-task-created",
      actor: "engine",
      occurredAt: event.occurred_at,
      update: () => reviewTaskState,
    });
    const artifactContext = await workflowTools.task_context(context(director, persistedReview, { task_id: "review-task", artifact_id: "blueprint" })) as { artifact: { id: string; content: unknown } };
    expect(artifactContext.artifact).toMatchObject({ id: "blueprint" });
    expect(artifactContext.artifact.content).toBeDefined();
    const submitted = await workflowTools.task_submit(context(director, persistedReview, {
      task_id: "review-task", lease_id: "review-lease", expected_workflow_revision: initial.revision + 2,
      event_id: "review-submitted", occurred_at: event.occurred_at,
      result: { id: "review-result", revision: `sha256:${"a".repeat(64)}`, contract: "review-report@1" },
    }));
    expect(submitted.tasks.find((task) => task.id === "review-task")).toMatchObject({ status: "completed", result: { id: "review-result" } });    await expect(workflowTools.task_context(context(director, submitted, { task_id: "review-task", artifact_id: "missing-artifact" }))).rejects.toThrow(/not assigned/u);
    await expect(workflowTools.task_submit(context(director, persistedReview, {
      task_id: "review-task", lease_id: "review-lease", expected_workflow_revision: initial.revision + 2,
      event_id: "review-contract-mismatch", occurred_at: event.occurred_at,
      result: { id: "review-result", revision: `sha256:${"a".repeat(64)}`, contract: "proposal@1" },
    }))).rejects.toThrow(/requires|contract/u);
    const leaseState = workflowStateSchema.parse({
      ...submitted,
      tasks: [{
        id: "create-blueprint", kind: "create-blueprint", status: "pending", assigned_agent: "director",
        capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 3, extensions: { stage: "blueprint" },
      }],
    });
    const leased = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: submitted.revision, eventId: "blueprint-task-reset", actor: "engine", occurredAt: event.occurred_at,
      update: () => workflowStateSchema.parse({ ...leaseState, revision: submitted.revision + 1 }),
    });
    const longLease = await workflowTools.task_claim(context(director, leased, {
      task_id: "create-blueprint", lease_id: "long-lease", lease_duration_ms: 1_000,
      expected_workflow_revision: leased.revision, event_id: "long-lease-claimed", occurred_at: event.occurred_at,
    }));
    const lease = longLease.tasks[0]?.lease;
    expect(lease).toBeDefined();
    expect(Date.parse(lease!.expires_at) - Date.parse(lease!.claimed_at)).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });
});

// Additional MCP boundary matrices for defensive branches.
describe("workflow MCP boundary matrix", () => {
  it("returns task context summaries and rejects unavailable assigned artifacts", async () => {
    const fixture = await setupMcpWorkspace("task-context-boundaries", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "task-context-boundaries");
    if (!loaded.workflow) throw new Error("workflow missing");
    const task = {
      id: "missing-content-task", kind: "create-character-module", status: "pending", assigned_agent: "director",
      capabilities: ["task.execute"], input_artifacts: [{ id: "author-missing.yaml", revision: `sha256:${"a".repeat(64)}` }],
      output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: { stage: "authoring" },
    };
    const workflow = workflowStateSchema.parse({ ...loaded.workflow, stage: "authoring", tasks: [task] });
    const context = (args: Record<string, unknown>) => ({ trusted: director, args, workflow, projectRoot: fixture.projectRoot });
    await expect(workflowTools.task_context(context({ task_id: task.id }))).resolves.toMatchObject({ task: { id: task.id }, source_revisions: expect.any(Object) });
    await expect(workflowTools.task_context(context({ task_id: task.id, artifact_id: "author-missing.yaml" }))).rejects.toThrow(/unavailable/u);

    const artifactEntries = Object.entries(loaded.sourceRevisions)
      .filter(([relativePath]) => relativePath !== "project.yaml" && !relativePath.startsWith("sources/") && !relativePath.startsWith("facts/") && !relativePath.startsWith(".workflow/"))
      .map(([relativePath, revision]) => ({
        id: relativePath === "blueprint.yaml" ? "blueprint" : "author-" + relativePath.replace(/[^a-z0-9._-]+/gu, "-"),
        revision,
      }));
    const richTask = {
      id: "rich-context-task", kind: "create-character-module", status: "pending", assigned_agent: "director",
      capabilities: ["task.execute"], input_artifacts: artifactEntries, output_contract: "proposal@1",
      dependencies: [], attempt: 0, max_attempts: 1, extensions: { stage: "authoring" },
    };
    const richWorkflow = workflowStateSchema.parse({ ...loaded.workflow, stage: "authoring", tasks: [richTask] });
    const richContext = (args: Record<string, unknown>) => ({ trusted: director, args, workflow: richWorkflow, projectRoot: fixture.projectRoot });
    await expect(workflowTools.task_context(richContext({ task_id: richTask.id, detail: "full" }))).resolves.toMatchObject({
      task: { id: richTask.id }, blueprint: expect.any(Object), manifest: expect.any(Object), characters: expect.any(Array),
    });
    for (const artifact of artifactEntries) {
      await expect(workflowTools.task_context(richContext({ task_id: richTask.id, artifact_id: artifact.id }))).resolves.toMatchObject({
        artifact: { id: artifact.id, content: expect.anything() },
      });
    }
  });

  it("covers clarification and Blueprint precheck authorization boundaries", async () => {
    const fixture = await setupMcpWorkspace("mcp-assisted-boundaries", "original", "assisted");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-assisted-boundaries");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("assisted workflow missing");
    const event = { expected_workflow_revision: loaded.workflow.revision, event_id: "boundary-event", occurred_at: "2026-07-21T00:00:00.000Z" };
    await expect(workflowTools.task_request_clarification({ trusted: director, workflow: loaded.workflow, projectRoot: fixture.projectRoot, args: { ...event, task_id: "missing", clarification_id: "c", decision_id: "d", question: "Q", reason: "R", affected_modules: ["extension"], options: [{ id: "a", label: "A", consequence: "A" }, { id: "b", label: "B", consequence: "B" }] } })).rejects.toThrow(/Creator/u);
    await expect(workflowTools.blueprint_precheck_record({ trusted: creator, workflow: loaded.workflow, projectRoot: fixture.projectRoot, args: { ...event, task_id: "missing", lease_id: "lease", decision_id: "d", candidate_blueprint: loaded.blueprint, checks: [] } })).rejects.toThrow(/Director/u);
    const wrongProject = { ...loaded.blueprint, project_id: "other-project" };
    await expect(workflowTools.blueprint_precheck_record({ trusted: director, workflow: loaded.workflow, projectRoot: fixture.projectRoot, args: { ...event, task_id: "missing", lease_id: "lease", decision_id: "d", candidate_blueprint: wrongProject, checks: [] } })).rejects.toThrow(/another project/u);
  });

  it("covers workflow status routing, lease expiry, claimability, and full details", async () => {
    const fixture = await setupMcpWorkspace("workflow-status-boundaries");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "workflow-status-boundaries");
    if (!loaded.workflow) throw new Error("workflow missing");
    const taskBase = {
      capabilities: ["task.execute"],
      input_artifacts: [],
      output_contract: "proposal@1",
      dependencies: [],
      extensions: {},
    };
    const tasks = [
      { ...taskBase, id: "blocked", kind: "create-character", status: "pending", assigned_agent: "director", attempt: 0, max_attempts: 3, dependencies: ["done"] },
      { ...taskBase, id: "claimable", kind: "create-character", status: "pending", assigned_agent: "director", attempt: 0, max_attempts: 3 },
      { ...taskBase, id: "retryable", kind: "create-character", status: "retryable", assigned_agent: "director", attempt: 1, max_attempts: 3 },
      { ...taskBase, id: "exhausted", kind: "create-character", status: "retryable", assigned_agent: "director", attempt: 3, max_attempts: 3 },
      { ...taskBase, id: "expired", kind: "create-character", status: "claimed", assigned_agent: "director", attempt: 1, max_attempts: 3, lease: { id: "expired", owner: "director", claimed_at: "2020-01-01T00:00:00.000Z", expires_at: "2020-01-01T00:01:00.000Z" } },
      { ...taskBase, id: "resumable", kind: "create-character", status: "claimed", assigned_agent: "director", attempt: 1, max_attempts: 3, lease: { id: "active", owner: "director", claimed_at: "2026-07-21T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" } },
    ];
    const workflow = workflowStateSchema.parse({
      ...loaded.workflow,
      revision: 3,
      outcome: { status: "closed", kind: "cancelled", closed_at: "2026-07-21T00:00:00.000Z", decision_id: "cancelled" },
      tasks,
    });
    const context = { trusted: director, workflow, projectRoot: fixture.projectRoot, args: {} };
    const summary = await workflowTools.workflow_status(context);
    expect(summary).toMatchObject({
      routing: "closed",
      active_tasks: expect.arrayContaining([
        expect.objectContaining({ id: "claimable", claimable: true }),
        expect.objectContaining({ id: "retryable", claimable: true }),
        expect.objectContaining({ id: "expired", claimable: true, lease_expired: true }),
        expect.objectContaining({ id: "resumable", resumable: true, claimable: false }),
      ]),
    });
    const full = await workflowTools.workflow_status({ ...context, args: { detail: "full" } });
    expect(full).toMatchObject({ routing: "closed", workflow: { tasks: expect.any(Array) }, source_revisions: expect.any(Object) });
  });
  it("covers expansion metadata and gate guard failures", async () => {
    const fixture = await setupMcpWorkspace("mcp-expansion-boundaries");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-expansion-boundaries");
    if (!loaded.workflow) throw new Error("workflow missing");
    const context = (workflow: typeof loaded.workflow, args: Record<string, unknown>) => ({ trusted: director, workflow, args, projectRoot: fixture.projectRoot });
    await expect(workflowTools.workflow_approve_gate(context(workflowStateSchema.parse({ ...loaded.workflow, extensions: { ...loaded.workflow.extensions, character_expansion: { schema_version: 1, run_id: "legacy" } } }), { gate_id: "blueprint", decision_id: "d", summary: "approve", expected_workflow_revision: loaded.workflow.revision, event_id: "gate", occurred_at: "2026-07-21T00:00:00.000Z" }))).rejects.toThrow(/exact current Blueprint revision/u);
    await expect(workflowTools.workflow_approve_gate(context(workflowStateSchema.parse({ ...loaded.workflow, extensions: { ...loaded.workflow.extensions, character_expansion: { schema_version: 2, run_id: "run-a" } } }), { gate_id: "blueprint", decision_id: "d", summary: "approve", expected_workflow_revision: loaded.workflow.revision, event_id: "gate", occurred_at: "2026-07-21T00:00:00.000Z" }))).rejects.toThrow();
  });

  it("covers facts gate preconditions and task release success", async () => {
    const fixture = await setupMcpWorkspace("facts-gate-boundaries", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "facts-gate-boundaries");
    if (!loaded.workflow) throw new Error("workflow missing");
    const event = { expected_workflow_revision: loaded.workflow.revision, event_id: "facts-gate", occurred_at: "2026-07-21T00:00:00.000Z" };
    const pendingFacts = workflowStateSchema.parse({
      ...loaded.workflow,
      stage: "facts_review",
      gates: [{ id: "facts", status: "pending", input_revisions: [], extensions: {} }],
      tasks: [],
    });
    await expect(workflowTools.workflow_approve_gate({
      trusted: director, workflow: pendingFacts, projectRoot: fixture.projectRoot,
      args: { ...event, gate_id: "facts", decision_id: "facts-incomplete", summary: "Incomplete facts", input_revisions: [] },
    })).rejects.toThrow(/curation/u);

    const completedFacts = workflowStateSchema.parse({
      ...pendingFacts,
      tasks: [{
        id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator",
        capabilities: ["task.execute"], input_artifacts: [], output_contract: "facts-curation-summary@1",
        dependencies: [], attempt: 1, max_attempts: 3,
        result: { id: "facts-summary", revision: "sha256:" + "a".repeat(64), contract: "facts-curation-summary@1" },
        extensions: {},
      }],
    });
    await expect(workflowTools.workflow_approve_gate({
      trusted: director, workflow: completedFacts, projectRoot: fixture.projectRoot,
      args: { ...event, expected_workflow_revision: completedFacts.revision, gate_id: "facts", decision_id: "facts-not-ready", summary: "Not ready", input_revisions: [] },
    })).rejects.toThrow();

    const taskState = workflowStateSchema.parse({
      ...loaded.workflow,
      revision: 2,
      tasks: [{
        id: "release-task", kind: "create-character", status: "claimed", assigned_agent: "director",
        capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1",
        dependencies: [], attempt: 1, max_attempts: 3,
        lease: { id: "lease", owner: "director", claimed_at: event.occurred_at, expires_at: "2099-01-01T00:00:00.000Z" },
        extensions: {},
      }],
    });
    const persistedTaskState = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: loaded.workflow.revision,
      eventId: "task-release-setup",
      actor: "director",
      occurredAt: event.occurred_at,
      update: () => workflowStateSchema.parse({ ...taskState, revision: loaded.workflow.revision + 1 }),
    });
    const released = await workflowTools.task_release({
      trusted: director, workflow: persistedTaskState, projectRoot: fixture.projectRoot,
      args: { ...event, expected_workflow_revision: persistedTaskState.revision, task_id: "release-task", event_id: "task-release" },
    });
    expect(released.tasks[0]).toMatchObject({ status: "pending", resume_without_attempt: true });
  });
  it("covers successful Director greeting and character revision handlers", async () => {
    const fixture = await setupMcpWorkspace("mcp-successful-revisions", "original", "free", { secondCharacter: true });
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-successful-revisions");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("revision fixture workflow missing");
    const event = { expected_workflow_revision: loaded.workflow.revision, event_id: "greeting-revision", occurred_at: "2026-07-22T00:00:00.000Z" };
    const greetingState = workflowStateSchema.parse({ ...loaded.workflow, stage: "content_review", tasks: [] });
    const greeting = await workflowTools.greetings_revision_begin({
      trusted: director, workflow: greetingState, projectRoot: fixture.projectRoot,
      args: { ...event, run_id: "greeting-1", reason: "Clarify the greeting tone" },
    });
    expect(greeting.stage).toBe("greetings_authoring");

    const characterState = workflowStateSchema.parse({
      ...greeting,
      stage: "semantic_review",
      tasks: [{
        id: "review-character",
        kind: "review-character",
        status: "completed",
        assigned_agent: "character-critic",
        capabilities: ["task.execute"],
        input_artifacts: [],
        output_contract: "review-report@1",
        dependencies: [],
        attempt: 1,
        max_attempts: 3,
        result: { id: "review-result", revision: "sha256:" + "a".repeat(64), contract: "review-report@1" },
        extensions: { stage: "semantic_review" },
      }],
      artifacts: [{
        id: "author-characters-alice-character.yaml",
        status: "draft",
        revision: loaded.sourceRevisions["characters/alice/character.yaml"],
        contract: "character@1",
        updated_at: event.occurred_at,
        extensions: {},
      }],
    });
    const character = await workflowTools.character_revision_begin({
      trusted: director, workflow: characterState, projectRoot: fixture.projectRoot,
      args: { ...event, expected_workflow_revision: greeting.revision, event_id: "character-revision", run_id: "character-1", reason: "Refine the primary character", artifact_ids: ["author-characters-alice-character.yaml"] },
    });
    expect(character.stage).toBe("authoring");
    expect(character.tasks.length).toBeGreaterThan(0);
  });

  it("covers successful Blueprint precheck and clarification request/resolve paths", async () => {
    const fixture = await setupMcpWorkspace("mcp-success-boundaries", "original", "assisted");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-success-boundaries");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("successful boundary fixture missing workflow");
    const startArgs = {
      expected_workflow_revision: loaded.workflow.revision,
      event_id: "successful-start",
      occurred_at: "2026-07-22T00:00:00.000Z",
      intake_answers: [{ decision_id: "successful-concept", question_id: "concept", answer: "A constrained concept" }],
      intake_completion: { decision_id: "successful-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    };
    const started = await workflowTools.workflow_start({ trusted: director, workflow: loaded.workflow, projectRoot: fixture.projectRoot, args: startArgs });
    const claimed = await workflowTools.task_claim({
      trusted: director,
      workflow: started,
      projectRoot: fixture.projectRoot,
      args: {
        task_id: "create-blueprint",
        lease_id: "blueprint-success-lease",
        lease_duration_ms: 60_000,
        expected_workflow_revision: started.revision,
        event_id: "successful-claim",
        occurred_at: "2026-07-22T00:01:00.000Z",
      },
    });
    const dimensions = ["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"] as const;
    const checks = (loaded.blueprint.characters.length > 0 ? loaded.blueprint.characters : [{ id: loaded.blueprint.project_id }]).flatMap((character) =>
      dimensions.map((dimension) => ({
        subject_id: character.id,
        dimension,
        uncertainty: "low" as const,
        impact: "low" as const,
        basis: "Existing project evidence",
        action: "preserve_explicit" as const,
      })),
    );
    const prechecked = await workflowTools.blueprint_precheck_record({
      trusted: director,
      workflow: claimed,
      projectRoot: fixture.projectRoot,
      args: {
        task_id: "create-blueprint",
        lease_id: "blueprint-success-lease",
        decision_id: "precheck-success",
        candidate_blueprint: loaded.blueprint,
        checks,
        expected_workflow_revision: claimed.revision,
        event_id: "precheck-success",
        occurred_at: "2026-07-22T00:02:00.000Z",
      },
    });
    expect(prechecked.tasks.find((task) => task.id === "create-blueprint")?.blueprint_precheck).toBeDefined();

    const clarificationWorkflow = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: prechecked.revision,
      eventId: "clarification-task-setup",
      actor: "engine",
      occurredAt: "2026-07-22T00:03:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        stage: "authoring",
        tasks: [{
          id: "clarify-character",
          kind: "create-character",
          status: "claimed",
          assigned_agent: "zhuji-creator",
          capabilities: ["task.execute"],
          input_artifacts: [],
          output_contract: "proposal@1",
          dependencies: [],
          attempt: 1,
          max_attempts: 3,
          lease: { id: "clarify-lease", owner: "zhuji-creator", claimed_at: "2026-07-22T00:03:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" },
          extensions: { stage: "authoring" },
        }],
      }),
    });
    const requested = await workflowTools.task_request_clarification({
      trusted: creator,
      workflow: clarificationWorkflow,
      projectRoot: fixture.projectRoot,
      args: {
        task_id: "clarify-character",
        lease_id: "clarify-lease",
        clarification_id: "clarification-1",
        decision_id: "clarification-requested",
        question: "Which tone should be primary?",
        reason: "Two source interpretations remain",
        affected_modules: ["inner_nature"],
        options: [
          { id: "calm", label: "Calm", consequence: "Keep calm tone" },
          { id: "direct", label: "Direct", consequence: "Use direct tone" },
        ],
        expected_workflow_revision: clarificationWorkflow.revision,
        event_id: "clarification-requested",
        occurred_at: "2026-07-22T00:04:00.000Z",
      },
    });
    const resolved = await workflowTools.task_resolve_clarification({
      trusted: director,
      workflow: requested,
      projectRoot: fixture.projectRoot,
      args: {
        task_id: "clarify-character",
        clarification_id: "clarification-1",
        decision_id: "clarification-resolved",
        answer: "Use calm tone",
        selected_option: "calm",
        expected_workflow_revision: requested.revision,
        event_id: "clarification-resolved",
        occurred_at: "2026-07-22T00:05:00.000Z",
      },
    });
    expect(resolved.tasks.find((task) => task.id === "clarify-character")?.clarifications?.[0]?.status).toBe("resolved");
  });

  it("starts and advances a Source Adaptation workflow from an exact retrieved source", async () => {
    const fixture = await setupMcpWorkspace("mcp-source-start", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const intake = await intakeRetrievedSource({
      projectRoot: fixture.projectRoot,
      sourceId: "novel",
      title: "Source",
      bytes: Buffer.from("Exact source bytes"),
      requestedUrl: "https://example.test/source",
      canonicalUrl: "https://example.test/source",
      fetchedAt: "2026-07-22T00:00:00.000Z",
      actor: "director",
      mediaType: "text/plain",
      extension: ".txt",
    });
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-source-start");
    if (!loaded.workflow) throw new Error("source start workflow missing");
    const started = await workflowTools.workflow_start({
      trusted: director,
      workflow: loaded.workflow,
      projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: loaded.workflow.revision,
        event_id: "source-started",
        occurred_at: "2026-07-22T00:01:00.000Z",
        intake_answers: [{ decision_id: "source-concept", question_id: "source", answer: "Adapt exact source" }],
        intake_completion: { decision_id: "source-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
      },
    });
    expect(started.stage).toBe("source_processing");
    expect(started.tasks[0]?.input_artifacts).toEqual(expect.arrayContaining([{ id: "source-novel", revision: intake.revision.id }]));
    await expect(workflowTools.workflow_advance({
      trusted: director,
      workflow: started,
      projectRoot: fixture.projectRoot,
      args: { expected_workflow_revision: started.revision, event_id: "source-advance", occurred_at: "2026-07-22T00:02:00.000Z" },
    })).rejects.toBeDefined();
  });

  it("covers workflow project, relationship, inspection, and precheck guard branches", async () => {
    const fixture = await setupMcpWorkspace("mcp-guard-branches");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-guard-branches");
    if (!loaded.workflow) throw new Error("guard branch workflow missing");
    await mkdir(path.join(fixture.workspace.projectsRoot, "invalid-project"), { recursive: true });
    const missingProject = { ...loaded.workflow, project_id: "invalid-project" };
    const event = { expected_workflow_revision: loaded.workflow.revision, event_id: "guard-branches", occurred_at: "2026-07-22T00:10:00.000Z" };
    await expect(workflowTools.world_authoring_begin({
      trusted: director, workflow: missingProject, projectRoot: fixture.projectRoot,
      args: {},
    })).rejects.toMatchObject({ code: "PROJECT_INVALID" });
    await expect(workflowTools.world_revision_begin({
      trusted: director, workflow: missingProject, projectRoot: fixture.projectRoot,
      args: {},
    })).rejects.toMatchObject({ code: "PROJECT_INVALID" });
    await expect(workflowTools.character_revision_begin({
      trusted: director, workflow: missingProject, projectRoot: fixture.projectRoot,
      args: {},
    })).rejects.toMatchObject({ code: "PROJECT_INVALID" });
    const invalidTask = {
      id: "invalid-context-task", kind: "analyze-import", status: "pending", assigned_agent: "director",
      capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1",
      dependencies: [], attempt: 0, max_attempts: 1, extensions: {},
    };
    await expect(workflowTools.task_context({
      trusted: director,
      workflow: { ...missingProject, tasks: [invalidTask] },
      projectRoot: fixture.projectRoot,
      args: { task_id: invalidTask.id },
    })).rejects.toMatchObject({ code: "PROJECT_INVALID" });

    const normalTaskWorkflow = workflowStateSchema.parse({ ...loaded.workflow, tasks: [invalidTask], stage: "blueprint" });
    await expect(workflowTools.task_context({
      trusted: director, workflow: normalTaskWorkflow, projectRoot: fixture.projectRoot,
      args: { task_id: invalidTask.id },
    })).resolves.toMatchObject({ task: { id: invalidTask.id } });

    const relationshipFixture = await setupMcpWorkspace("mcp-relationship-missing", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(relationshipFixture.workspace.cleanup);
    await rm(path.join(relationshipFixture.projectRoot, "relationships.yaml"));
    await writeFile(path.join(relationshipFixture.projectRoot, "relationships.yaml"), "", "utf8");
    const relationshipLoaded = await loadAuthorProject(relationshipFixture.workspace.projectsRoot, "mcp-relationship-missing");
    if (!relationshipLoaded.workflow) throw new Error("relationship workflow missing");
    await expect(workflowTools.workflow_advance({
      trusted: director,
      workflow: { ...relationshipLoaded.workflow, stage: "blueprint" },
      projectRoot: relationshipFixture.projectRoot,
      args: { ...event, expected_workflow_revision: relationshipLoaded.workflow.revision },
    })).rejects.toBeDefined();
  });
});


describe("workflow MCP branch completion", () => {
  it("advances a relationship-enabled Blueprint with an exact relationship artifact", async () => {
    const fixture = await setupMcpWorkspace("mcp-relationship-advance", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-relationship-advance");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("relationship advance fixture incomplete");
    const blueprintRevision = loaded.sourceRevisions["blueprint.yaml"];
    const relationshipRevision = loaded.sourceRevisions["relationships.yaml"];
    if (!blueprintRevision || !relationshipRevision) throw new Error("relationship revisions missing");
    const ready = workflowStateSchema.parse({
      ...loaded.workflow,
      stage: "blueprint",
      revision: 0,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision: blueprintRevision }], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: blueprintRevision, updated_at: "2026-07-23T00:00:00.000Z", extensions: {} }],
      tasks: [],
    });
    const advanced = await workflowTools.workflow_advance({
      trusted: director,
      workflow: ready,
      projectRoot: fixture.projectRoot,
      args: { expected_workflow_revision: 0, event_id: "relationship-advance", occurred_at: "2026-07-23T00:01:00.000Z" },
    });
    expect(advanced.stage).toBe("authoring");
    expect(advanced.artifacts).toContainEqual(expect.objectContaining({ id: "author-relationships.yaml", revision: relationshipRevision, contract: "relationships@1" }));
  });

  it("covers task context contracts and clarification resolution without an option", async () => {
    const fixture = await setupMcpWorkspace("mcp-contract-clarification", "original", "assisted");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-contract-clarification");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("clarification fixture incomplete");
    const sourceRevision = loaded.sourceRevisions["blueprint.yaml"];
    if (!sourceRevision) throw new Error("blueprint revision missing");
    const task = {
      id: "contract-task", kind: "create-character", status: "claimed" as const, assigned_agent: "zhuji-creator",
      capabilities: ["task.execute"], input_artifacts: [{ id: "blueprint", revision: sourceRevision, contract: "blueprint@1" }],
      output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 3,
      lease: { id: "contract-lease", owner: "zhuji-creator", claimed_at: "2026-07-23T00:00:00.000Z", expires_at: "2099-07-23T00:30:00.000Z" },
      extensions: { stage: "authoring" },
    };
    const workflow = workflowStateSchema.parse({ ...loaded.workflow, stage: "authoring", tasks: [task] });
    const persisted = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: loaded.workflow.revision, eventId: "contract-task-created", actor: "engine", occurredAt: "2026-07-23T00:00:00.000Z",
      update: () => workflowStateSchema.parse({ ...workflow, revision: workflow.revision + 1 }),
    });
    const context = (trusted: typeof director, current: typeof workflow, args: Record<string, unknown>) => ({ trusted, workflow: current, projectRoot: fixture.projectRoot, args });
    const artifactContext = await workflowTools.task_context(context(creator, persisted, { task_id: task.id, artifact_id: "blueprint" }));
    expect(artifactContext).toMatchObject({ artifact: { contract: "blueprint@1" } });
    const requested = await workflowTools.task_request_clarification(context(creator, persisted, {
      task_id: task.id, lease_id: "contract-lease", clarification_id: "without-option", decision_id: "clarification-without-option",
      question: "Choose a tone", reason: "Two valid options", affected_modules: ["appearance"],
      options: [{ id: "a", label: "A", consequence: "A" }, { id: "b", label: "B", consequence: "B" }],
      expected_workflow_revision: persisted.revision, event_id: "clarification-without-option", occurred_at: "2026-07-23T00:01:00.000Z",
    }));
    const resolved = await workflowTools.task_resolve_clarification(context(director, requested, {
      task_id: task.id, clarification_id: "without-option", decision_id: "clarification-answer",
      answer: "Use the first option", expected_workflow_revision: requested.revision, event_id: "clarification-answer", occurred_at: "2026-07-23T00:02:00.000Z",
    }));
    expect(resolved.decisions.at(-1)).not.toHaveProperty("option");
  });

  it("rejects Blueprint prechecks containing an unrelated subject", async () => {
    const fixture = await setupMcpWorkspace("mcp-precheck-subject", "original", "assisted");
    cleanups.push(fixture.workspace.cleanup);
    const director = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-precheck-subject");
    if (!loaded.workflow || !loaded.blueprint) throw new Error("precheck fixture incomplete");
    const started = await workflowTools.workflow_start({
      trusted: director, workflow: loaded.workflow, projectRoot: fixture.projectRoot,
      args: {
        expected_workflow_revision: loaded.workflow.revision, event_id: "precheck-start", occurred_at: "2026-07-23T00:00:00.000Z",
        intake_answers: [{ decision_id: "precheck-concept", question_id: "concept", answer: "A constrained concept" }],
        intake_completion: { decision_id: "precheck-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
      },
    });
    const claimed = await workflowTools.task_claim({
      trusted: director, workflow: started, projectRoot: fixture.projectRoot,
      args: { task_id: "create-blueprint", lease_id: "precheck-lease", lease_duration_ms: 60_000, expected_workflow_revision: started.revision, event_id: "precheck-claim", occurred_at: "2026-07-23T00:01:00.000Z" },
    });
    const dimensions = ["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"] as const;
    const checks = dimensions.map((dimension) => ({
      subject_id: "ghost", dimension, uncertainty: "low" as const, impact: "low" as const,
      basis: "unrelated", action: "preserve_explicit" as const,
    }));
    await expect(workflowTools.blueprint_precheck_record({
      trusted: director, workflow: claimed, projectRoot: fixture.projectRoot,
      args: {
        task_id: "create-blueprint", lease_id: "precheck-lease", decision_id: "precheck-invalid",
        candidate_blueprint: loaded.blueprint, checks,
        expected_workflow_revision: claimed.revision, event_id: "precheck-invalid", occurred_at: "2026-07-23T00:02:00.000Z",
      },
    })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_INCOMPLETE" });
  });
});


it("covers workflow MCP disabled-mode, definition, task, precheck, and target guards", async () => {
  const freeFixture = await setupMcpWorkspace("mcp-guard-matrix-free", "original", "free");
  cleanups.push(freeFixture.workspace.cleanup);
  const director = await createTrustedContext(freeFixture.environment);
  const freeLoaded = await loadAuthorProject(freeFixture.workspace.projectsRoot, "mcp-guard-matrix-free");
  if (!freeLoaded.workflow || !freeLoaded.blueprint) throw new Error("free guard fixture incomplete");

  await expect(workflowTools.workflow_advance({
    trusted: director,
    workflow: workflowStateSchema.parse({ ...freeLoaded.workflow, workflow_definition_id: "missing-definition" }),
    projectRoot: freeFixture.projectRoot,
    args: { expected_workflow_revision: freeLoaded.workflow.revision, event_id: "missing-definition", occurred_at: "2026-07-24T00:00:00.000Z" },
  })).rejects.toMatchObject({ code: "WORKFLOW_DEFINITION_MISMATCH" });

  const assistedFixture = await setupMcpWorkspace("mcp-guard-matrix-assisted", "original", "assisted");
  cleanups.push(assistedFixture.workspace.cleanup);
  const assistedLoaded = await loadAuthorProject(assistedFixture.workspace.projectsRoot, "mcp-guard-matrix-assisted");
  if (!assistedLoaded.workflow || !assistedLoaded.blueprint) throw new Error("assisted guard fixture incomplete");
  const creator = await createTrustedContext({ ...assistedFixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });

  await expect(workflowTools.task_request_clarification({
    trusted: director,
    workflow: freeLoaded.workflow,
    projectRoot: freeFixture.projectRoot,
    args: {
      task_id: "missing", clarification_id: "missing", decision_id: "missing", question: "q", reason: "r",
      affected_modules: ["appearance"], options: [{ id: "a", label: "A", consequence: "A" }],
      expected_workflow_revision: freeLoaded.workflow.revision, event_id: "clarification-disabled", occurred_at: "2026-07-24T00:01:00.000Z",
    },
  })).rejects.toMatchObject({ code: "CLARIFICATION_MODE_DISABLED" });

  await expect(workflowTools.task_request_clarification({
    trusted: creator,
    workflow: assistedLoaded.workflow,
    projectRoot: assistedFixture.projectRoot,
    args: {
      task_id: "missing", clarification_id: "missing", decision_id: "missing", question: "q", reason: "r",
      affected_modules: ["appearance"], options: [{ id: "a", label: "A", consequence: "A" }],
      expected_workflow_revision: assistedLoaded.workflow.revision, event_id: "task-missing", occurred_at: "2026-07-24T00:02:00.000Z",
    },
  })).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });

  await expect(workflowTools.blueprint_precheck_record({
    trusted: director,
    workflow: freeLoaded.workflow,
    projectRoot: freeFixture.projectRoot,
    args: {
      task_id: "missing", lease_id: "missing", decision_id: "precheck-mode", candidate_blueprint: freeLoaded.blueprint,
      checks: [{ subject_id: freeLoaded.blueprint.project_id, dimension: "character_core", uncertainty: "low", impact: "low", basis: "basis", action: "preserve_explicit" }],
      expected_workflow_revision: freeLoaded.workflow.revision, event_id: "precheck-mode", occurred_at: "2026-07-24T00:03:00.000Z",
    },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_MODE_DISABLED" });

  await expect(workflowTools.blueprint_precheck_record({
    trusted: director,
    workflow: assistedLoaded.workflow,
    projectRoot: assistedFixture.projectRoot,
    args: {
      task_id: "missing", lease_id: "missing", decision_id: "precheck-project", candidate_blueprint: { ...assistedLoaded.blueprint, project_id: "other-project" },
      checks: [{ subject_id: "other-project", dimension: "character_core", uncertainty: "low", impact: "low", basis: "basis", action: "preserve_explicit" }],
      expected_workflow_revision: assistedLoaded.workflow.revision, event_id: "precheck-project", occurred_at: "2026-07-24T00:04:00.000Z",
    },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_PROJECT_MISMATCH" });

  await expect(workflowTools.task_resolve_clarification({
    trusted: director,
    workflow: assistedLoaded.workflow,
    projectRoot: assistedFixture.projectRoot,
    args: {
      task_id: "missing", clarification_id: "missing", decision_id: "resolve-missing", answer: "answer",
      expected_workflow_revision: assistedLoaded.workflow.revision, event_id: "resolve-missing", occurred_at: "2026-07-24T00:05:00.000Z",
    },
  })).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
});


it("covers workflow status task summaries and full task context projections", async () => {
  const fixture = await setupMcpWorkspace("mcp-status-context", "original", "free");
  cleanups.push(fixture.workspace.cleanup);
  const director = await createTrustedContext(fixture.environment);
  const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "mcp-status-context");
  if (!loaded.workflow || !loaded.blueprint) throw new Error("status fixture incomplete");
  const baseTask = {
    kind: "create-character", assigned_agent: "zhuji-creator", capabilities: ["task.execute"],
    input_artifacts: [{ id: "blueprint", revision: loaded.sourceRevisions["blueprint.yaml"]! }],
    output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 3, extensions: { stage: "authoring" },
  };
  const workflow = workflowStateSchema.parse({
    ...loaded.workflow,
    stage: "authoring",
    tasks: [
      { ...baseTask, id: "summary-pending", status: "pending" },
      { ...baseTask, id: "summary-expired", status: "claimed", attempt: 1, lease: { id: "expired", owner: "zhuji-creator", claimed_at: "2020-01-01T00:00:00.000Z", expires_at: "2020-01-01T00:01:00.000Z" }, clarifications: [{ id: "summary-question", status: "pending", question: "Pick a tone", reason: "Ambiguous", uncertainty: "high", impact: "high", affected_modules: ["voice"], options: [{ id: "a", label: "A", consequence: "A" }, { id: "b", label: "B", consequence: "B" }], requested_at: "2020-01-01T00:00:00.000Z" }] },
      { ...baseTask, id: "summary-retry", status: "retryable", attempt: 1 },
    ],
  });
  const summary = await workflowTools.workflow_status({
    trusted: director, workflow, projectRoot: fixture.projectRoot, args: {},
  });
  expect(summary.active_tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "summary-pending", claimable: true }),
    expect.objectContaining({ id: "summary-expired", lease_expired: true, claimable: true, clarifications: expect.any(Array) }),
    expect.objectContaining({ id: "summary-retry", claimable: true }),
  ]));
  const context = await workflowTools.task_context({
    trusted: director, workflow, projectRoot: fixture.projectRoot, args: { task_id: "summary-pending", detail: "full" },
  });
  expect(context).toMatchObject({ task: { id: "summary-pending" }, blueprint: { project_id: "mcp-status-context" }, facts: expect.any(Array) });
});
it("covers remaining workflow handler guard branches", async () => {
  const fixture = await setupMcpWorkspace("workflow-final-guards", "original", "free");
  cleanups.push(fixture.workspace.cleanup);
  const director = await createTrustedContext(fixture.environment);
  const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
  const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "workflow-final-guards");
  if (!loaded.workflow || !loaded.blueprint) throw new Error("guard fixture incomplete");
  const event = { expected_workflow_revision: loaded.workflow.revision, event_id: "final-guard", occurred_at: "2026-07-25T00:00:00.000Z" };
  const context = (trusted: typeof director, workflow: typeof loaded.workflow, args: Record<string, unknown>) => ({ trusted, workflow, projectRoot: fixture.projectRoot, args });

  await expect(workflowTools.world_revision_begin(context(creator, loaded.workflow, {}))).rejects.toMatchObject({ code: "WORLD_REVISION_DENIED" });
  await expect(workflowTools.greetings_revision_begin(context(creator, loaded.workflow, {}))).rejects.toMatchObject({ code: "GREETINGS_REVISION_DENIED" });
  await expect(workflowTools.character_revision_begin(context(creator, loaded.workflow, {}))).rejects.toMatchObject({ code: "CHARACTER_REVISION_DENIED" });
  await expect(workflowTools.character_expansion_begin(context(creator, loaded.workflow, {}))).rejects.toMatchObject({ code: "CHARACTER_EXPANSION_DENIED" });
  await expect(workflowTools.task_resolve_clarification(context(creator, loaded.workflow, { ...event, task_id: "missing" }))).rejects.toMatchObject({ code: "CLARIFICATION_RESOLVE_DENIED" });

  const expansionCandidate = {
    ...loaded.blueprint,
    characters: [...loaded.blueprint.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }],
    greetings: { ...loaded.blueprint.greetings, enabled: true, character_ids: [...loaded.blueprint.characters.map((item) => item.id), "beth"] },
  };
  await expect(workflowTools.character_expansion_begin(context(director, loaded.workflow, {
    ...event,
    run_id: "final-expansion",
    reason: "Add Beth",
    new_characters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }],
    candidate_blueprint: expansionCandidate,
    revise_world: false,
  }))).rejects.toBeDefined();
  await rm(path.join(fixture.projectRoot, "blueprint.yaml"));
  await expect(workflowTools.character_expansion_begin(context(director, loaded.workflow, {
    ...event,
    run_id: "invalid-expansion",
    reason: "Invalid",
    new_characters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }],
    candidate_blueprint: expansionCandidate,
    revise_world: false,
  }))).rejects.toMatchObject({ code: "PROJECT_INVALID" });

  await expect(workflowTools.workflow_advance(context(director, loaded.workflow, event))).rejects.toMatchObject({ code: "BLUEPRINT_UNAVAILABLE" });
  await expect(workflowTools.world_authoring_begin(context(director, loaded.workflow, {
    ...event, world: loaded.blueprint.world, run_id: "missing-world",
  }))).rejects.toMatchObject({ code: "PROJECT_INVALID" });

  const specialized = workflowStateSchema.parse({
    ...loaded.workflow,
    stage: "authoring",
    tasks: [{ id: "specialized", kind: "create-character", status: "pending", assigned_agent: "zhuji-creator", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 3, extensions: { stage: "authoring" } }],
  });
  await expect(workflowTools.task_submit(context(creator, specialized, { task_id: "specialized", result: {} }))).rejects.toMatchObject({ code: "TASK_SPECIALIZED_SUBMISSION_REQUIRED" });
});
it("covers clarification maps and precheck task guards", async () => {
  const fixture = await setupMcpWorkspace("workflow-map-guards", "original", "assisted");
  cleanups.push(fixture.workspace.cleanup);
  const director = await createTrustedContext(fixture.environment);
  const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
  const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "workflow-map-guards");
  if (!loaded.workflow || !loaded.blueprint) throw new Error("map fixture incomplete");
  const task = {
    id: "clarify-task", kind: "create-character", status: "claimed" as const, assigned_agent: "zhuji-creator",
    capabilities: ["task.execute", "task.clarify"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 3,
    lease: { id: "clarify-lease", owner: "zhuji-creator", claimed_at: "2026-07-25T00:00:00.000Z", expires_at: "2099-07-25T00:30:00.000Z" }, extensions: { stage: "authoring" },
  };
  const other = { ...task, id: "unrelated-task", status: "pending" as const, assigned_agent: "director", lease: undefined };
  const workflow = workflowStateSchema.parse({ ...loaded.workflow, stage: "authoring", revision: 1, tasks: [task, other] });
  const persisted = await commitWorkflowMutation(fixture.projectRoot, {
    expectedRevision: loaded.workflow.revision, eventId: "map-state", actor: "engine", occurredAt: "2026-07-25T00:00:00.000Z", update: () => workflow,
  });
  const requestArgs = {
    expected_workflow_revision: persisted.revision, event_id: "map-request", occurred_at: "2026-07-25T00:01:00.000Z", task_id: task.id,
    lease_id: "clarify-lease", clarification_id: "map-clarification", decision_id: "map-request-decision", question: "Pick one", reason: "Ambiguous",
    affected_modules: ["appearance"], options: [{ id: "a", label: "A", consequence: "A" }, { id: "b", label: "B", consequence: "B" }],
  };
  const requested = await workflowTools.task_request_clarification({ trusted: creator, workflow: persisted, projectRoot: fixture.projectRoot, args: requestArgs });
  const resolved = await workflowTools.task_resolve_clarification({
    trusted: director, workflow: requested, projectRoot: fixture.projectRoot,
    args: { expected_workflow_revision: requested.revision, event_id: "map-resolve", occurred_at: "2026-07-25T00:02:00.000Z", task_id: task.id, clarification_id: "map-clarification", decision_id: "map-resolve-decision", answer: "A" },
  });
  expect(resolved.tasks.find((item) => item.id === "unrelated-task")?.status).toBe("pending");

  const dimensions = ["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"] as const;
  const checks = dimensions.map((dimension) => ({ subject_id: loaded.blueprint!.characters[0]!.id, dimension, uncertainty: "low" as const, impact: "low" as const, basis: "basis", action: "preserve_explicit" as const }));
  const wrongKind = workflowStateSchema.parse({ ...loaded.workflow, revision: 3, tasks: [{ ...task, id: "wrong-kind", kind: "create-character", status: "claimed" }] });
  await expect(workflowTools.blueprint_precheck_record({
    trusted: director, workflow: wrongKind, projectRoot: fixture.projectRoot,
    args: { expected_workflow_revision: wrongKind.revision, event_id: "precheck-wrong-kind", occurred_at: "2026-07-25T00:03:00.000Z", task_id: "wrong-kind", lease_id: "clarify-lease", decision_id: "precheck-wrong-kind", candidate_blueprint: loaded.blueprint, checks },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_TASK_INVALID" });
  const wrongLease = workflowStateSchema.parse({ ...loaded.workflow, revision: 3, tasks: [{ ...task, id: "create-blueprint", kind: "create-blueprint", assigned_agent: "director", lease: { ...task.lease, owner: "director", id: "right-lease" } }] });
  const persistedWrongLease = await commitWorkflowMutation(fixture.projectRoot, { expectedRevision: 3, eventId: "wrong-lease-state", actor: "engine", occurredAt: "2026-07-25T00:03:30.000Z", update: () => workflowStateSchema.parse({ ...wrongLease, revision: 4 }) });  await expect(workflowTools.blueprint_precheck_record({
    trusted: director, workflow: persistedWrongLease, projectRoot: fixture.projectRoot,
    args: { expected_workflow_revision: persistedWrongLease.revision, event_id: "precheck-wrong-lease", occurred_at: "2026-07-25T00:04:00.000Z", task_id: "create-blueprint", lease_id: "wrong-lease", decision_id: "precheck-wrong-lease", candidate_blueprint: loaded.blueprint, checks },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_LEASE_INVALID" });
});
it("covers workflow optional projections, precheck matrices, and expansion CAS guards", async () => {
  const worldFixture = await setupMcpWorkspace("mcp-deep-world", "original", "free");
  cleanups.push(worldFixture.workspace.cleanup);
  await writeYamlFixture(path.join(worldFixture.projectRoot, "world/geography/lake.yaml"), {
    schema_version: 1, id: "lake", category: "geography", title: "Lake", content: "A quiet lake", related_ids: [],
  });
  const worldLoaded = await loadAuthorProject(worldFixture.workspace.projectsRoot, "mcp-deep-world");
  const worldRevision = worldLoaded.sourceRevisions["world/geography/lake.yaml"];
  if (!worldLoaded.workflow || !worldRevision) throw new Error("world projection fixture incomplete");
  const worldTask = {
    id: "world-context", kind: "create-world", status: "pending" as const, assigned_agent: "director",
    capabilities: ["task.execute"], input_artifacts: [{ id: "author-world-geography-lake.yaml", revision: worldRevision }],
    output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: { stage: "authoring" },
  };
  const worldWorkflow = workflowStateSchema.parse({ ...worldLoaded.workflow, stage: "authoring", tasks: [worldTask] });
  const worldTrusted = await createTrustedContext(worldFixture.environment);
  const worldContext = (args: Record<string, unknown>) => ({ trusted: worldTrusted, workflow: worldWorkflow, projectRoot: worldFixture.projectRoot, args });
  const fullWorld = await workflowTools.task_context(worldContext({ task_id: worldTask.id, detail: "full" }));
  expect(fullWorld).toMatchObject({ world: [expect.objectContaining({ id: "lake" })], facts: expect.any(Array) });
  await expect(workflowTools.task_context(worldContext({ task_id: worldTask.id, artifact_id: "author-world-geography-lake.yaml" }))).resolves.toMatchObject({ artifact: { id: "author-world-geography-lake.yaml" } });
  const inspectionTask = workflowStateSchema.parse({ ...worldWorkflow, tasks: [{ ...worldTask, id: "import-context", kind: "analyze-import", input_artifacts: [] }] });
  await expect(workflowTools.task_context({ trusted: worldTrusted, workflow: inspectionTask, projectRoot: worldFixture.projectRoot, args: { task_id: "import-context", detail: "full" } })).resolves.not.toHaveProperty("inspection");

  const freeFixture = await setupMcpWorkspace("mcp-deep-precheck-free", "original", "free");
  cleanups.push(freeFixture.workspace.cleanup);
  const freeTrusted = await createTrustedContext(freeFixture.environment);
  const freeLoaded = await loadAuthorProject(freeFixture.workspace.projectsRoot, "mcp-deep-precheck-free");
  if (!freeLoaded.workflow || !freeLoaded.blueprint) throw new Error("free precheck fixture incomplete");
  await expect(workflowTools.blueprint_precheck_record({
    trusted: freeTrusted, workflow: freeLoaded.workflow, projectRoot: freeFixture.projectRoot,
    args: {
      expected_workflow_revision: freeLoaded.workflow.revision, event_id: "free-precheck", occurred_at: "2026-07-26T00:00:00.000Z",
      task_id: "missing", lease_id: "missing", decision_id: "free-precheck", candidate_blueprint: { ...freeLoaded.blueprint, collaboration_mode: "assisted" }, checks: [],
    },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_MODE_DISABLED" });

  const mismatchFixture = await setupMcpWorkspace("mcp-deep-precheck-mismatch", "original", "assisted");
  cleanups.push(mismatchFixture.workspace.cleanup);
  const mismatchTrusted = await createTrustedContext(mismatchFixture.environment);
  const mismatchLoaded = await loadAuthorProject(mismatchFixture.workspace.projectsRoot, "mcp-deep-precheck-mismatch");
  if (!mismatchLoaded.workflow || !mismatchLoaded.blueprint) throw new Error("mismatch fixture incomplete");
  const mismatchCandidate = {
    ...mismatchLoaded.blueprint,
    characters: [...mismatchLoaded.blueprint.characters, { id: "beth", display_name: "Beth", mode: "palette" as const, core_concept: "Rival" }],
    relationships: { enabled: false, character_ids: [], requirements: [], extensions: {} },
  };
  await expect(workflowTools.blueprint_precheck_record({
    trusted: mismatchTrusted, workflow: mismatchLoaded.workflow, projectRoot: mismatchFixture.projectRoot,
    args: {
      expected_workflow_revision: mismatchLoaded.workflow.revision, event_id: "mismatch-precheck", occurred_at: "2026-07-26T00:01:00.000Z",
      task_id: "missing", lease_id: "missing", decision_id: "mismatch-precheck", candidate_blueprint: mismatchCandidate, checks: [],
    },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_SUBJECT_INVALID" });

  const precheckFixture = await setupMcpWorkspace("mcp-deep-precheck", "original", "assisted");
  cleanups.push(precheckFixture.workspace.cleanup);
  const precheckTrusted = await createTrustedContext(precheckFixture.environment);
  const precheckLoaded = await loadAuthorProject(precheckFixture.workspace.projectsRoot, "mcp-deep-precheck");
  if (!precheckLoaded.workflow || !precheckLoaded.blueprint) throw new Error("precheck fixture incomplete");
  const started = await workflowTools.workflow_start({
    trusted: precheckTrusted, workflow: precheckLoaded.workflow, projectRoot: precheckFixture.projectRoot,
    args: {
      expected_workflow_revision: precheckLoaded.workflow.revision, event_id: "precheck-start", occurred_at: "2026-07-26T00:02:00.000Z",
      intake_answers: [{ decision_id: "precheck-concept", question_id: "concept", answer: "A constrained concept" }],
      intake_completion: { decision_id: "precheck-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    },
  });
  const claimed = await workflowTools.task_claim({
    trusted: precheckTrusted, workflow: started, projectRoot: precheckFixture.projectRoot,
    args: { task_id: "create-blueprint", lease_id: "precheck-lease", lease_duration_ms: 60_000, expected_workflow_revision: started.revision, event_id: "precheck-claim", occurred_at: "2026-07-26T00:03:00.000Z" },
  });
  const dimensions = ["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"] as const;
  const validChecks = dimensions.map((dimension) => ({ subject_id: precheckLoaded.blueprint!.characters[0]!.id, dimension, uncertainty: "low" as const, impact: "low" as const, basis: "basis", action: "preserve_explicit" as const }));
  await expect(workflowTools.blueprint_precheck_record({
    trusted: precheckTrusted, workflow: claimed, projectRoot: precheckFixture.projectRoot,
    args: {
      expected_workflow_revision: claimed.revision, event_id: "precheck-extra-subject", occurred_at: "2026-07-26T00:04:00.000Z",
      task_id: "create-blueprint", lease_id: "precheck-lease", decision_id: "precheck-extra-subject", candidate_blueprint: precheckLoaded.blueprint,
      checks: [...validChecks, { ...validChecks[0]!, subject_id: "ghost" }],
    },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_SUBJECT_INVALID" });
  const withExtraTask = await commitWorkflowMutation(precheckFixture.projectRoot, {
    expectedRevision: claimed.revision, eventId: "precheck-extra-task", actor: "engine", occurredAt: "2026-07-26T00:05:00.000Z",
    update: (state) => workflowStateSchema.parse({ ...claimed, revision: claimed.revision + 1, tasks: [...state.tasks, {
      id: "unrelated-task", kind: "create-character", status: "pending", assigned_agent: "director", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: { stage: "blueprint" },
    }] }),
  });
  const prechecked = await workflowTools.blueprint_precheck_record({
    trusted: precheckTrusted, workflow: withExtraTask, projectRoot: precheckFixture.projectRoot,
    args: {
      expected_workflow_revision: withExtraTask.revision, event_id: "precheck-success", occurred_at: "2026-07-26T00:06:00.000Z",
      task_id: "create-blueprint", lease_id: "precheck-lease", decision_id: "precheck-success", candidate_blueprint: precheckLoaded.blueprint, checks: validChecks,
    },
  });
  expect(prechecked.tasks.find((task) => task.id === "create-blueprint")?.blueprint_precheck).toBeDefined();

  const worldbookFixture = await setupMcpWorkspace("mcp-deep-worldbook", "original", "assisted");
  cleanups.push(worldbookFixture.workspace.cleanup);
  const worldbookTrusted = await createTrustedContext(worldbookFixture.environment);
  const worldbookLoaded = await loadAuthorProject(worldbookFixture.workspace.projectsRoot, "mcp-deep-worldbook");
  if (!worldbookLoaded.workflow || !worldbookLoaded.manifest || !worldbookLoaded.blueprint) throw new Error("worldbook fixture incomplete");
  await writeYamlFixture(path.join(worldbookFixture.projectRoot, "project.yaml"), { ...worldbookLoaded.manifest, kind: "worldbook", characters: [] });
  await writeYamlFixture(path.join(worldbookFixture.projectRoot, "blueprint.yaml"), {
    ...worldbookLoaded.blueprint, project_kind: "worldbook", collaboration_mode: "assisted", characters: [], world: { ...worldbookLoaded.blueprint.world, enabled: true },
    greetings: { ...worldbookLoaded.blueprint.greetings, enabled: false, character_ids: [] }, relationships: { enabled: false, character_ids: [], requirements: [], extensions: {} },
  });
  const worldbookReloaded = await loadAuthorProject(worldbookFixture.workspace.projectsRoot, "mcp-deep-worldbook");
  if (!worldbookReloaded.workflow || !worldbookReloaded.blueprint) throw new Error("worldbook reload failed");
  const worldbookChecks = dimensions.map((dimension) => ({ subject_id: "mcp-deep-worldbook", dimension, uncertainty: "low" as const, impact: "low" as const, basis: "world basis", action: "preserve_explicit" as const }));
  await expect(workflowTools.blueprint_precheck_record({
    trusted: worldbookTrusted, workflow: worldbookReloaded.workflow, projectRoot: worldbookFixture.projectRoot,
    args: {
      expected_workflow_revision: worldbookReloaded.workflow.revision, event_id: "worldbook-precheck", occurred_at: "2026-07-26T00:07:00.000Z",
      task_id: "missing", lease_id: "missing", decision_id: "worldbook-precheck", candidate_blueprint: worldbookReloaded.blueprint, checks: worldbookChecks,
    },
  })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_TASK_INVALID" });

  const clarificationFixture = await setupMcpWorkspace("mcp-deep-clarification", "original", "assisted");
  cleanups.push(clarificationFixture.workspace.cleanup);
  const clarificationCreator = await createTrustedContext({ ...clarificationFixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" });
  const clarificationLoaded = await loadAuthorProject(clarificationFixture.workspace.projectsRoot, "mcp-deep-clarification");
  if (!clarificationLoaded.workflow) throw new Error("clarification fixture incomplete");
  await rm(path.join(clarificationFixture.projectRoot, "blueprint.yaml"));
  await expect(workflowTools.task_request_clarification({
    trusted: clarificationCreator, workflow: clarificationLoaded.workflow, projectRoot: clarificationFixture.projectRoot,
    args: { task_id: "missing", clarification_id: "missing", decision_id: "missing", question: "q", reason: "r", affected_modules: ["appearance"], options: [{ id: "a", label: "A", consequence: "A" }, { id: "b", label: "B", consequence: "B" }], expected_workflow_revision: clarificationLoaded.workflow.revision, event_id: "clarification-invalid", occurred_at: "2026-07-26T00:08:00.000Z" },
  })).rejects.toMatchObject({ code: "PROJECT_INVALID" });

  const factsFixture = await setupMcpWorkspace("mcp-deep-facts", "source_adaptation", "free");
  cleanups.push(factsFixture.workspace.cleanup);
  const factsTrusted = await createTrustedContext(factsFixture.environment);
  const factsLoaded = await loadAuthorProject(factsFixture.workspace.projectsRoot, "mcp-deep-facts");
  if (!factsLoaded.workflow) throw new Error("facts fixture incomplete");
  const factsWorkflow = workflowStateSchema.parse({
    ...factsLoaded.workflow, stage: "facts_review", gates: [{ id: "facts", status: "pending", input_revisions: [], extensions: {} }],
    tasks: [{ id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator", capabilities: ["task.execute"], input_artifacts: [], output_contract: "facts-curation-summary@1", dependencies: [], attempt: 1, max_attempts: 1, result: { id: "facts", revision: `sha256:${"a".repeat(64)}`, contract: "facts-curation-summary@1" }, extensions: {} }],
  });
  await rm(path.join(factsFixture.projectRoot, "project.yaml"));
  await expect(workflowTools.workflow_approve_gate({
    trusted: factsTrusted, workflow: factsWorkflow, projectRoot: factsFixture.projectRoot,
    args: { expected_workflow_revision: factsWorkflow.revision, event_id: "facts-invalid-project", occurred_at: "2026-07-26T00:09:00.000Z", decision_id: "facts-invalid-project", gate_id: "facts", input_revisions: [], summary: "invalid" },
  })).rejects.toMatchObject({ code: "PROJECT_INVALID" });

  const contentFixture = await setupMcpWorkspace("mcp-deep-content", "original", "free");
  cleanups.push(contentFixture.workspace.cleanup);
  const contentTrusted = await createTrustedContext(contentFixture.environment);
  const contentLoaded = await loadAuthorProject(contentFixture.workspace.projectsRoot, "mcp-deep-content");
  const contentRevision = contentLoaded.sourceRevisions["characters/alice/zhuji/01-appearance.yaml"];
  if (!contentLoaded.workflow || !contentRevision) throw new Error("content fixture incomplete");
  const contentWorkflow = workflowStateSchema.parse({
    ...contentLoaded.workflow, stage: "content_review", revision: 1,
    gates: [{ id: "facts", status: "not_required", input_revisions: [], extensions: {} }, { id: "blueprint", status: "approved", input_revisions: [], extensions: {} }, { id: "content", status: "pending", input_revisions: [], extensions: {} }, { id: "publish", status: "pending", input_revisions: [], extensions: {} }],
    artifacts: [{ id: "author-characters-alice-zhuji-01-appearance.yaml", status: "draft", revision: contentRevision, updated_at: "2026-07-26T00:10:00.000Z", extensions: {} }],
  });
  await expect(workflowTools.workflow_reject_gate({
    trusted: contentTrusted, workflow: contentWorkflow, projectRoot: contentFixture.projectRoot,
    args: { expected_workflow_revision: 1, event_id: "content-target-required", occurred_at: "2026-07-26T00:10:00.000Z", decision_id: "content-target-required", gate_id: "content", input_revisions: [{ id: "author-characters-alice-zhuji-01-appearance.yaml", revision: contentRevision }], summary: "target", rejection_route: "content_revision", revision_scope: ["character"], revision_run_id: "content-run" },
  })).rejects.toMatchObject({ code: "CONTENT_REVISION_TARGET_REQUIRED" });
  await rm(path.join(contentFixture.projectRoot, "blueprint.yaml"));
  await expect(workflowTools.workflow_reject_gate({
    trusted: contentTrusted, workflow: contentWorkflow, projectRoot: contentFixture.projectRoot,
    args: { expected_workflow_revision: 1, event_id: "content-project-invalid", occurred_at: "2026-07-26T00:11:00.000Z", decision_id: "content-project-invalid", gate_id: "content", input_revisions: [{ id: "author-characters-alice-zhuji-01-appearance.yaml", revision: contentRevision }], summary: "greeting", rejection_route: "content_revision", revision_scope: ["greetings"], revision_run_id: "greeting-run" },
  })).rejects.toMatchObject({ code: "PROJECT_INVALID" });

  const createExpansion = async (id: string, relationships = false) => {
    const fixture = await setupMcpWorkspace(id, "original", "free", relationships ? { secondCharacter: true, relationships: true } : {});
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, id);
    if (!loaded.workflow || !loaded.blueprint || !loaded.manifest) throw new Error("expansion fixture incomplete");
    const newCharacter = relationships
      ? { id: "cara", display_name: "Cara", mode: "palette" as const, role: "supporting" as const, core_concept: "New rival" }
      : { id: "beth", display_name: "Beth", mode: "palette" as const, role: "supporting" as const, core_concept: "New rival" };
    const candidateBlueprint = {
      ...loaded.blueprint,
      characters: [...loaded.blueprint.characters, { id: newCharacter.id, display_name: newCharacter.display_name, mode: newCharacter.mode, core_concept: newCharacter.core_concept }],
      greetings: loaded.blueprint.greetings.enabled ? { ...loaded.blueprint.greetings, character_ids: [...loaded.blueprint.greetings.character_ids, newCharacter.id] } : loaded.blueprint.greetings,
      relationships: relationships ? { enabled: true, character_ids: ["alice", "beth", "cara"], requirements: [], extensions: {} } : loaded.blueprint.relationships,
    };
    const late = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: loaded.workflow.revision, eventId: `${id}-late`, actor: "engine", occurredAt: "2026-07-26T00:12:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, stage: "published", revision: state.revision + 1, gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} }, { id: "blueprint", status: "approved", input_revisions: [], extensions: {} }, { id: "content", status: "approved", input_revisions: [], extensions: {} }, { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ], tasks: [{ id: `${id}-review`, kind: "review-character", status: "completed", assigned_agent: "character-critic", capabilities: ["task.execute"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 1, result: { id: `${id}-review-result`, revision: `sha256:${"b".repeat(64)}` }, extensions: { stage: "semantic_review" } }] }),
    });
    const begun = await workflowTools.character_expansion_begin({
      trusted, projectRoot: fixture.projectRoot, workflow: late,
      args: { expected_workflow_revision: late.revision, event_id: `${id}-begin`, occurred_at: "2026-07-26T00:13:00.000Z", run_id: `${id}-run`, reason: "Add a rival", new_characters: [newCharacter], candidate_blueprint: candidateBlueprint, affected_artifact_ids: [], revise_world: false },
    });
    return { fixture, trusted, loaded, candidateBlueprint, begun };
  };

  const wrongRun = await createExpansion("mcp-deep-expansion-run");
  await expect(workflowTools.character_expansion_blueprint_update({
    trusted: wrongRun.trusted, projectRoot: wrongRun.fixture.projectRoot, workflow: wrongRun.begun,
    args: { expected_workflow_revision: wrongRun.begun.revision, event_id: "expansion-wrong-run", occurred_at: "2026-07-26T00:14:00.000Z", run_id: "wrong-run", reason: "wrong", candidate_blueprint: wrongRun.candidateBlueprint },
  })).rejects.toMatchObject({ code: "CHARACTER_EXPANSION_LEGACY_RUN" });
  const stalePath = String((wrongRun.begun.extensions.character_expansion as { candidate_path: string }).candidate_path);
  const staleCandidate = JSON.parse(await readFile(path.join(wrongRun.fixture.projectRoot, stalePath), "utf8")) as Record<string, unknown>;
  await writeFile(path.join(wrongRun.fixture.projectRoot, stalePath), JSON.stringify({ ...staleCandidate, version: 2 }), "utf8");
  await expect(workflowTools.character_expansion_blueprint_update({
    trusted: wrongRun.trusted, projectRoot: wrongRun.fixture.projectRoot, workflow: wrongRun.begun,
    args: { expected_workflow_revision: wrongRun.begun.revision, event_id: "expansion-stale-candidate", occurred_at: "2026-07-26T00:15:00.000Z", run_id: "mcp-deep-expansion-run-run", reason: "stale", candidate_blueprint: wrongRun.candidateBlueprint },
  })).rejects.toMatchObject({ code: "CHARACTER_EXPANSION_CANDIDATE_STALE" });
  const materialized = workflowStateSchema.parse({ ...wrongRun.begun, extensions: { ...wrongRun.begun.extensions, character_expansion: { ...(wrongRun.begun.extensions.character_expansion as Record<string, unknown>), materialized: true } } });
  await expect(workflowTools.workflow_approve_gate({
    trusted: wrongRun.trusted, projectRoot: wrongRun.fixture.projectRoot, workflow: materialized,
    args: { expected_workflow_revision: materialized.revision, event_id: "expansion-materialized", occurred_at: "2026-07-26T00:16:00.000Z", decision_id: "expansion-materialized", gate_id: "blueprint", summary: "already materialized" },
  })).resolves.toBeUndefined();

  const relationshipFalse = await createExpansion("mcp-deep-expansion-no-relationships");
  await expect(workflowTools.workflow_approve_gate({
    trusted: relationshipFalse.trusted, projectRoot: relationshipFalse.fixture.projectRoot, workflow: relationshipFalse.begun,
    args: { expected_workflow_revision: relationshipFalse.begun.revision, event_id: "expansion-no-relationships", occurred_at: "2026-07-26T00:17:00.000Z", decision_id: "expansion-no-relationships", gate_id: "blueprint", summary: "no relationship operation" },
  })).rejects.toBeDefined();
  const relationshipTrue = await createExpansion("mcp-deep-expansion-relationships", true);

  await expect(workflowTools.workflow_approve_gate({
    trusted: relationshipTrue.trusted, projectRoot: relationshipTrue.fixture.projectRoot, workflow: relationshipTrue.begun,
    args: { expected_workflow_revision: relationshipTrue.begun.revision, event_id: "expansion-relationships", occurred_at: "2026-07-26T00:18:00.000Z", decision_id: "expansion-relationships", gate_id: "blueprint", summary: "relationship operation" },
  })).rejects.toBeDefined();

  const baseStale = await createExpansion("mcp-deep-expansion-base-stale");
  const baseManifest = baseStale.loaded.manifest!;
  await writeYamlFixture(path.join(baseStale.fixture.projectRoot, "project.yaml"), { ...baseManifest, title: "Changed title", card: { ...baseManifest.card, name: "Changed title" } });
  await expect(workflowTools.workflow_approve_gate({
    trusted: baseStale.trusted, projectRoot: baseStale.fixture.projectRoot, workflow: baseStale.begun,
    args: { expected_workflow_revision: baseStale.begun.revision, event_id: "expansion-base-stale", occurred_at: "2026-07-26T00:19:00.000Z", decision_id: "expansion-base-stale", gate_id: "blueprint", summary: "stale base", input_revisions: [] },
  })).rejects.toMatchObject({ code: "CHARACTER_EXPANSION_BASE_STALE" });
  const invalidApproval = await createExpansion("mcp-deep-expansion-invalid-project");
  await rm(path.join(invalidApproval.fixture.projectRoot, "blueprint.yaml"));
  await expect(workflowTools.workflow_approve_gate({
    trusted: invalidApproval.trusted, projectRoot: invalidApproval.fixture.projectRoot, workflow: invalidApproval.begun,
    args: { expected_workflow_revision: invalidApproval.begun.revision, event_id: "expansion-invalid-project", occurred_at: "2026-07-26T00:20:00.000Z", decision_id: "expansion-invalid-project", gate_id: "blueprint", summary: "invalid project", input_revisions: [] },
  })).rejects.toMatchObject({ code: "PROJECT_INVALID" });

  const unknownTarget = await createExpansion("mcp-deep-expansion-unknown-target");
  const unknownMetadata = unknownTarget.begun.extensions.character_expansion as { candidate_path: string; candidate_revision: string };
  const unknownPath = path.join(unknownTarget.fixture.projectRoot, unknownMetadata.candidate_path);
  const unknownCandidate = JSON.parse(await readFile(unknownPath, "utf8")) as Record<string, unknown>;
  const unknownDocument = { ...unknownCandidate, affected_artifacts: [{ id: "author-not-present.yaml", revision: `sha256:${"a".repeat(64)}` }] };
  const unknownRevision = computeRevision(unknownDocument);
  await writeFile(unknownPath, JSON.stringify(unknownDocument), "utf8");
  const candidateArtifact = unknownTarget.begun.artifacts.find((artifact) => artifact.id.includes("character-expansion-candidate-"));
  if (!candidateArtifact) throw new Error("candidate artifact missing");
  const unknownWorkflow = workflowStateSchema.parse({
    ...unknownTarget.begun,
    artifacts: unknownTarget.begun.artifacts.map((artifact) => artifact.id === candidateArtifact.id ? { ...artifact, revision: unknownRevision } : artifact),
    extensions: { ...unknownTarget.begun.extensions, character_expansion: { ...unknownTarget.begun.extensions.character_expansion, candidate_revision: unknownRevision } },
  });
  await expect(workflowTools.workflow_approve_gate({
    trusted: unknownTarget.trusted, projectRoot: unknownTarget.fixture.projectRoot, workflow: unknownWorkflow,
    args: { expected_workflow_revision: unknownWorkflow.revision, event_id: "expansion-unknown-target", occurred_at: "2026-07-26T00:21:00.000Z", decision_id: "expansion-unknown-target", gate_id: "blueprint", summary: "unknown target", input_revisions: [{ id: candidateArtifact.id, revision: unknownRevision }] },
  })).rejects.toMatchObject({ code: "CHARACTER_EXPANSION_TARGET_STALE" });

  const staleGate = await setupMcpWorkspace("mcp-deep-expansion-gate", "original", "free");
  cleanups.push(staleGate.workspace.cleanup);
  const staleGateTrusted = await createTrustedContext(staleGate.environment);
  const staleGateLoaded = await loadAuthorProject(staleGate.workspace.projectsRoot, "mcp-deep-expansion-gate");
  if (!staleGateLoaded.workflow || !staleGateLoaded.blueprint) throw new Error("stale gate fixture incomplete");
  const staleGateRevision = staleGateLoaded.sourceRevisions["blueprint.yaml"]!;
  const staleGateWorkflow = workflowStateSchema.parse({
    ...staleGateLoaded.workflow, stage: "blueprint", revision: 1, extensions: { character_expansion: { legacy: true } },
    artifacts: [{ id: "blueprint", status: "draft", revision: staleGateRevision, updated_at: "2026-07-26T00:22:00.000Z", extensions: {} }],
    gates: [{ id: "blueprint", status: "pending", input_revisions: [], extensions: {} }],
  });
  for (const [suffix, inputRevisions] of [["none", []], ["wrong-id", [{ id: "other", revision: staleGateRevision }]], ["wrong-revision", [{ id: "blueprint", revision: `sha256:${"0".repeat(64)}` }]]] as const) {
    await expect(workflowTools.workflow_approve_gate({
      trusted: staleGateTrusted, projectRoot: staleGate.projectRoot, workflow: staleGateWorkflow,
      args: { expected_workflow_revision: staleGateWorkflow.revision, event_id: `stale-gate-${suffix}`, occurred_at: "2026-07-26T00:23:00.000Z", decision_id: `stale-gate-${suffix}`, gate_id: "blueprint", summary: "stale", input_revisions: inputRevisions },
    })).rejects.toMatchObject({ code: "CHARACTER_EXPANSION_BLUEPRINT_GATE_STALE" });
  }
});