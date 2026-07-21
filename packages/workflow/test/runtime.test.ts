import { blueprintSchema, pluginRevisionIntentSchema, projectManifestSchema, workflowDefinitionSchema, workflowStateSchema, type WorkflowState } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { advanceConfiguredWorkflow, beginCharacterExpansion, beginCharacterRevision, beginCharacterReviewRetry, beginFactsRecuration, beginGreetingsRevision, beginSourceProcessingRepair, beginTaskRecovery, beginWorldAuthoring, beginWorldRevision, completeSourceProcessingTask, resumeTaskAfterRepair, startConfiguredWorkflow, WorkflowError } from "../src/index.js";

const occurredAt = "2026-07-14T00:00:00.000Z";

function expectWorkflowError(call: () => unknown, code: string): void {
  try {
    call();
    throw new Error(`Expected WorkflowError ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).code).toBe(code);
  }
}

function state(entryKind: "original" | "source_adaptation" | "card_import" | "mode_conversion" = "original") {
  const definitionIds = {
    original: "original-v1",
    source_adaptation: "source-adaptation-v1",
    card_import: "card-import-v1",
    mode_conversion: "mode-conversion-v1",
  } as const;
  return workflowStateSchema.parse({
    schema_version: 2,
    project_id: "runtime-demo",
    workflow_definition_id: definitionIds[entryKind],
    entry_kind: entryKind,
    stage: "intake",
    revision: 0,
    artifacts: [], gates: [], tasks: [],
    decisions: [
      { id: "intake-concept", kind: "interview.answer", actor: "director", decided_at: occurredAt, input_revisions: [], summary: "Concept", extensions: { question_id: "concept" } },
      { id: "intake-complete", kind: "interview.complete", actor: "director", decided_at: occurredAt, input_revisions: [], summary: "No additional settings", option: "no-additional-settings", extensions: { question_id: "additional-settings" } },
    ],
    extensions: {},
  });
}

describe("configured workflow runtime", () => {
  it("uses the entry-specific stage sequence and materializes only the target stage tasks", () => {
    const original = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original", stages: ["intake", "blueprint", "authoring"],
      required_gates: ["blueprint", "content", "publish"],
      tasks: [
        { id: "create-blueprint", kind: "create-blueprint", agent_kind: "director", stage: "blueprint", capabilities: ["blueprint.propose"], output_contract: "proposal@1", max_attempts: 3 },
        { id: "create-character", kind: "create-character", agent_kind: "zhuji-creator", stage: "authoring", capabilities: ["character.propose"], output_contract: "proposal@1", max_attempts: 3 },
      ],
    });
    const started = startConfiguredWorkflow({ state: state(), definition: original, occurredAt });
    expect(started).toMatchObject({
      stage: "blueprint", revision: 1,
      tasks: [{ id: "create-blueprint", assigned_agent: "director", capabilities: ["task.execute", "blueprint.propose"] }],
      gates: [{ id: "facts", status: "not_required" }, { id: "blueprint", status: "pending" }, { id: "content", status: "pending" }, { id: "publish", status: "pending" }],
    });
    expect(startConfiguredWorkflow({ state: started, definition: original, occurredAt })).toBe(started);

    const adaptation = workflowDefinitionSchema.parse({
      id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["intake", "source_processing", "facts_review"],
      required_gates: ["facts", "blueprint", "content", "publish"],
      tasks: [{ id: "curate-facts", kind: "curate-facts", agent_kind: "fact-curator", stage: "source_processing", capabilities: ["facts.propose"], output_contract: "proposal@1", max_attempts: 3 }],
    });
    expect(startConfiguredWorkflow({
      state: state("source_adaptation"), definition: adaptation,
      initialInputArtifacts: [{ id: "source", revision: `sha256:${"0".repeat(64)}`, contract: "source-text@1" }], occurredAt,
    })).toMatchObject({
      stage: "source_processing", tasks: [{ id: "curate-facts", assigned_agent: "fact-curator" }],
      gates: [{ status: "pending" }, { status: "pending" }, { status: "pending" }, { status: "pending" }],
    });
  });

  it("rejects missing intake, dirty state, invalid definitions, and stages without task templates", () => {
    const valid = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original", stages: ["intake", "blueprint"], required_gates: ["blueprint"],
      tasks: [{ id: "create-blueprint", kind: "create-blueprint", agent_kind: "director", stage: "blueprint", capabilities: [], output_contract: "proposal@1", max_attempts: 1 }],
    });
    expect(() => startConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), decisions: [] }), definition: valid, occurredAt })).toThrow(/intake/u);
    expect(() => startConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), decisions: state().decisions.filter((decision) => decision.kind !== "interview.complete") }), definition: valid, occurredAt })).toThrow(/增加或補充/u);
    expect(() => startConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), gates: [{ id: "facts", status: "pending", input_revisions: [], extensions: {} }] }), definition: valid, occurredAt })).toThrow(/task.*gate/u);
    expect(() => startConfiguredWorkflow({ state: state(), definition: { ...valid, id: "other" }, occurredAt })).toThrow(/does not match/u);
    expect(() => startConfiguredWorkflow({ state: state(), definition: { ...valid, stages: ["intake", "authoring"] }, occurredAt })).toThrow(/沒有 task/u);
  });

  it("runs source adaptation through source processing, Facts Gate, Blueprint, and the shared mode-driven tail", () => {
    const sourceRevision = `sha256:${"1".repeat(64)}` as const;
    const factsRevision = `sha256:${"2".repeat(64)}` as const;
    const blueprintRevision = `sha256:${"3".repeat(64)}` as const;
    const source = { id: "source-novel", revision: sourceRevision, contract: "source-text@1" };
    const definition = workflowDefinitionSchema.parse({
      id: "source-adaptation-v1", entry_kind: "source_adaptation",
      stages: ["intake", "source_processing", "facts_review", "blueprint", "authoring"],
      required_gates: ["facts", "blueprint"],
      tasks: [{
        id: "curate-facts", kind: "curate-facts", agent_kind: "fact-curator", stage: "source_processing",
        capabilities: ["facts.propose"], output_contract: "proposal@1", max_attempts: 3,
      }],
    });
    expectWorkflowError(
      () => startConfiguredWorkflow({ state: state("source_adaptation"), definition, occurredAt }),
      "SOURCE_ADAPTATION_SOURCE_REQUIRED",
    );
    const started = startConfiguredWorkflow({
      state: state("source_adaptation"), definition, initialInputArtifacts: [source], occurredAt,
    });
    expect(started.tasks[0]).toMatchObject({
      id: "curate-facts", input_artifacts: [source], output_contract: "facts-curation-summary@1",
    });

    const claimed = workflowStateSchema.parse({
      ...started,
      tasks: started.tasks.map((task) => ({
        ...task, status: "claimed", attempt: 1,
        lease: { id: "facts-lease", owner: "fact-curator", claimed_at: occurredAt, expires_at: "2026-07-14T01:00:00.000Z" },
      })),
    });
    const curated = completeSourceProcessingTask({
      state: claimed, taskId: "curate-facts", leaseId: "facts-lease", owner: "fact-curator",
      result: { id: "facts-summary", revision: factsRevision, contract: "facts-curation-summary@1" },
      clock: { now: () => new Date("2026-07-14T00:30:00.000Z") },
    });
    expect(curated.tasks[0]).toMatchObject({ status: "completed", lease: undefined, result: { id: "facts-summary" } });
    const factsReview = advanceConfiguredWorkflow({ state: curated, definition });
    expect(factsReview.stage).toBe("facts_review");
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: factsReview, definition }), "WORKFLOW_GATE_BLOCKED");

    const approvedFacts = workflowStateSchema.parse({
      ...factsReview,
      gates: factsReview.gates.map((gate) => gate.id === "facts" ? { ...gate, status: "approved" } : gate),
    });
    const blueprintStage = advanceConfiguredWorkflow({ state: approvedFacts, definition });
    expect(blueprintStage.stage).toBe("blueprint");
    expect(blueprintStage.tasks.at(-1)).toMatchObject({
      id: "create-blueprint", kind: "create-blueprint", assigned_agent: "director", status: "pending",
      capabilities: ["task.execute", "blueprint.propose"], input_artifacts: [source, { id: "facts-summary", revision: factsRevision, contract: "facts-curation-summary@1" }],
    });

    const ready = workflowStateSchema.parse({
      ...blueprintStage,
      gates: blueprintStage.gates.map((gate) => gate.id === "blueprint" ? { ...gate, status: "approved" } : gate),
      artifacts: [{ id: "blueprint", status: "draft", revision: blueprintRevision, updated_at: occurredAt, extensions: {} }],
      tasks: blueprintStage.tasks.map((task) => task.id === "create-blueprint"
        ? { ...task, status: "completed", result: { id: "blueprint-proposal", revision: blueprintRevision } }
        : task),
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "source_adaptation", purpose: "Adapt a novel",
      characters: [
        { id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" },
        { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" },
      ],
      world: { enabled: false }, greetings: { enabled: false, character_ids: [] },
    });
    const authoring = advanceConfiguredWorkflow({ state: ready, definition, blueprint });
    expect(authoring.stage).toBe("authoring");
    expect(authoring.tasks.some((task) => task.id === "create-alice-appearance" && task.assigned_agent === "zhuji-creator")).toBe(true);
    expect(authoring.tasks.some((task) => task.id === "create-beth-basic_information" && task.assigned_agent === "palette-creator")).toBe(true);
  });

  it("reuses a configured source-adaptation Blueprint task template", () => {
    const revision = `sha256:${"4".repeat(64)}` as const;
    const definition = workflowDefinitionSchema.parse({
      id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["intake", "source_processing", "facts_review", "blueprint"],
      required_gates: ["facts"],
      tasks: [{
        id: "director-blueprint", kind: "create-blueprint", agent_kind: "director", stage: "blueprint",
        capabilities: ["blueprint.propose", "facts.read"], output_contract: "proposal@2", max_attempts: 2,
      }],
    });
    const factsReview = workflowStateSchema.parse({
      ...state("source_adaptation"), stage: "facts_review", revision: 2,
      gates: [{ id: "facts", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "facts-summary", status: "approved", revision, updated_at: occurredAt, contract: "facts-curation-summary@1", extensions: {} }],
    });
    expect(advanceConfiguredWorkflow({ state: factsReview, definition }).tasks.at(-1)).toMatchObject({
      id: "director-blueprint", assigned_agent: "director", capabilities: ["task.execute", "blueprint.propose", "facts.read"],
      output_contract: "proposal@2", max_attempts: 2,
    });
  });

  it("validates curate-facts completion kind, lease ownership, and output contract", () => {
    const revision = `sha256:${"5".repeat(64)}` as const;
    const task = {
      id: "curate-facts", kind: "curate-facts", status: "claimed" as const, assigned_agent: "fact-curator",
      capabilities: ["task.execute", "facts.propose"], input_artifacts: [], output_contract: "facts-curation-summary@1",
      dependencies: [], attempt: 1, max_attempts: 3,
      lease: { id: "lease", owner: "fact-curator", claimed_at: occurredAt, expires_at: "2026-07-14T01:00:00.000Z" }, extensions: { stage: "source_processing" },
    };
    const base = workflowStateSchema.parse({ ...state("source_adaptation"), stage: "source_processing", tasks: [task] });
    const call = (stateValue = base, overrides: Record<string, unknown> = {}) => completeSourceProcessingTask({
      state: stateValue, taskId: "curate-facts", leaseId: "lease", owner: "fact-curator",
      result: { id: "facts", revision, contract: "facts-curation-summary@1" },
      clock: { now: () => new Date("2026-07-14T00:30:00.000Z") }, ...overrides,
    });
    expect(call().tasks[0]?.status).toBe("completed");
    expectWorkflowError(() => call(base, { owner: "other" }), "TASK_LEASE_MISMATCH");
    expectWorkflowError(() => call(base, { result: { id: "facts", revision, contract: "proposal@1" } }), "TASK_OUTPUT_CONTRACT_MISMATCH");
    const wrongKind = workflowStateSchema.parse({ ...base, tasks: [{ ...task, kind: "create-blueprint" }] });
    expectWorkflowError(() => call(wrongKind), "CURATE_FACTS_TASK_KIND_REQUIRED");
  });

  it("repairs an exhausted source-processing task while preserving history and rejecting invalid repair runs", () => {
    const sourceRevision = `sha256:${"6".repeat(64)}` as const;
    const sourceInputs = [{ id: "source-novel", revision: sourceRevision, contract: "source-text@1" }];
    const failedTask = {
      id: "curate-facts", kind: "curate-facts", status: "failed" as const, assigned_agent: "fact-curator",
      capabilities: ["task.execute", "facts.propose"], input_artifacts: sourceInputs,
      output_contract: "facts-curation-summary@1", dependencies: [], attempt: 3, max_attempts: 3,
      failure_summary: "Source chunks could not be reconciled", extensions: { stage: "source_processing" },
    };
    const base = workflowStateSchema.parse({
      ...state("source_adaptation"), stage: "source_processing", revision: 4, tasks: [failedTask],
    });
    const call = (stateValue = base, overrides: Record<string, unknown> = {}) => beginSourceProcessingRepair({
      state: stateValue, sourceInputs, runId: "repair-1", reason: "Re-run curation with clean source jobs",
      occurredAt, actor: "director", ...overrides,
    });
    const repaired = call();
    expect(repaired).toMatchObject({ revision: 5, stage: "source_processing" });
    expect(repaired.tasks[0]).toMatchObject({ id: "curate-facts", status: "superseded", failure_summary: "Source chunks could not be reconciled" });
    expect(repaired.tasks[1]).toEqual(expect.objectContaining({
      id: "curate-facts-repair-1", kind: "curate-facts", status: "pending", assigned_agent: "fact-curator",
      capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"],
      input_artifacts: sourceInputs, output_contract: "facts-curation-summary@1", attempt: 0, max_attempts: 3,
       extensions: {
         repair_of: "curate-facts", repair_root: "curate-facts", repair_generation: 1,
         repair_run_id: "repair-1", stage: "source_processing", source_jobs: {},
       },
    }));
    expect(repaired.decisions.at(-1)).toMatchObject({
      id: "source-processing-repair-repair-1", kind: "source_processing.repair_requested", actor: "director",
      input_revisions: sourceInputs,
       extensions: {
         repair_of: "curate-facts", repair_root: "curate-facts", repair_generation: 1,
         repair_run_id: "repair-1", successor_task_id: "curate-facts-repair-1",
       },
    });

    expectWorkflowError(() => call(base, { actor: "fact-curator" }), "SOURCE_PROCESSING_REPAIR_DENIED");
    expectWorkflowError(() => call(base, { sourceInputs: [] }), "SOURCE_ADAPTATION_SOURCE_REQUIRED");
    expectWorkflowError(
      () => call(workflowStateSchema.parse({ ...base, entry_kind: "original", workflow_definition_id: "original-v1" })),
      "SOURCE_PROCESSING_REPAIR_STAGE_DENIED",
    );
    expectWorkflowError(
      () => call(workflowStateSchema.parse({ ...base, tasks: [{ ...failedTask, attempt: 2 }] })),
      "SOURCE_PROCESSING_REPAIR_ATTEMPTS_NOT_EXHAUSTED",
    );
    expectWorkflowError(
      () => call(workflowStateSchema.parse({
        ...base,
        tasks: [...base.tasks, {
          ...failedTask, id: "active", status: "claimed", attempt: 1,
          lease: { id: "active-lease", owner: "worker", claimed_at: occurredAt, expires_at: "2099-01-01T00:00:00.000Z" },
        }],
      })),
      "SOURCE_PROCESSING_REPAIR_ACTIVE_LEASE",
    );
    expectWorkflowError(
      () => call(workflowStateSchema.parse({ ...base, tasks: [{ ...failedTask, extensions: { ...failedTask.extensions, repair_of: "older" } }] })),
      "SOURCE_PROCESSING_REPAIR_LINEAGE_EXISTS",
    );
    expectWorkflowError(() => call(repaired), "SOURCE_PROCESSING_REPAIR_TARGET_NOT_FAILED");
    const failedRepair = workflowStateSchema.parse({
      ...repaired,
      tasks: repaired.tasks.map((task) => task.id === "curate-facts-repair-1"
        ? {
            ...task,
            status: "failed",
            attempt: 3,
            failure_summary: "Source artifact ID was interpreted as a source ID",
            failure: {
              category: "artifact_integrity",
              summary: "Source artifact ID was interpreted as a source ID",
              failed_at: occurredAt,
              failed_by: "fact-curator",
              attempt: 3,
            },
          }
        : task),
    });
    const secondRepair = call(failedRepair, { runId: "repair-2", reason: "Retry after source tool contract correction" });
    expect(secondRepair.tasks.at(-1)).toMatchObject({
      id: "curate-facts-repair-2",
      status: "pending",
      input_artifacts: sourceInputs,
      extensions: {
        repair_of: "curate-facts-repair-1",
        repair_root: "curate-facts",
        repair_generation: 2,
      },
    });
    const exhaustedSecondRepair = workflowStateSchema.parse({
      ...secondRepair,
      tasks: secondRepair.tasks.map((task) => task.id === "curate-facts-repair-2"
        ? { ...task, status: "failed", attempt: 3, failure_summary: "Still failed" }
        : task),
    });
    expectWorkflowError(
      () => call(exhaustedSecondRepair, { runId: "repair-3" }),
      "SOURCE_PROCESSING_REPAIR_LINEAGE_EXHAUSTED",
    );
    const conflict = workflowStateSchema.parse({
      ...base,
      decisions: [{
        id: "source-processing-repair-repair-1", kind: "existing", actor: "director", decided_at: occurredAt,
        input_revisions: [], summary: "Existing run", extensions: {},
      }],
    });
    expectWorkflowError(() => call(conflict), "SOURCE_PROCESSING_REPAIR_ID_CONFLICT");
  });

  it("re-curates completed facts with exact source inputs while preserving predecessor and resetting all gates", () => {
    const sourceInputs = [{ id: "source-novel", revision: `sha256:${"7".repeat(64)}` as const }];
    const predecessor = {
      id: "curate-facts", kind: "curate-facts", status: "completed" as const, assigned_agent: "fact-curator",
      capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"], input_artifacts: sourceInputs,
      output_contract: "facts-curation-summary@1", dependencies: [], attempt: 1, max_attempts: 3,
      result: { id: "facts-summary", revision: `sha256:${"8".repeat(64)}` as const, contract: "facts-curation-summary@1" },
      extensions: { stage: "source_processing" },
    };
    const base = workflowStateSchema.parse({
      ...state("source_adaptation"), stage: "facts_review", revision: 6, tasks: [predecessor],
      gates: ["facts", "blueprint", "content", "publish"].map((id) => ({
        id, status: "approved", decision_id: `${id}-approved`, input_revisions: sourceInputs, extensions: {},
      })),
    });
    const call = (stateValue = base, overrides: Record<string, unknown> = {}) => beginFactsRecuration({
      state: stateValue, sourceInputs, runId: "quality-2", reason: "Coverage is below adaptation readiness",
      occurredAt, actor: "director", ...overrides,
    });
    const next = call();
    expect(next).toMatchObject({ stage: "source_processing", revision: 7 });
    expect(next.tasks[0]).toEqual(predecessor);
    expect(next.tasks[1]).toMatchObject({
      id: "curate-facts-recurate-quality-2", kind: "curate-facts", status: "pending",
      input_artifacts: sourceInputs,
      extensions: { stage: "source_processing", source_jobs: {}, curation_run_id: "quality-2", recuration_of: "curate-facts" },
    });
    expect(next.gates).toHaveLength(4);
    for (const gate of next.gates) {
      expect(gate).toMatchObject({ status: "pending", input_revisions: [] });
    }
    expect(next.decisions.at(-1)).toMatchObject({
      id: "facts-recuration-quality-2", kind: "facts.recuration.requested", input_revisions: sourceInputs,
      extensions: {
        curation_run_id: "quality-2", predecessor_task_id: "curate-facts",
        successor_task_id: "curate-facts-recurate-quality-2",
      },
    });
    expectWorkflowError(() => call(base, { actor: "fact-curator" }), "FACTS_RECURATION_DENIED");
    expectWorkflowError(() => call(base, { sourceInputs: [] }), "SOURCE_ADAPTATION_SOURCE_REQUIRED");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, stage: "blueprint" })), "FACTS_RECURATION_DENIED");
    expectWorkflowError(() => call(workflowStateSchema.parse({
      ...base, tasks: [{ ...predecessor, status: "failed", result: undefined }],
    })), "FACTS_RECURATION_DENIED");
    expectWorkflowError(() => call(next), "FACTS_RECURATION_DENIED");
  });

  it("materializes original authoring tasks from each Blueprint character mode without parallel world work", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original", stages: ["intake", "blueprint", "authoring", "semantic_review"], required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Two character card",
      characters: [
        { id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" },
        { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" },
      ],
      world: { enabled: true, categories: ["concepts"] }, greetings: { enabled: true, character_ids: ["alice", "beth"], requirements: [] },
    });
    const ready = workflowStateSchema.parse({
      ...state(), stage: "blueprint", revision: 3,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [{ id: "create-blueprint", kind: "create-blueprint", status: "completed", assigned_agent: "director", capabilities: ["task.execute", "blueprint.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "blueprint-proposal", revision: `sha256:${"b".repeat(64)}` }, extensions: {} }],
    });
    const advanced = advanceConfiguredWorkflow({ state: ready, definition, blueprint });
    expect(advanced).toMatchObject({ stage: "authoring", revision: 4 });
    expect(advanced.tasks.some((task) => task.id === "create-alice-appearance" && task.assigned_agent === "zhuji-creator")).toBe(true);
    expect(advanced.tasks.some((task) => task.id === "create-alice-trait_dialogue")).toBe(true);
    expect(advanced.tasks.some((task) => task.id === "create-alice-expanded_extension")).toBe(false);
    expect(advanced.tasks.find((task) => task.id === "create-alice-trait_dialogue")?.dependencies).toEqual(["create-alice-trait_refinement"]);
    expect(advanced.tasks.find((task) => task.id === "create-alice-self_introduction")?.dependencies).toEqual(["create-alice-scene_dialogue"]);
    expect(advanced.tasks.some((task) => task.id === "create-beth-basic_information" && task.assigned_agent === "palette-creator")).toBe(true);
    expect(advanced.tasks.some((task) => task.id === "create-alice-basic_information")).toBe(false);
    expect(advanced.tasks.some((task) => task.id === "create-greetings")).toBe(false);
    expect(advanced.tasks.some((task) => task.id === "create-world")).toBe(false);
    expect(advanced.tasks.find((task) => task.id === "create-alice-appearance")?.capabilities).toContain("task.clarify");
    expect(advanced.tasks.find((task) => task.id === "create-beth-basic_information")?.capabilities).toContain("task.clarify");
  });

  it("materializes relationships only when enabled and depends on participant mixed-mode tails", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original", stages: ["intake", "blueprint", "authoring", "semantic_review"], required_gates: ["blueprint"], tasks: [],
    });
    const ready = workflowStateSchema.parse({
      ...state(), stage: "blueprint", revision: 3,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
    });
    const common = {
      schema_version: 1 as const, project_id: "runtime-demo", entry_kind: "original" as const, purpose: "Subset graph",
      characters: [
        { id: "alice", display_name: "Alice", mode: "zhuji" as const, core_concept: "Lead" },
        { id: "beth", display_name: "Beth", mode: "palette" as const, core_concept: "Rival" },
        { id: "cara", display_name: "Cara", mode: "zhuji" as const, core_concept: "Observer" },
      ],
      world: { enabled: false }, greetings: { enabled: false, character_ids: [] },
    };
    const enabled = blueprintSchema.parse({
      ...common,
      relationships: { enabled: true, character_ids: ["alice", "beth"] },
    });
    const authoring = advanceConfiguredWorkflow({ state: ready, definition, blueprint: enabled });
    expect(authoring.tasks.find((task) => task.id === "create-relationships")).toMatchObject({
      kind: "create-relationships",
      assigned_agent: "relationship-creator",
      output_contract: "proposal@1",
      dependencies: ["create-alice-self_introduction", "create-beth-secondary_interpretation"],
      extensions: { output_kind: "relationships", participant_ids: ["alice", "beth"] },
    });
    expect(authoring.tasks.find((task) => task.id === "create-relationships")?.dependencies).not.toContain("create-cara-self_introduction");
    const relationshipRevision = `sha256:${"c".repeat(64)}` as const;
    const completed = workflowStateSchema.parse({
      ...authoring,
      tasks: authoring.tasks.map((task) => task.extensions.stage === "authoring" ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision: relationshipRevision } } : task),
      artifacts: [...authoring.artifacts, { id: "author-relationships.yaml", status: "draft", revision: relationshipRevision, contract: "relationships@1", updated_at: occurredAt, extensions: {} }],
    });
    const review = advanceConfiguredWorkflow({ state: completed, definition, blueprint: enabled });
    expect(review.tasks.at(-1)?.kind).toBe("review-character");
    expect(review.tasks.at(-1)?.input_artifacts).toContainEqual({ id: "author-relationships.yaml", revision: relationshipRevision, contract: "relationships@1" });

    const disabled = blueprintSchema.parse(common);
    expect(advanceConfiguredWorkflow({ state: ready, definition, blueprint: disabled }).tasks.some((task) => task.kind === "create-relationships")).toBe(false);
  });

  it("serializes world authoring and real review before or after character review from Blueprint timing", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review"],
      required_gates: ["blueprint"], tasks: [],
    });
    const baseBlueprint = {
      schema_version: 1 as const, project_id: "runtime-demo", entry_kind: "original" as const, purpose: "Timed world",
      characters: [{ id: "alice", display_name: "Alice", mode: "palette" as const, core_concept: "Leader" }],
      greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    };
    const ready = workflowStateSchema.parse({
      ...state(), stage: "blueprint", revision: 3,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [],
    });
    const completeStage = (current: typeof ready) => workflowStateSchema.parse({
      ...current,
      tasks: current.tasks.map((task) => task.extensions.stage === current.stage
        ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision: `sha256:${"b".repeat(64)}` } }
        : task),
    });

    const before = blueprintSchema.parse({ ...baseBlueprint, world: { enabled: true, authoring_timing: "before_characters" } });
    const beforeWorld = advanceConfiguredWorkflow({ state: ready, definition, blueprint: before });
    expect(beforeWorld).toMatchObject({ stage: "pre_world_authoring", tasks: [{ kind: "create-world" }] });
    const beforeReview = advanceConfiguredWorkflow({ state: completeStage(beforeWorld), definition, blueprint: before });
    expect(beforeReview).toMatchObject({ stage: "pre_world_review" });
    expect(beforeReview.tasks.at(-1)).toMatchObject({ kind: "review-world", status: "pending" });
    expect(() => advanceConfiguredWorkflow({ state: beforeReview, definition, blueprint: before })).toThrow(/not complete/u);
    const beforeCharacters = advanceConfiguredWorkflow({ state: completeStage(beforeReview), definition, blueprint: before });
    expect(beforeCharacters.stage).toBe("authoring");
    expect(beforeCharacters.tasks.at(-1)).toMatchObject({ assigned_agent: "palette-creator" });

    const after = blueprintSchema.parse({ ...baseBlueprint, world: { enabled: true, authoring_timing: "after_characters" } });
    const afterCharacters = advanceConfiguredWorkflow({ state: ready, definition, blueprint: after });
    expect(afterCharacters.stage).toBe("authoring");
    const characterReview = advanceConfiguredWorkflow({ state: completeStage(afterCharacters), definition, blueprint: after });
    expect(characterReview.stage).toBe("semantic_review");
    const afterWorld = advanceConfiguredWorkflow({ state: completeStage(characterReview), definition, blueprint: after });
    expect(afterWorld).toMatchObject({ stage: "post_world_authoring" });
    const afterReview = advanceConfiguredWorkflow({ state: completeStage(afterWorld), definition, blueprint: after });
    expect(afterReview).toMatchObject({ stage: "post_world_review" });
    expect(afterReview.tasks.at(-1)).toMatchObject({ kind: "review-world", status: "pending" });

    const disabled = blueprintSchema.parse({ ...baseBlueprint, world: { enabled: false } });
    const disabledCharacters = advanceConfiguredWorkflow({ state: ready, definition, blueprint: disabled });
    const disabledReview = advanceConfiguredWorkflow({ state: completeStage(disabledCharacters), definition, blueprint: disabled });
    const disabledGreetings = advanceConfiguredWorkflow({ state: completeStage(disabledReview), definition, blueprint: disabled });
    expect(disabledGreetings.stage).toBe("greetings_authoring");
    expect(disabledGreetings.tasks.some((task) => task.kind.includes("world"))).toBe(false);
  });

  it("defaults legacy enabled worlds without timing to after characters", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "pre_world_authoring", "authoring", "semantic_review", "post_world_authoring"],
      required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Legacy",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: true }, greetings: { enabled: false, character_ids: [] },
    });
    const ready = workflowStateSchema.parse({
      ...state(), stage: "blueprint", revision: 3,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
    });
    expect(advanceConfiguredWorkflow({ state: ready, definition, blueprint }).stage).toBe("authoring");
  });

  it("requires project_publish instead of advancing directly into published", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "publish_review", "published"], required_gates: ["publish"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Publish",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] },
    });
    const ready = workflowStateSchema.parse({
      ...state(), stage: "publish_review", revision: 9,
      gates: [{ id: "publish", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "preview-final", status: "reviewed", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [],
    });
    expect(() => advanceConfiguredWorkflow({ state: ready, definition, blueprint })).toThrow(/project_publish/u);
  });

  it("enables card_import and source_adaptation while keeping mode_conversion fail-closed", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "card-import-v1", entry_kind: "card_import", stages: ["intake", "blueprint", "authoring"], required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "card_import", purpose: "Rebuild an inspected legacy card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Imported character" }],
      world: { enabled: false, categories: [] }, greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    });
    const ready = workflowStateSchema.parse({
      ...state("card_import"), stage: "blueprint", revision: 4,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [],
    });
    expect(advanceConfiguredWorkflow({ state: ready, definition, blueprint }).stage).toBe("authoring");

    const adaptationDefinition = workflowDefinitionSchema.parse({
      id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["intake", "blueprint", "authoring"], required_gates: ["blueprint"], tasks: [],
    });
    expect(advanceConfiguredWorkflow({
      state: workflowStateSchema.parse({ ...ready, workflow_definition_id: "source-adaptation-v1", entry_kind: "source_adaptation" }),
      definition: adaptationDefinition,
      blueprint: blueprintSchema.parse({ ...blueprint, entry_kind: "source_adaptation" }),
    }).stage).toBe("authoring");

    const conversionDefinition = workflowDefinitionSchema.parse({
      id: "mode-conversion-v1", entry_kind: "mode_conversion", stages: ["intake", "blueprint", "authoring"], required_gates: ["blueprint"], tasks: [],
    });
    expect(() => advanceConfiguredWorkflow({
      state: workflowStateSchema.parse({ ...ready, workflow_definition_id: "mode-conversion-v1", entry_kind: "mode_conversion" }),
      definition: conversionDefinition,
      blueprint: blueprintSchema.parse({ ...blueprint, entry_kind: "mode_conversion" }),
    })).toThrow(/not yet executable/u);
  });

  it("does not route a closed card import into Blueprint authoring", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "card-import-v1", entry_kind: "card_import", stages: ["intake", "blueprint", "authoring"], required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "card_import", purpose: "unused",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Imported" }],
      world: { enabled: false, categories: [] }, greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    });
    const closed = workflowStateSchema.parse({
      ...state("card_import"), stage: "blueprint", revision: 4,
      outcome: { status: "closed", kind: "cancelled", closed_at: occurredAt, decision_id: "cancel-choice" },
    });
    expect(() => advanceConfiguredWorkflow({ state: closed, definition, blueprint })).toThrow(/closed/u);
  });

  it("materializes greetings only in its own stage after semantic review", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "greetings_authoring", "content_review"],
      required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false, categories: [] }, greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    });
    const reviewed = workflowStateSchema.parse({
      ...state(), stage: "semantic_review", revision: 8,
      tasks: [{
        id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1",
        dependencies: [], attempt: 1, max_attempts: 3, result: { id: "character-review", revision: `sha256:${"c".repeat(64)}` },
        extensions: { stage: "semantic_review" },
      }],
    });

    const advanced = advanceConfiguredWorkflow({ state: reviewed, definition, blueprint });
    expect(advanced.stage).toBe("greetings_authoring");
    expect(advanced.tasks.at(-1)).toMatchObject({
      id: "create-greetings", assigned_agent: "greetings-creator", dependencies: [],
      extensions: { stage: "greetings_authoring", output_kind: "greetings" },
    });
  });

  it("supersedes an unfinished legacy authoring greeting task during stage migration", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "greetings_authoring", "content_review"],
      required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false, categories: [] }, greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    });
    const authoring = workflowStateSchema.parse({
      ...state(), stage: "authoring", revision: 7,
      tasks: [
        {
          id: "create-alice-self_introduction", kind: "create-character-module", status: "completed", assigned_agent: "zhuji-creator",
          capabilities: ["task.execute", "character.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "self-introduction", revision: `sha256:${"d".repeat(64)}` }, extensions: { stage: "authoring" },
        },
        {
          id: "create-greetings", kind: "create-greetings", status: "claimed", assigned_agent: "greetings-creator",
          capabilities: ["task.execute", "greetings.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
          lease: { id: "legacy-lease", owner: "greetings-creator", claimed_at: occurredAt, expires_at: "2099-01-01T00:00:00.000Z" },
          attempt: 1, max_attempts: 3, extensions: { stage: "authoring", output_kind: "greetings" },
        },
      ],
    });

    const advanced = advanceConfiguredWorkflow({ state: authoring, definition, blueprint });
    expect(advanced.stage).toBe("semantic_review");
    expect(advanced.tasks.find((task) => task.id === "create-greetings")).toMatchObject({ status: "superseded", lease: undefined });
    expect(advanced.tasks.at(-1)).toMatchObject({ id: "review-characters", status: "pending" });
  });

  it("reuses a completed legacy greeting and skips duplicate greetings authoring", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "authoring", "semantic_review", "greetings_authoring", "content_review"],
      required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false, categories: [] }, greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    });
    const reviewed = workflowStateSchema.parse({
      ...state(), stage: "semantic_review", revision: 8,
      tasks: [
        {
          id: "create-greetings", kind: "create-greetings", status: "completed", assigned_agent: "greetings-creator",
          capabilities: ["task.execute", "greetings.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "greetings", revision: `sha256:${"e".repeat(64)}` },
          extensions: { stage: "authoring", output_kind: "greetings" },
        },
        {
          id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "character-review", revision: `sha256:${"f".repeat(64)}` },
          extensions: { stage: "semantic_review" },
        },
      ],
    });

    const advanced = advanceConfiguredWorkflow({ state: reviewed, definition, blueprint });
    expect(advanced.stage).toBe("content_review");
    expect(advanced.tasks.filter((task) => task.id === "create-greetings")).toHaveLength(1);
    expect(advanced.tasks.at(-1)).toMatchObject({ id: "review-greetings", status: "pending" });
  });

  it("runs worldbook authoring and review without character or greetings tasks", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "greetings_authoring", "content_review"],
      required_gates: ["blueprint"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Standalone worldbook",
      characters: [], world: { enabled: true, authoring_timing: "before_characters", categories: ["concepts"] }, greetings: { enabled: false, character_ids: [] },
    });
    const ready = workflowStateSchema.parse({
      ...state(), stage: "blueprint", revision: 3,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [],
    });
    const authored = advanceConfiguredWorkflow({ state: ready, definition, blueprint, projectKind: "worldbook" });
    expect(authored.tasks.at(-1)).toMatchObject({ id: "create-world", kind: "create-world" });
    expect(authored.tasks.some((task) => task.kind.includes("character"))).toBe(false);
    const completed = workflowStateSchema.parse({
      ...authored,
      tasks: authored.tasks.map((task) => ({ ...task, status: "completed", result: { id: "world", revision: `sha256:${"b".repeat(64)}` } })),
    });
    const reviewing = advanceConfiguredWorkflow({ state: completed, definition, blueprint, projectKind: "worldbook" });
    expect(reviewing.stage).toBe("pre_world_review");
    expect(reviewing.tasks.at(-1)).toMatchObject({ id: "review-world", kind: "review-world" });
    const reviewed = workflowStateSchema.parse({
      ...reviewing,
      tasks: reviewing.tasks.map((task) => task.extensions.stage === "pre_world_review"
        ? { ...task, status: "completed", result: { id: "world-review", revision: `sha256:${"c".repeat(64)}` } }
        : task),
    });
    expect(advanceConfiguredWorkflow({ state: reviewed, definition, blueprint, projectKind: "worldbook" }).stage).toBe("content_review");
  });

  it("begins a published world-only run, resets gates, and refuses deletion or active tasks", () => {
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] },
    });
    const published = workflowStateSchema.parse({
      ...state(), stage: "published", revision: 10,
      gates: [
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ],
      artifacts: [{ id: "preview-old", status: "reviewed", revision: `sha256:${"c".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [],
    });
    const begun = beginWorldAuthoring({
      state: published, blueprint, world: { enabled: true, categories: ["organizations"] },
      runId: "run-11", occurredAt,
    });
    expect(begun.state).toMatchObject({ stage: "authoring", revision: 11, extensions: { world_only_run: true } });
    expect(begun.state.tasks.at(-1)).toMatchObject({ id: "create-world-run-11", kind: "create-world" });
    expect(begun.state.gates.map((gate) => [gate.id, gate.status])).toEqual([["content", "pending"], ["publish", "pending"]]);
    expect(begun.state.artifacts[0]?.status).toBe("stale");
    expect(begun.blueprint.world.enabled).toBe(true);
    expect(() => beginWorldAuthoring({ state: published, blueprint, world: { enabled: false }, runId: "delete", occurredAt })).toThrow(/不可停用或刪除/u);
    expect(() => beginWorldAuthoring({
      state: workflowStateSchema.parse({ ...published, tasks: begun.state.tasks }), blueprint,
      world: { enabled: true }, runId: "blocked", occurredAt,
    })).toThrow(/active task/u);
  });

  it("revises selected exact world entries after World Review and returns to a fresh review", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "pre_world_authoring", "pre_world_review", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review", "compile_preview", "publish_review", "published"],
      required_gates: ["blueprint", "content", "publish"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: true, authoring_timing: "before_characters", categories: ["organizations", "concepts"] },
      greetings: { enabled: true, character_ids: ["alice"] },
    });
    const groupId = "author-world-organizations-chenxi-group.yaml";
    const deedId = "author-world-concepts-ownership-deed.yaml";
    const reviewed = workflowStateSchema.parse({
      ...state(), stage: "pre_world_review", revision: 12,
      gates: [
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ],
      artifacts: [
        { id: groupId, status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} },
        { id: deedId, status: "draft", revision: `sha256:${"b".repeat(64)}`, updated_at: occurredAt, extensions: {} },
        { id: "preview-old", status: "reviewed", revision: `sha256:${"c".repeat(64)}`, updated_at: occurredAt, extensions: {} },
      ],
      tasks: [{
        id: "review-world", kind: "review-world", status: "completed", assigned_agent: "world-lore-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
        attempt: 1, max_attempts: 3, result: { id: "world-review-v1", revision: `sha256:${"d".repeat(64)}` }, extensions: { stage: "pre_world_review" },
      }],
    });
    const begun = beginWorldRevision({
      state: reviewed,
      worldEntries: [
        { schema_version: 1, id: "chenxi-group", category: "organizations", title: "晨曦集團", content: "集團", related_ids: [] },
        { schema_version: 1, id: "ownership-deed", category: "concepts", title: "所有權契約", content: "契約", related_ids: [] },
      ],
      runId: "world-fix-1", reason: "修正集團與契約設定", artifactIds: [groupId, deedId], occurredAt, actor: "director",
    });
    expect(begun).toMatchObject({ stage: "pre_world_authoring", revision: 13, extensions: { world_revision_run_id: "world-fix-1" } });
    expect(begun.tasks.slice(-2)).toMatchObject([
      { id: "revise-world-organizations-chenxi-group-world-fix-1", dependencies: [], extensions: { target_artifact_id: groupId, world_entry_id: "chenxi-group" } },
      { id: "revise-world-concepts-ownership-deed-world-fix-1", dependencies: ["revise-world-organizations-chenxi-group-world-fix-1"], extensions: { target_artifact_id: deedId, world_entry_id: "ownership-deed" } },
    ]);
    expect(begun.artifacts.find((item) => item.id === "preview-old")?.status).toBe("stale");
    expect(begun.gates.map((gate) => [gate.id, gate.status])).toEqual([["content", "pending"], ["publish", "pending"]]);

    const revised = workflowStateSchema.parse({
      ...begun,
      tasks: begun.tasks.map((task) => task.id.startsWith("revise-world-")
        ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision: `sha256:${"e".repeat(64)}` } }
        : task),
    });
    const rereview = advanceConfiguredWorkflow({ state: revised, definition, blueprint });
    expect(rereview).toMatchObject({ stage: "pre_world_review" });
    expect(rereview.tasks.at(-1)).toMatchObject({ id: "review-world-world-fix-1", kind: "review-world", status: "pending" });
    expect(() => beginWorldRevision({ ...{
      state: reviewed, worldEntries: [], runId: "invalid", reason: "Invalid", occurredAt, actor: "director",
    }, artifactIds: ["preview-old"] })).toThrow(/target/u);
  });

  it("uses the late World revision run ID for the repeated Character Review", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review", "compile_preview", "publish_review", "published"],
      required_gates: ["blueprint", "content", "publish"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: true, authoring_timing: "after_characters", categories: ["organizations"] },
      greetings: { enabled: true, character_ids: ["alice"] },
    });
    const targetId = "author-world-organizations-group.yaml";
    const late = workflowStateSchema.parse({
      ...state(), stage: "content_review", revision: 20,
      gates: [
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "rejected", input_revisions: [], extensions: {} },
        { id: "publish", status: "pending", input_revisions: [], extensions: {} },
      ],
      artifacts: [{ id: targetId, status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [
        {
          id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "character-review-v1", revision: `sha256:${"b".repeat(64)}` }, extensions: { stage: "semantic_review" },
        },
        {
          id: "review-world", kind: "review-world", status: "completed", assigned_agent: "world-lore-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          attempt: 1, max_attempts: 3, result: { id: "world-review-v1", revision: `sha256:${"c".repeat(64)}` }, extensions: { stage: "post_world_review" },
        },
      ],
    });
    const begun = beginWorldRevision({
      state: late,
      blueprint,
      worldEntries: [{ schema_version: 1, id: "group", category: "organizations", title: "Group", content: "Group", related_ids: [] }],
      runId: "late-world-fix-1",
      reason: "Fix late world finding",
      artifactIds: [targetId],
      occurredAt,
      actor: "director",
    });
    const revised = workflowStateSchema.parse({
      ...begun,
      tasks: begun.tasks.map((task) => task.id.startsWith("revise-world-")
        ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision: `sha256:${"d".repeat(64)}` } }
        : task),
    });
    const reviewing = advanceConfiguredWorkflow({ state: revised, definition, blueprint });
    expect(reviewing.stage).toBe("semantic_review");
    expect(reviewing.tasks.at(-1)).toMatchObject({ id: "review-characters-late-world-fix-1", status: "pending" });
  });

  it("creates an auditable Greeting revision task and a unique follow-up review", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "authoring", "semantic_review", "greetings_authoring", "content_review", "compile_preview", "publish_review", "published"],
      required_gates: ["blueprint", "content", "publish"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] },
    });
    const late = workflowStateSchema.parse({
      ...state(), stage: "compile_preview", revision: 20,
      gates: [
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ],
      artifacts: [
        { id: "author-greetings.yaml", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} },
        { id: "preview-old", status: "reviewed", revision: `sha256:${"b".repeat(64)}`, updated_at: occurredAt, extensions: {} },
      ],
      tasks: [{
        id: "create-greetings", kind: "create-greetings", status: "completed", assigned_agent: "greetings-creator",
        capabilities: ["task.execute", "greetings.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
        attempt: 1, max_attempts: 3, result: { id: "greetings-v1", revision: `sha256:${"c".repeat(64)}` }, extensions: { stage: "greetings_authoring" },
      }],
    });
    const begun = beginGreetingsRevision({ state: late, runId: "name-fix-1", reason: "Correct exact character name", occurredAt, actor: "director" });
    expect(begun).toMatchObject({ stage: "greetings_authoring", revision: 21, extensions: { greetings_revision_run_id: "name-fix-1" } });
    expect(begun.tasks.at(-1)).toMatchObject({ id: "revise-greetings-name-fix-1", status: "pending" });
    expect(begun.tasks[0]?.status).toBe("completed");
    expect(begun.artifacts.find((item) => item.id === "preview-old")?.status).toBe("stale");
    expect(begun.gates.filter((gate) => ["content", "publish"].includes(gate.id)).map((gate) => gate.status)).toEqual(["pending", "pending"]);

    const revised = workflowStateSchema.parse({
      ...begun,
      tasks: begun.tasks.map((task) => task.id === "revise-greetings-name-fix-1"
        ? { ...task, status: "completed", result: { id: "greetings-v2", revision: `sha256:${"d".repeat(64)}` } }
        : task),
    });
    const reviewing = advanceConfiguredWorkflow({ state: revised, definition, blueprint });
    expect(reviewing.stage).toBe("content_review");
    expect(reviewing.tasks.at(-1)).toMatchObject({ id: "review-greetings-name-fix-1", status: "pending" });
    const activeLate = workflowStateSchema.parse({ ...late, tasks: [...late.tasks, begun.tasks.at(-1)!] });
    expect(() => beginGreetingsRevision({ state: activeLate, runId: "other", reason: "Blocked", occurredAt, actor: "director" })).toThrow(/active task/u);
  });

  it("creates selected Character revision tasks followed by fresh Character and Greeting reviews", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "authoring", "semantic_review", "greetings_authoring", "content_review", "compile_preview", "publish_review", "published"],
      required_gates: ["blueprint", "content", "publish"], tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] },
    });
    const appearanceId = "author-characters-alice-zhuji-01-appearance.yaml";
    const selfIntroductionId = "author-characters-alice-zhuji-07-self-introduction.yaml";
    const late = workflowStateSchema.parse({
      ...state(), stage: "compile_preview", revision: 30,
      gates: [
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ],
      artifacts: [
        { id: appearanceId, status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} },
        { id: selfIntroductionId, status: "draft", revision: `sha256:${"b".repeat(64)}`, updated_at: occurredAt, extensions: {} },
        { id: "preview-old", status: "reviewed", revision: `sha256:${"c".repeat(64)}`, updated_at: occurredAt, extensions: {} },
      ],
      tasks: [{
        id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
        attempt: 1, max_attempts: 3, result: { id: "character-review-v1", revision: `sha256:${"d".repeat(64)}` }, extensions: { stage: "semantic_review" },
      }],
    });
    const begun = beginCharacterRevision({
      state: late, blueprint, runId: "critic-fix-1", reason: "Fix reviewed contradictions",
      artifactIds: [selfIntroductionId, appearanceId], occurredAt, actor: "director",
    });
    expect(begun).toMatchObject({
      stage: "authoring", revision: 31,
      extensions: { character_revision_run_id: "critic-fix-1", greetings_revision_run_id: "critic-fix-1" },
    });
    expect(begun.tasks.slice(-2)).toMatchObject([
      { id: "revise-alice-appearance-critic-fix-1", status: "pending", dependencies: [] },
      { id: "revise-alice-self_introduction-critic-fix-1", status: "pending", dependencies: ["revise-alice-appearance-critic-fix-1"] },
    ]);
    expect(begun.tasks[0]?.status).toBe("completed");
    expect(begun.artifacts.find((item) => item.id === "preview-old")?.status).toBe("stale");
    expect(begun.gates.filter((gate) => ["content", "publish"].includes(gate.id)).map((gate) => gate.status)).toEqual(["pending", "pending"]);

    const revised = workflowStateSchema.parse({
      ...begun,
      tasks: begun.tasks.map((task) => task.id.startsWith("revise-alice-")
        ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision: `sha256:${"e".repeat(64)}` } }
        : task),
    });
    const reviewing = advanceConfiguredWorkflow({ state: revised, definition, blueprint });
    expect(reviewing).toMatchObject({ stage: "semantic_review" });
    expect(reviewing.tasks.at(-1)).toMatchObject({ id: "review-characters-critic-fix-1", status: "pending" });
    const reviewed = workflowStateSchema.parse({
      ...reviewing,
      tasks: reviewing.tasks.map((task) => task.id === "review-characters-critic-fix-1"
        ? { ...task, status: "completed", result: { id: "character-review-v2", revision: `sha256:${"f".repeat(64)}` } }
        : task),
    });
    const greetingRevision = advanceConfiguredWorkflow({ state: reviewed, definition, blueprint });
    expect(greetingRevision.stage).toBe("greetings_authoring");
    expect(greetingRevision.tasks.at(-1)).toMatchObject({ id: "revise-greetings-critic-fix-1", status: "pending" });
    expect(() => beginCharacterRevision({
      state: late, blueprint, runId: "invalid", reason: "Invalid", artifactIds: ["preview-old"], occurredAt, actor: "director",
    })).toThrow(/target/u);
  });

  it("recovers a failed task with exact snapshot, lineage, one attempt, and direct dependency rewiring", () => {
    const inputRevision = `sha256:${"a".repeat(64)}`;
    const failed = workflowStateSchema.parse({
      ...state(), stage: "authoring", revision: 12,
      tasks: [
        {
          id: "create-alice", kind: "create-character", status: "failed", assigned_agent: "zhuji-creator",
          capabilities: ["task.execute", "character.propose"], input_artifacts: [{ id: "blueprint", revision: inputRevision }],
          output_contract: "proposal@1", dependencies: ["create-blueprint"], attempt: 3, max_attempts: 3,
          failure_summary: "Provider timed out", failure: { category: "provider_timeout", summary: "Provider timed out", failed_at: occurredAt, failed_by: "zhuji-creator", attempt: 3 },
          extensions: { stage: "authoring", character_id: "alice" },
        },
        { id: "direct", kind: "create-character-module", status: "pending", assigned_agent: "zhuji-creator", capabilities: [], input_artifacts: [], output_contract: "proposal@1", dependencies: ["create-alice", "parallel"], attempt: 0, max_attempts: 3, extensions: { stage: "authoring" } },
        { id: "indirect", kind: "create-character-module", status: "pending", assigned_agent: "zhuji-creator", capabilities: [], input_artifacts: [], output_contract: "proposal@1", dependencies: ["direct"], attempt: 0, max_attempts: 3, extensions: { stage: "authoring" } },
      ],
    });
    const recovered = beginTaskRecovery({
      state: failed, taskId: "create-alice", runId: "provider-1", failureCategory: "provider_timeout",
      reason: "Retry transient provider failure", occurredAt, actor: "director",
    });
    expect(recovered).toMatchObject({ revision: 13 });
    expect(recovered.tasks[0]).toMatchObject({ id: "create-alice", status: "superseded", attempt: 3, failure: { category: "provider_timeout" } });
    expect(recovered.tasks.at(-1)).toMatchObject({
      id: "recover-provider-1", kind: "create-character", status: "pending", attempt: 0, max_attempts: 1,
      input_artifacts: [{ id: "blueprint", revision: inputRevision }], dependencies: ["create-blueprint"],
      extensions: { stage: "authoring", character_id: "alice", recovery_of: "create-alice", recovery_run_id: "provider-1", recovery_generation: 1, recovery_input_strategy: "same_snapshot" },
    });
    expect(recovered.tasks.find((task) => task.id === "direct")?.dependencies).toEqual(["recover-provider-1", "parallel"]);
    expect(recovered.tasks.find((task) => task.id === "indirect")?.dependencies).toEqual(["direct"]);
    expect(recovered.decisions.at(-1)).toMatchObject({
      id: "task-recovery-provider-1", kind: "task.recovery.requested", input_revisions: [{ id: "blueprint", revision: inputRevision }],
      extensions: { run_id: "provider-1", task_id: "create-alice", successor_task_id: "recover-provider-1", failure_category: "provider_timeout", rewired_task_ids: ["direct"] },
    });
  });

  it.each([
    ["original", "blueprint", "create-blueprint"],
    ["source_adaptation", "blueprint", "create-blueprint"],
    ["card_import", "blueprint", "create-blueprint"],
    ["card_import", "blueprint", "analyze-import"],
    ["original", "authoring", "create-character"],
    ["original", "authoring", "create-character-module"],
    ["original", "authoring", "create-relationships"],
    ["original", "pre_world_authoring", "create-world"],
    ["original", "post_world_authoring", "create-world"],
    ["original", "authoring", "create-world"],
    ["original", "pre_world_review", "review-world"],
    ["original", "post_world_review", "review-world"],
    ["original", "content_review", "review-world"],
    ["original", "semantic_review", "review-character"],
    ["original", "greetings_authoring", "create-greetings"],
    ["original", "content_review", "review-greetings"],
  ] as const)("supports %s %s %s recovery", (entryKind, stage, kind) => {
    const failed = workflowStateSchema.parse({
      ...state(entryKind), stage, revision: 2,
      tasks: [{
        id: "failed-task", kind, status: "failed", assigned_agent: "worker", capabilities: [], input_artifacts: [],
        output_contract: "proposal@1", dependencies: [], attempt: 3, max_attempts: 3, failure_summary: "Unavailable",
        failure: { category: "temporary_unavailable", summary: "Unavailable", failed_at: occurredAt, failed_by: "worker", attempt: 3 },
        extensions: { stage },
      }],
    });
    expect(beginTaskRecovery({
      state: failed, taskId: "failed-task", runId: `${kind}-${stage}`, failureCategory: "temporary_unavailable",
      reason: "Transient outage", occurredAt, actor: "director",
    }).tasks.at(-1)).toMatchObject({ kind, max_attempts: 1 });
  });

  it.each([
    ["source_adaptation", "source_processing", "curate-facts"],
    ["original", "blueprint", "analyze-import"],
    ["source_adaptation", "blueprint", "analyze-import"],
    ["mode_conversion", "blueprint", "create-blueprint"],
    ["mode_conversion", "authoring", "create-character"],
  ] as const)("rejects %s %s %s generic recovery", (entryKind, stage, kind) => {
    const failed = workflowStateSchema.parse({
      ...state(entryKind), stage, revision: 2,
      tasks: [{
        id: "failed-task", kind, status: "failed", assigned_agent: "worker", capabilities: [], input_artifacts: [],
        output_contract: "proposal@1", dependencies: [], attempt: 3, max_attempts: 3, failure_summary: "Unavailable",
        failure: { category: "temporary_unavailable", summary: "Unavailable", failed_at: occurredAt, failed_by: "worker", attempt: 3 },
        extensions: { stage },
      }],
    });
    expectWorkflowError(() => beginTaskRecovery({
      state: failed, taskId: "failed-task", runId: `${kind}-${stage}`, failureCategory: "temporary_unavailable",
      reason: "Transient outage", occurredAt, actor: "director",
    }), "TASK_RECOVERY_STAGE_UNSUPPORTED");
  });

  it("validates recovery classification, stage, lineage, graph, lease, actor, and legacy classification", () => {
    const failedTask = {
      id: "review-characters", kind: "review-character", status: "failed" as const, assigned_agent: "character-critic",
      capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
      attempt: 3, max_attempts: 3, failure_summary: "Interrupted", extensions: { stage: "semantic_review" },
    };
    const base = workflowStateSchema.parse({ ...state(), stage: "semantic_review", revision: 7, tasks: [failedTask] });
    const call = (stateValue = base, overrides: Record<string, unknown> = {}) => beginTaskRecovery({
      state: stateValue, taskId: "review-characters", runId: "retry-1", failureCategory: "session_interruption",
      reason: "Resume interrupted review", occurredAt, actor: "director", ...overrides,
    });
    expect(call().tasks.at(-1)).toMatchObject({ id: "recover-retry-1", max_attempts: 1 });
    expectWorkflowError(() => call(base, { failureCategory: "semantic_failure" }), "TASK_RECOVERY_FAILURE_NOT_RECOVERABLE");
    expectWorkflowError(() => call(base, { actor: "character-critic" }), "TASK_RECOVERY_DENIED");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, tasks: [{ ...failedTask, attempt: 2 }] })), "TASK_RECOVERY_ATTEMPTS_NOT_EXHAUSTED");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, stage: "content_review" })), "TASK_RECOVERY_STAGE_UNSUPPORTED");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, tasks: [{ ...failedTask, failure: { category: "provider_timeout", summary: "Timed out", failed_at: occurredAt, failed_by: "character-critic", attempt: 3 } }] })), "TASK_RECOVERY_FAILURE_NOT_RECOVERABLE");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, tasks: [{ ...failedTask, kind: "curate-facts" }] })), "TASK_RECOVERY_STAGE_UNSUPPORTED");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, outcome: { status: "closed", kind: "cancelled", closed_at: occurredAt, decision_id: "cancelled" } })), "WORKFLOW_CLOSED");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, decisions: [{ id: "task-recovery-retry-1", kind: "existing", actor: "director", decided_at: occurredAt, input_revisions: [], summary: "Existing", extensions: {} }] })), "TASK_RECOVERY_ID_CONFLICT");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, tasks: [...base.tasks, { ...failedTask, id: "active", status: "claimed", lease: { id: "lease", owner: "critic", claimed_at: occurredAt, expires_at: "2099-01-01T00:00:00.000Z" } }] })), "TASK_RECOVERY_ACTIVE_LEASE");
    expectWorkflowError(() => call(workflowStateSchema.parse({ ...base, tasks: [...base.tasks, { ...failedTask, id: "dependent", status: "completed", dependencies: ["review-characters"], result: { id: "result", revision: `sha256:${"b".repeat(64)}` } }] })), "TASK_RECOVERY_GRAPH_INVALID");
    const once = call();
    expectWorkflowError(() => beginTaskRecovery({ state: workflowStateSchema.parse({ ...once, tasks: once.tasks.map((task) => task.id === "recover-retry-1" ? { ...task, status: "failed", attempt: 1, failure_summary: "Again" } : task) }), taskId: "recover-retry-1", runId: "retry-2", failureCategory: "session_interruption", reason: "Again", occurredAt, actor: "director" }), "TASK_RECOVERY_LINEAGE_EXISTS");
  });

  it("resumes one recovery-exhausted task after an audited project repair without adding an attempt", () => {
    const waiting = workflowStateSchema.parse({
      ...state(), stage: "greetings_authoring", revision: 59,
      tasks: [{
        id: "recover-greetings-1", kind: "create-greetings", status: "needs_user_decision", assigned_agent: "greetings-creator",
        capabilities: ["task.execute", "greetings.propose"], input_artifacts: [{ id: "blueprint", revision: `sha256:${"a".repeat(64)}` }],
        output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 1,
        failure_summary: "Project invalid", failure: { category: "temporary_unavailable", summary: "Project invalid", failed_at: occurredAt, failed_by: "greetings-creator", attempt: 1 },
        extensions: { stage: "greetings_authoring", recovery_of: "create-greetings", recovery_generation: 1, recovery_exhausted: true },
      }],
    });
    const resumed = resumeTaskAfterRepair({ state: waiting, taskId: "recover-greetings-1", runId: "project-fixed-1", reason: "Removed invalid stray YAML", occurredAt, actor: "director" });
    expect(resumed).toMatchObject({ revision: 60 });
    expect(resumed.tasks[0]).toMatchObject({ status: "pending", attempt: 1, max_attempts: 1, resume_without_attempt: true, extensions: { repair_resume_count: 1 } });
    expect(resumed.tasks[0]?.failure).toBeUndefined();
    expect(resumed.decisions.at(-1)).toMatchObject({ id: "task-repair-resume-project-fixed-1", kind: "task.repair_resumed", extensions: { task_id: "recover-greetings-1", prior_failure_category: "temporary_unavailable" } });
    expectWorkflowError(() => resumeTaskAfterRepair({ state: resumed, taskId: "recover-greetings-1", runId: "again", reason: "Again", occurredAt, actor: "director" }), "TASK_REPAIR_RESUME_TARGET_INVALID");
    expectWorkflowError(() => resumeTaskAfterRepair({ state: waiting, taskId: "recover-greetings-1", runId: "denied", reason: "Denied", occurredAt, actor: "greetings-creator" }), "TASK_REPAIR_RESUME_DENIED");
  });

  it("retries a typed failed Character Review through the generic primitive", () => {
    const failed = workflowStateSchema.parse({
      ...state(), stage: "semantic_review", revision: 12,
      artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }],
      tasks: [{
        id: "review-characters", kind: "review-character", status: "failed", assigned_agent: "character-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [{ id: "blueprint", revision: `sha256:${"a".repeat(64)}` }],
        output_contract: "review-report@1", dependencies: [], attempt: 3, max_attempts: 3,
        failure_summary: "Context was truncated", failure: { category: "context_limit", summary: "Context was truncated", failed_at: occurredAt, failed_by: "character-critic", attempt: 3 }, extensions: { stage: "semantic_review" },
      }],
    });
    const retried = beginCharacterReviewRetry({
      state: failed, runId: "context-1", reason: "Use artifact-scoped context", occurredAt, actor: "director",
    });
    expect(retried).toMatchObject({ stage: "semantic_review", revision: 13 });
    expect(retried.tasks[0]).toMatchObject({
      id: "review-characters", status: "superseded", attempt: 3, failure_summary: "Context was truncated",
    });
    expect(retried.tasks[1]).toMatchObject({
      id: "recover-context-1", status: "pending", attempt: 0, max_attempts: 1, assigned_agent: "character-critic",
    });
    expect(retried.decisions.at(-1)).toMatchObject({ kind: "task.recovery.requested" });
    expect(() => beginCharacterReviewRetry({
      state: retried, runId: "context-2", reason: "Blocked", occurredAt, actor: "director",
    })).toThrow(/active lease|not failed|lineage|沒有失敗/u);
    expectWorkflowError(() => beginCharacterReviewRetry({
      state: workflowStateSchema.parse({ ...failed, tasks: failed.tasks.map((task) => ({ ...task, failure: undefined })) }),
      runId: "legacy", reason: "Cannot infer", occurredAt, actor: "director",
    }), "TASK_RECOVERY_FAILURE_UNCLASSIFIED");
  });

  it("gates Character expansion before materializing only new-character and selected revision chains", () => {
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original",
      stages: ["intake", "blueprint", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review", "compile_preview", "publish_review", "published"],
      required_gates: ["blueprint", "content", "publish"], tasks: [],
    });
    const manifest = projectManifestSchema.parse({
      schema_version: 1, id: "runtime-demo", title: "Old", kind: "character_card", card: { name: "Old" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    });
    const current = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }],
      world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] },
    });
    const candidate = blueprintSchema.parse({
      ...current,
      characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival", relationship_summary: "Alice's rival" }],
      greetings: { enabled: true, character_ids: ["alice", "beth"] },
      relationships: { enabled: true, character_ids: ["alice", "beth"] },
      approved_revision: 7,
    });
    const appearanceId = "author-characters-alice-zhuji-01-appearance.yaml";
    const revision = (letter: string) => `sha256:${letter.repeat(64)}` as const;
    const late = workflowStateSchema.parse({
      ...state(), stage: "published", revision: 20,
      gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ],
      artifacts: [
        { id: appearanceId, status: "draft", revision: revision("a"), updated_at: occurredAt, extensions: {} },
        { id: "preview-old", status: "reviewed", revision: revision("b"), updated_at: occurredAt, extensions: {} },
      ],
      tasks: [{
        id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
        attempt: 1, max_attempts: 3, result: { id: "review-v1", revision: revision("c") }, extensions: { stage: "semantic_review" },
      }],
    });
    const placeholders: Array<{ id: string; revision: `sha256:${string}`; contract?: string }> = [
      "author-characters-beth-character.yaml",
      "author-characters-beth-palette-01-basic-information.yaml",
      "author-characters-beth-palette-02-personality-palette.yaml",
      "author-characters-beth-palette-03-tri-faceted.yaml",
      "author-characters-beth-palette-04-secondary-interpretation.yaml",
    ].map((id, index) => ({ id, revision: revision(String(index + 1)) }));
    placeholders.push({ id: "author-relationships.yaml", revision: revision("6"), contract: "relationships@1" });
    const begun = beginCharacterExpansion({
      state: late, manifest, currentBlueprint: current, candidateBlueprint: candidate,
      newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival", relationship_summary: "Alice's rival" }],
      affectedArtifactIds: [appearanceId], reviseWorld: false, runId: "expand-1", reason: "Add Beth",
      occurredAt, actor: "director", blueprintRevision: revision("d"), placeholderArtifacts: placeholders,
    });
    expect(begun).toMatchObject({ stage: "blueprint", revision: 21, extensions: { character_expansion: { run_id: "expand-1", revise_world: false } } });
    expect(begun.tasks).toHaveLength(1);
    expect(begun.tasks.some((task) => task.status === "pending")).toBe(false);
    expect(begun.artifacts.find((item) => item.id === "preview-old")?.status).toBe("stale");
    expect(begun.gates.map((gate) => [gate.id, gate.status])).toEqual([
      ["facts", "not_required"], ["blueprint", "pending"], ["content", "pending"], ["publish", "pending"],
    ]);
    const approved = workflowStateSchema.parse({
      ...begun,
      gates: begun.gates.map((gate) => gate.id === "blueprint"
        ? { ...gate, status: "approved", input_revisions: [{ id: "blueprint", revision: revision("d") }] }
        : gate),
    });
    const unsafe = workflowStateSchema.parse({
      ...approved,
      extensions: {
        ...approved.extensions,
        character_expansion: {
          ...(approved.extensions.character_expansion as Record<string, unknown>),
          affected_artifact_ids: [],
        },
      },
    });
    expectWorkflowError(
      () => advanceConfiguredWorkflow({ state: unsafe, definition, blueprint: blueprintSchema.parse({ ...candidate, approved_revision: undefined }), projectKind: "character_card" }),
      "CHARACTER_EXPANSION_RELATIONSHIPS_DEPENDENCY_MISSING",
    );
    const authoring = advanceConfiguredWorkflow({ state: approved, definition, blueprint: blueprintSchema.parse({ ...candidate, approved_revision: undefined }), projectKind: "character_card" });
    const expansionTasks = authoring.tasks.filter((task) => task.extensions.expansion_run_id === "expand-1");
    expect(expansionTasks.map((task) => task.id)).toEqual([
      "revise-alice-appearance-expand-1",
      "create-beth-character-expand-1",
      "create-beth-basic_information-expand-1",
      "create-beth-personality_palette-expand-1",
      "create-beth-tri_faceted-expand-1",
      "create-beth-secondary_interpretation-expand-1",
      "create-relationships-expand-1",
    ]);
    expect(expansionTasks.slice(2, -1).every((task, index) => task.dependencies[0] === expansionTasks[index + 1]?.id)).toBe(true);
    expect(expansionTasks.at(-1)?.dependencies).toEqual([
      "revise-alice-appearance-expand-1",
      "create-beth-secondary_interpretation-expand-1",
    ]);
    expect(expansionTasks.some((task) => task.id.includes("alice-inner_nature"))).toBe(false);
    const completed = workflowStateSchema.parse({ ...authoring, tasks: authoring.tasks.map((task) => task.extensions.expansion_run_id === "expand-1" ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision: revision("e") } } : task) });
    const reviewing = advanceConfiguredWorkflow({ state: completed, definition, blueprint: candidate, projectKind: "character_card" });
    expect(reviewing.tasks.at(-1)?.id).toBe("review-characters-expand-1");
    for (const placeholder of placeholders) {
      expect(reviewing.tasks.at(-1)?.input_artifacts.some((item) => item.id === placeholder.id && item.revision === placeholder.revision)).toBe(true);
    }
    expect(reviewing.tasks.at(-1)?.input_artifacts).toContainEqual({
      id: "author-relationships.yaml",
      revision: revision("6"),
      contract: "relationships@1",
    });
    const reviewed = workflowStateSchema.parse({ ...reviewing, tasks: reviewing.tasks.map((task) => task.id === "review-characters-expand-1" ? { ...task, status: "completed", result: { id: "review-expand-1-result", revision: revision("f") } } : task) });
    const greetings = advanceConfiguredWorkflow({ state: reviewed, definition, blueprint: candidate, projectKind: "character_card" });
    expect(greetings).toMatchObject({ stage: "greetings_authoring" });
    expect(greetings.tasks.at(-1)?.id).toBe("revise-greetings-expand-1");
    const greetingsCompleted = workflowStateSchema.parse({ ...greetings, tasks: greetings.tasks.map((task) => task.id === "revise-greetings-expand-1" ? { ...task, status: "completed", result: { id: "greetings-expand-1-result", revision: revision("9") } } : task) });
    const greetingsReview = advanceConfiguredWorkflow({ state: greetingsCompleted, definition, blueprint: candidate, projectKind: "character_card" });
    expect(greetingsReview.tasks.at(-1)?.id).toBe("review-greetings-expand-1");
  });

  it("rejects unsafe Character expansion candidates and routes requested world revision after Character Review", () => {
    const manifest = projectManifestSchema.parse({ schema_version: 1, id: "runtime-demo", title: "Old", kind: "character_card", card: { name: "Old" }, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }] });
    const current = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Card", characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }], world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] } });
    const candidate = blueprintSchema.parse({ ...current, characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }], world: { enabled: true, authoring_timing: "after_characters", categories: [] }, greetings: { enabled: true, character_ids: ["alice", "beth"] } });
    const revision = `sha256:${"a".repeat(64)}`;
    const late = workflowStateSchema.parse({ ...state(), stage: "published", tasks: [{ id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic", capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision }, extensions: {} }] });
    const call = (overrides: Record<string, unknown> = {}) => beginCharacterExpansion({ state: late, manifest, currentBlueprint: current, candidateBlueprint: candidate, newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }], affectedArtifactIds: [], reviseWorld: true, runId: "expand-world", reason: "Add Beth", occurredAt, actor: "director", blueprintRevision: revision, placeholderArtifacts: [], ...overrides });
    expect(() => call({ state: workflowStateSchema.parse({ ...late, stage: "authoring" }) })).toThrow(/stage/u);
    expect(() => call({ state: workflowStateSchema.parse({ ...late, tasks: [...late.tasks, { id: "active", kind: "x", status: "pending", assigned_agent: "director", capabilities: [], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: {} }] }) })).toThrow(/active task/u);
    expect(() => call({ newCharacters: [{ id: "alice", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }] })).toThrow(/衝突/u);
    expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, project_id: "other" }) })).toThrow(/project_id/u);
    expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, characters: [{ ...candidate.characters[0]!, display_name: "Changed" }, candidate.characters[1]!] }) })).toThrow(/identity/u);
    expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, characters: [candidate.characters[1]!] }) })).toThrow(/完整保留/u);
    expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, characters: [{ ...candidate.characters[0]!, mode: "palette" }, candidate.characters[1]!] }) })).toThrow(/identity/u);
    expect(() => call({ newCharacters: [
      { id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" },
      { id: "beth", display_name: "Beth 2", mode: "zhuji", role: "supporting", core_concept: "Other" },
    ] })).toThrow(/重複/u);
    expect(() => call({ affectedArtifactIds: ["author-characters-alice-zhuji-01-appearance.yaml"] })).toThrow(/exact revision/u);
    const worldbook = projectManifestSchema.parse({ schema_version: 1, id: "runtime-demo", title: "World", kind: "worldbook", card: { name: "World" }, characters: [] });
    expect(() => call({ manifest: worldbook })).toThrow(/character_card/u);
    expect(() => call({ reviseWorld: false })).toThrow(/world/u);

    const begun = call();
    const definition = workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: ["intake", "blueprint", "authoring", "semantic_review", "post_world_authoring", "post_world_review", "greetings_authoring", "content_review", "compile_preview", "publish_review", "published"], required_gates: ["blueprint", "content", "publish"], tasks: [] });
    const approved = workflowStateSchema.parse({ ...begun, gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision }], extensions: {} }] });
    const authoring = advanceConfiguredWorkflow({ state: approved, definition, blueprint: candidate, projectKind: "character_card" });
    const authored = workflowStateSchema.parse({ ...authoring, tasks: authoring.tasks.map((task) => task.extensions.expansion_run_id === "expand-world" ? { ...task, status: "completed", result: { id: `${task.id}-result`, revision } } : task) });
    const reviewing = advanceConfiguredWorkflow({ state: authored, definition, blueprint: candidate, projectKind: "character_card" });
    const reviewed = workflowStateSchema.parse({ ...reviewing, tasks: reviewing.tasks.map((task) => task.id === "review-characters-expand-world" ? { ...task, status: "completed", result: { id: "review-expand-world-result", revision } } : task) });
    const worldAuthoring = advanceConfiguredWorkflow({ state: reviewed, definition, blueprint: candidate, projectKind: "character_card" });
    expect(worldAuthoring).toMatchObject({ stage: "post_world_authoring" });
    expect(worldAuthoring.tasks.at(-1)?.id).toBe("create-world-expand-world");
    const worldAuthored = workflowStateSchema.parse({ ...worldAuthoring, tasks: worldAuthoring.tasks.map((task) => task.id === "create-world-expand-world" ? { ...task, status: "completed", result: { id: "world-expand-world-result", revision } } : task) });
    const worldReview = advanceConfiguredWorkflow({ state: worldAuthored, definition, blueprint: candidate, projectKind: "character_card" });
    expect(worldReview.tasks.at(-1)?.id).toBe("review-world-expand-world");
  });

  it("routes plugin stages from immutable revision intent instead of the initial Blueprint", () => {
    const implementation = {
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      asset_manifest_id: "sillytavern-assets",
      asset_manifest_revision: `sha256:${"b".repeat(64)}`,
      asset_manifest_hash: `sha256:${"c".repeat(64)}`,
    };
    const intent = pluginRevisionIntentSchema.parse({
      schema_version: 1,
      project_id: "runtime-demo",
      revision: `sha256:${"d".repeat(64)}`,
      project_kind: "character_card",
      base_selection_revision: "absent",
      selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }],
      dependency_closure: ["official.ejs", "official.mvu-zod"],
      implementation_pins: [
        { plugin_id: "official.ejs", implementation },
        { plugin_id: "official.mvu-zod", implementation },
      ],
    });
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1",
      entry_kind: "original",
      stages: ["greetings_authoring", "plugin_mvu_authoring", "plugin_mvu_review", "plugin_ejs_authoring", "plugin_ejs_review", "content_review"],
      required_gates: ["content"],
      tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1,
      project_id: "runtime-demo",
      entry_kind: "original",
      purpose: "No initial plugin selection",
      characters: [],
      world: { enabled: true, categories: [] },
      greetings: { enabled: false, character_ids: [] },
      plugins: [],
    });
    const ready = workflowStateSchema.parse({
      ...state(),
      stage: "greetings_authoring",
      revision: 5,
      extensions: { plugin_revision_intent: intent },
    });
    const completeCurrentStage = (current: WorkflowState) => workflowStateSchema.parse({
      ...current,
      tasks: current.tasks.map((task) => task.extensions.stage === current.stage ? { ...task, status: "completed" as const } : task),
    });

    const mvuAuthoring = advanceConfiguredWorkflow({ state: ready, definition, blueprint });
    expect(mvuAuthoring.stage).toBe("plugin_mvu_authoring");
    expect(mvuAuthoring.tasks.at(-1)).toMatchObject({ id: "create-official-mvu-zod", dependencies: [] });
    const mvuReview = advanceConfiguredWorkflow({ state: completeCurrentStage(mvuAuthoring), definition, blueprint });
    expect(mvuReview.stage).toBe("plugin_mvu_review");
    expect(mvuReview.tasks.at(-1)).toMatchObject({
      id: "review-official-mvu-zod",
      dependencies: ["create-official-mvu-zod"],
      output_contract: "review-report@1",
      extensions: { requires_immutable_proposal: true },
    });
    const ejsAuthoring = advanceConfiguredWorkflow({ state: completeCurrentStage(mvuReview), definition, blueprint });
    expect(ejsAuthoring.stage).toBe("plugin_ejs_authoring");
    expect(ejsAuthoring.tasks.at(-1)).toMatchObject({ id: "create-official-ejs", dependencies: ["review-official-mvu-zod"] });
  });

  it("materializes the complete MVU to EJS to HTML dependency chain", () => {
    const implementation = {
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      asset_manifest_id: "sillytavern-assets",
      asset_manifest_revision: `sha256:${"b".repeat(64)}`,
      asset_manifest_hash: `sha256:${"c".repeat(64)}`,
    };
    const intent = pluginRevisionIntentSchema.parse({
      schema_version: 1,
      project_id: "runtime-demo",
      revision: `sha256:${"e".repeat(64)}`,
      project_kind: "character_card",
      base_selection_revision: "absent",
      selections: [
        { plugin_id: "official.ejs", capabilities: ["ejs"] },
        { plugin_id: "official.html", capabilities: ["html.status_bar"] },
      ],
      dependency_closure: ["official.ejs", "official.html", "official.mvu-zod"],
      implementation_pins: [
        { plugin_id: "official.ejs", implementation },
        { plugin_id: "official.html", implementation },
        { plugin_id: "official.mvu-zod", implementation },
      ],
    });
    const definition = workflowDefinitionSchema.parse({
      id: "original-v1",
      entry_kind: "original",
      stages: [
        "intake",
        "plugin_mvu_authoring",
        "plugin_mvu_review",
        "plugin_ejs_authoring",
        "plugin_ejs_review",
        "plugin_html_authoring",
        "plugin_html_review",
      ],
      required_gates: [],
      tasks: [],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1,
      project_id: "runtime-demo",
      entry_kind: "original",
      purpose: "Plugin dependency chain",
      characters: [],
      world: { enabled: true, categories: [] },
      greetings: { enabled: false, character_ids: [] },
      plugins: [],
    });
    let current = workflowStateSchema.parse({
      ...state(),
      stage: "intake",
      revision: 0,
      extensions: { plugin_revision_intent: intent },
    });
    const stages = [
      ["plugin_mvu_authoring", "create-official-mvu-zod", [], "plugin-proposal@1"],
      ["plugin_mvu_review", "review-official-mvu-zod", ["create-official-mvu-zod"], "review-report@1"],
      ["plugin_ejs_authoring", "create-official-ejs", ["review-official-mvu-zod"], "plugin-proposal@1"],
      ["plugin_ejs_review", "review-official-ejs", ["create-official-ejs"], "review-report@1"],
      ["plugin_html_authoring", "create-official-html", ["review-official-ejs"], "plugin-proposal@1"],
      ["plugin_html_review", "review-official-html", ["create-official-html"], "review-report@1"],
    ] as const;
    for (const [stage, taskId, dependencies, outputContract] of stages) {
      current = advanceConfiguredWorkflow({ state: current, definition, blueprint });
      expect(current.stage).toBe(stage);
      expect(current.tasks.at(-1)).toMatchObject({ id: taskId, dependencies, output_contract: outputContract });
      current = workflowStateSchema.parse({
        ...current,
        tasks: current.tasks.map((task) => task.extensions.stage === current.stage
          ? { ...task, status: "completed" as const, result: { id: `${task.id}-result`, revision: `sha256:${"f".repeat(64)}`, contract: task.output_contract } }
          : task),
      });
    }
  });
});
