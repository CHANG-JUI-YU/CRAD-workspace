import { loadWorkflowConfig } from "@card-workspace/workflow";
import { workflowStateSchema } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { authorizeTool, authorizeWorkspaceTool } from "../src/authorization.js";
import { repositoryRoot } from "./helpers.js";

const now = new Date("2026-07-14T01:00:00.000Z");

async function request(overrides: Record<string, unknown> = {}) {
  const config = await loadWorkflowConfig(repositoryRoot);
  const workflow = workflowStateSchema.parse({
    schema_version: 2,
    project_id: "demo",
    workflow_definition_id: "original-v1",
    entry_kind: "original",
    stage: "authoring",
    revision: 1,
    artifacts: [], gates: [], decisions: [],
    tasks: [{
      id: "task-1", kind: "create-character", status: "claimed", assigned_agent: "zhuji-creator",
      capabilities: ["task.execute", "task.clarify", "character.propose"], input_artifacts: [], output_contract: "proposal@1",
      dependencies: [], attempt: 1, max_attempts: 3,
      lease: { id: "lease-1", owner: "zhuji-creator", claimed_at: "2026-07-14T00:00:00.000Z", expires_at: "2026-07-14T02:00:00.000Z" },
      extensions: {},
    }],
    extensions: {},
  });
  return { agentId: "zhuji-creator", toolName: "character_submit_proposal", config, workflow, taskId: "task-1", leaseId: "lease-1", now, ...overrides } as Parameters<typeof authorizeTool>[0];
}

