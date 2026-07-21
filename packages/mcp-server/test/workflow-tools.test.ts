import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAuthorProject } from "@card-workspace/project";
import { getJobStatus, intakeRetrievedSource } from "@card-workspace/ingestion";
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
      characters: [...loaded.blueprint.characters, { id: "beth", display_name: "貝絲", mode: "palette" as const, core_concept: "愛麗絲的冷靜競爭對手", relationship_summary: "互相競爭也互相尊重" }],
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
        run_id: "add-beth-1", reason: "Add a supporting rival", new_title: "雙星競逐",
        new_characters: [{ id: "beth", display_name: "貝絲", mode: "palette", role: "supporting", core_concept: "愛麗絲的冷靜競爭對手", relationship_summary: "互相競爭也互相尊重" }],
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
          characters: [...expanded.blueprint!.characters, { id: "cara", display_name: "卡拉", mode: "palette", core_concept: "Unexpected" }],
          greetings: { ...expanded.blueprint!.greetings, character_ids: ["alice", "beth", "cara"] },
        },
      },
    })).rejects.toThrow(/完整保留|identity/u);
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
        stage: "authoring",
        revision: 1,
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
      question: "關係核心採哪一種？", reason: "會改變多個後續模組", affected_modules: ["extension", "scene-dialogue"],
      options: [{ id: "rivals", label: "宿敵", consequence: "競爭張力" }, { id: "partners", label: "搭檔", consequence: "合作張力" }],
    }));
    expect(waiting.tasks[0]).toMatchObject({ status: "needs_user_decision", attempt: 1 });
    expect(waiting.tasks[0]?.lease).toBeUndefined();
    const resolved = await workflowTools.task_resolve_clarification(directorContext(waiting, {
      task_id: "create-alice-extension", expected_workflow_revision: 2,
      event_id: "clarification-resolved", occurred_at: "2026-07-14T00:02:00.000Z",
      clarification_id: "relationship-choice", decision_id: "relationship-answer", answer: "採宿敵", selected_option: "rivals",
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
      basis: `${dimension} 已由 intake 明確提供`, action: "preserve_explicit",
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
});