describe("four-way tool authorization", () => {
  it("keeps workspace bootstrap Director-only", async () => {
    const { config } = await request();
    expect(authorizeWorkspaceTool({ agentId: "director", toolName: "project_initialize", config }))
      .toEqual({ capability: "workspace.initialize" });
    expect(authorizeWorkspaceTool({ agentId: "director", toolName: "project_list", config }))
      .toEqual({ capability: "workspace.discover" });
    expect(() => authorizeWorkspaceTool({ agentId: "fact-curator", toolName: "project_initialize", config }))
      .toThrow(/Tool is not authorized/u);
    expect(() => authorizeWorkspaceTool({ agentId: "card-import-analyst", toolName: "project_list", config }))
      .toThrow(/Tool is not authorized/u);
  });

  it("requires registry, current task, stage, and valid lease", async () => {
    expect(authorizeTool(await request())).toMatchObject({ capability: "character.propose", task: { id: "task-1" } });
    await expect(async () => authorizeTool(await request({ leaseId: "wrong" }))).rejects.toMatchObject({ code: "TOOL_CAPABILITY_DENIED" });
    await expect(async () => authorizeTool(await request({ agentId: "character-critic" }))).rejects.toMatchObject({ code: "TOOL_CAPABILITY_DENIED" });
    const expired = await request({ now: new Date("2026-07-14T03:00:00.000Z") });
    expect(() => authorizeTool(expired)).toThrow(/Tool is not authorized/u);
  });

  it("keeps critic and creator capabilities physically separate", async () => {
    const criticWrite = await request({ agentId: "character-critic", toolName: "character_submit_proposal" });
    const creatorReview = await request({ toolName: "review_submit_report" });
    expect(() => authorizeTool(criticWrite)).toThrow(/Tool is not authorized/u);
    expect(() => authorizeTool(creatorReview)).toThrow(/Tool is not authorized/u);
  });

  it("authorizes only the bound Relationship Creator for relationship authoring tasks", async () => {
    const base = await request();
    const relationshipWorkflow = workflowStateSchema.parse({
      ...base.workflow,
      tasks: [{
        ...base.workflow.tasks[0]!, kind: "create-relationships", assigned_agent: "relationship-creator",
        capabilities: ["task.execute", "relationships.propose"],
        lease: { ...base.workflow.tasks[0]!.lease!, owner: "relationship-creator" },
        extensions: { output_kind: "relationships", participant_ids: ["alice", "beth"] },
      }],
    });
    const allowed = { ...base, workflow: relationshipWorkflow, agentId: "relationship-creator", toolName: "character_submit_proposal" };
    expect(authorizeTool(allowed)).toMatchObject({ capability: "relationships.propose", task: { kind: "create-relationships" } });
    expect(() => authorizeTool({ ...allowed, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...allowed, toolName: "review_submit_report" })).toThrow(/not authorized/u);
  });

  it("allows only the assigned Creator to request clarification and only Director to resolve", async () => {
    const requestClarification = await request({ toolName: "task_request_clarification" });
    expect(authorizeTool(requestClarification)).toMatchObject({ capability: "task.clarify", task: { id: "task-1" } });
    expect(() => authorizeTool({ ...requestClarification, agentId: "director" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...requestClarification, agentId: "character-critic" })).toThrow(/not authorized/u);

    const resolveClarification = await request({ agentId: "director", toolName: "task_resolve_clarification", taskId: undefined, leaseId: undefined });
    expect(authorizeTool(resolveClarification)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...resolveClarification, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
  });

  it("allows only Director to begin world authoring on published projects", async () => {
    const director = await request({ agentId: "director", toolName: "world_authoring_begin", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "published", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...director, agentId: "world-lore-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "authoring" }) })).toThrow(/not authorized/u);
  });

  it("allows only Director to begin World revisions after review", async () => {
    const director = await request({ agentId: "director", toolName: "world_revision_begin", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "pre_world_review", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...director, agentId: "world-lore-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "pre_world_authoring" }) })).toThrow(/not authorized/u);
  });

  it("allows only Director to query artifacts in every workflow stage without a task", async () => {
    for (const stage of [
      "intake", "source_processing", "facts_review", "blueprint", "pre_world_authoring",
      "pre_world_review", "authoring", "semantic_review", "post_world_authoring",
      "post_world_review", "greetings_authoring", "content_review", "compile_preview",
      "publish_review", "published",
    ] as const) {
      const director = await request({
        agentId: "director",
        toolName: "project_artifact_read",
        taskId: undefined,
        leaseId: undefined,
      });
      director.workflow = workflowStateSchema.parse({ ...director.workflow, stage, tasks: [] });
      expect(authorizeTool(director)).toEqual({ capability: "artifact.read" });
      expect(() => authorizeTool({ ...director, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
    }
  });

  it("allows only Director to begin late Greeting revisions", async () => {
    const director = await request({ agentId: "director", toolName: "greetings_revision_begin", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "compile_preview", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...director, agentId: "greetings-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "greetings_authoring" }) })).toThrow(/not authorized/u);
  });

  it("allows only Director to begin reviewed Character revisions", async () => {
    const director = await request({ agentId: "director", toolName: "character_revision_begin", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "compile_preview", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...director, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "authoring" }) })).toThrow(/not authorized/u);
  });

  it("allows only Director to begin and amend Character expansion in its allowed stages", async () => {
    const director = await request({ agentId: "director", toolName: "character_expansion_begin", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "compile_preview", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...director, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "authoring" }) })).toThrow(/not authorized/u);
    const update = { ...director, toolName: "character_expansion_blueprint_update", workflow: workflowStateSchema.parse({ ...director.workflow, stage: "blueprint" }) };
    expect(authorizeTool(update)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...update, agentId: "palette-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...update, workflow: workflowStateSchema.parse({ ...update.workflow, stage: "published" }) })).toThrow(/not authorized/u);
  });

  it("allows only Director to retry failed Character Review in semantic review", async () => {
    const director = await request({ agentId: "director", toolName: "character_review_retry_begin", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "semantic_review", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
    expect(() => authorizeTool({ ...director, agentId: "character-critic" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "authoring" }) })).toThrow(/not authorized/u);
  });

  it("allows only Director to recover supported tasks without a task lease", async () => {
    for (const stage of ["blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review"] as const) {
      const director = await request({ agentId: "director", toolName: "task_recovery_begin", taskId: undefined, leaseId: undefined });
      director.workflow = workflowStateSchema.parse({ ...director.workflow, stage, tasks: [] });
      expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
      expect(() => authorizeTool({ ...director, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
    }
    const denied = await request({ agentId: "director", toolName: "task_recovery_begin", taskId: undefined, leaseId: undefined });
    denied.workflow = workflowStateSchema.parse({ ...denied.workflow, stage: "compile_preview", tasks: [] });
    expect(() => authorizeTool(denied)).toThrow(/not authorized/u);
  });

  it("allows only Director to resume a repaired exhausted task without a task lease", async () => {
    for (const stage of ["blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review"] as const) {
      const director = await request({ agentId: "director", toolName: "task_repair_resume", taskId: undefined, leaseId: undefined });
      director.workflow = workflowStateSchema.parse({ ...director.workflow, stage, tasks: [] });
      expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
      expect(() => authorizeTool({ ...director, agentId: "greetings-creator" })).toThrow(/not authorized/u);
    }
    const denied = await request({ agentId: "director", toolName: "task_repair_resume", taskId: undefined, leaseId: undefined });
    denied.workflow = workflowStateSchema.parse({ ...denied.workflow, stage: "compile_preview", tasks: [] });
    expect(() => authorizeTool(denied)).toThrow(/not authorized/u);
  });

  it("keeps Facts review status and source repair Director-only without a task lease", async () => {
    for (const [toolName, stage] of [["facts_review_status", "facts_review"], ["facts_candidate_identity_migrate", "facts_review"], ["facts_recuration_begin", "facts_review"], ["source_processing_repair_begin", "source_processing"]] as const) {
      const director = await request({ agentId: "director", toolName, taskId: undefined, leaseId: undefined });
      director.workflow = workflowStateSchema.parse({ ...director.workflow, stage, tasks: [] });
      expect(authorizeTool(director)).toEqual({ capability: "workflow.direct" });
      expect(() => authorizeTool({ ...director, agentId: "fact-curator" })).toThrow(/not authorized/u);
    }
  });

  it("separates Source Researcher search/fetch from Director exact approval while sharing status", async () => {
    const base = await request({ taskId: undefined, leaseId: undefined });
    base.workflow = workflowStateSchema.parse({ ...base.workflow, entry_kind: "source_adaptation", stage: "intake", tasks: [] });
    for (const toolName of ["source_research_submit_candidates", "source_research_fetch_approved"] as const) {
      expect(authorizeTool({ ...base, agentId: "source-researcher", toolName })).toEqual({ capability: "source.research" });
      expect(() => authorizeTool({ ...base, agentId: "director", toolName })).toThrow(/not authorized/u);
    }
    expect(authorizeTool({ ...base, agentId: "director", toolName: "source_research_approve" })).toEqual({ capability: "source.approve" });
    expect(() => authorizeTool({ ...base, agentId: "source-researcher", toolName: "source_research_approve" })).toThrow(/not authorized/u);
    expect(authorizeTool({ ...base, agentId: "director", toolName: "source_research_status" })).toEqual({ capability: "source.approve" });
    expect(authorizeTool({ ...base, agentId: "source-researcher", toolName: "source_research_status" })).toEqual({ capability: "source.research" });
  });

  it("requires the exact curation task owner and lease for source and candidate tools", async () => {
    const curation = await request({ agentId: "fact-curator", toolName: "fact_finalize_curation", taskId: "curate-facts", leaseId: "curation-lease" });
    curation.workflow = workflowStateSchema.parse({
      ...curation.workflow,
      entry_kind: "source_adaptation",
      stage: "source_processing",
      tasks: [{
        id: "curate-facts", kind: "curate-facts", status: "claimed", assigned_agent: "fact-curator",
        capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"], input_artifacts: [],
        output_contract: "facts-curation-summary@1", dependencies: [], attempt: 1, max_attempts: 3,
        lease: { id: "curation-lease", owner: "fact-curator", claimed_at: "2026-07-14T00:00:00.000Z", expires_at: "2026-07-14T02:00:00.000Z" },
        extensions: { stage: "source_processing", source_jobs: {} },
      }],
    });
    expect(authorizeTool(curation)).toMatchObject({ capability: "facts.propose", task: { id: "curate-facts" } });
    expect(() => authorizeTool({ ...curation, leaseId: "wrong" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...curation, agentId: "director" })).toThrow(/not authorized/u);
  });

  it("allows Director to start a controlled repackaging preview from published", async () => {
    const director = await request({ agentId: "director", toolName: "project_compile_preview", taskId: undefined, leaseId: undefined });
    director.workflow = workflowStateSchema.parse({ ...director.workflow, stage: "published", tasks: [] });
    expect(authorizeTool(director)).toEqual({ capability: "forge.preview" });
    expect(() => authorizeTool({ ...director, agentId: "zhuji-creator" })).toThrow(/not authorized/u);
    expect(() => authorizeTool({ ...director, workflow: workflowStateSchema.parse({ ...director.workflow, stage: "authoring" }) })).toThrow(/not authorized/u);
  });

  it("authorizes retry claims and requires the publish gate", async () => {
    const claim = await request();
    claim.toolName = "task_claim";
    claim.leaseId = undefined;
    claim.workflow = workflowStateSchema.parse({
      ...claim.workflow,
      tasks: [{ ...claim.workflow.tasks[0], status: "retryable", lease: undefined }],
    });
    expect(authorizeTool(claim)).toMatchObject({ capability: "task.execute", task: { status: "retryable" } });

    claim.workflow = workflowStateSchema.parse({
      ...claim.workflow,
      tasks: [{
        ...claim.workflow.tasks[0],
        status: "claimed",
        lease: { id: "expired-lease", owner: "zhuji-creator", claimed_at: "2026-07-13T00:00:00.000Z", expires_at: "2026-07-13T01:00:00.000Z" },
      }],
    });
    expect(authorizeTool(claim)).toMatchObject({ capability: "task.execute", task: { status: "claimed" } });

    const publish = await request({ agentId: "director", toolName: "project_publish", taskId: undefined, leaseId: undefined });
    publish.workflow = workflowStateSchema.parse({
      ...publish.workflow,
      stage: "publish_review",
      gates: [{ id: "publish", status: "pending", input_revisions: [], extensions: {} }],
    });
    expect(() => authorizeTool(publish)).toThrow(/Tool is not authorized/u);
    publish.workflow = workflowStateSchema.parse({
      ...publish.workflow,
      gates: [{ id: "publish", status: "approved", input_revisions: [], extensions: {} }],
    });
    expect(authorizeTool(publish)).toEqual({ capability: "forge.publish" });
  });

  it("treats retained reports and cancellations as closed routing outcomes", async () => {
    const closed = await request({ agentId: "director", toolName: "workflow_advance", taskId: undefined, leaseId: undefined });
    closed.workflow = workflowStateSchema.parse({
      ...closed.workflow,
      outcome: { status: "closed", kind: "report_retained", closed_at: "2026-07-16T00:00:00Z", decision_id: "retain-choice" },
    });
    expect(() => authorizeTool(closed)).toThrow(/closed/u);
    closed.toolName = "workflow_status";
    expect(authorizeTool(closed)).toEqual({ capability: "workflow.read" });
  });
});
