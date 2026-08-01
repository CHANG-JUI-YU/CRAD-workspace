import { blueprintSchema, pluginRevisionIntentSchema, projectManifestSchema, workflowDefinitionSchema, workflowStateSchema, type WorkflowState } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { advanceConfiguredWorkflow, beginCharacterExpansion, updateCharacterExpansionBlueprint, beginCharacterRevision, beginCharacterReviewRetry, beginFactsRecuration, beginGreetingsRevision, beginSourceProcessingRepair, beginTaskRecovery, beginScopedContentRevision, beginWorldAuthoring, beginWorldRevision, completeSourceProcessingTask, resumeTaskAfterRepair, startConfiguredWorkflow, materializePluginTasks, WorkflowError } from "../src/index.js";

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
    expect(() => call({ state: workflowStateSchema.parse({ ...late, tasks: [...late.tasks, { id: "active", kind: "x", status: "pending", assigned_agent: "director", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: {} }] }) })).toThrow(/active task/u);
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
  it("covers revision dispatch guards and stale target branches", () => {
    const blueprint = blueprintSchema.parse({
      schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Revision guards",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
      world: { enabled: true, categories: ["geography"] },
      greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    });
    const reviewCharacter = { id: "review-character", kind: "review-character", status: "completed", assigned_agent: "character-critic", capabilities: [], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision: `sha256:${"a".repeat(64)}` }, extensions: { stage: "semantic_review" } };
    const reviewWorld = { id: "review-world", kind: "review-world", status: "completed", assigned_agent: "world-lore-critic", capabilities: [], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "world-review", revision: `sha256:${"b".repeat(64)}` }, extensions: { stage: "post_world_review" } };
    const at = (stage: string, extras: Record<string, unknown> = {}) => workflowStateSchema.parse({ ...state(), stage, tasks: [], artifacts: [], ...extras });
    const common = { runId: "guards-1", reason: "guard test", occurredAt, actor: "director" };
    expectWorkflowError(() => beginCharacterRevision({ state: at("intake"), blueprint, ...common, artifactIds: [] }), "CHARACTER_REVISION_STAGE_DENIED");
    expectWorkflowError(() => beginCharacterRevision({ state: at("semantic_review", { tasks: [{ ...reviewCharacter, status: "pending" }] }), blueprint, ...common, artifactIds: ["x"] }), "CHARACTER_REVISION_TASK_ACTIVE");
    expectWorkflowError(() => beginCharacterRevision({ state: at("semantic_review"), blueprint, ...common, artifactIds: ["x"] }), "CHARACTER_REVISION_REVIEW_REQUIRED");
    const reviewed = at("semantic_review", { tasks: [reviewCharacter] });
    expectWorkflowError(() => beginCharacterRevision({ state: reviewed, blueprint, ...common, artifactIds: [] }), "CHARACTER_REVISION_TARGET_INVALID");
    expectWorkflowError(() => beginCharacterRevision({ state: reviewed, blueprint, ...common, artifactIds: ["unknown"] }), "CHARACTER_REVISION_TARGET_INVALID");
    expectWorkflowError(() => beginCharacterRevision({ state: reviewed, blueprint, ...common, artifactIds: ["author-characters-alice-zhuji-01-appearance.yaml"] }), "CHARACTER_REVISION_TARGET_STALE");
    const greetingBase = at("content_review");
    expectWorkflowError(() => beginGreetingsRevision({ state: at("intake"), ...common }), "GREETINGS_REVISION_STAGE_DENIED");
    expectWorkflowError(() => beginGreetingsRevision({ state: at("content_review", { tasks: [{ ...reviewCharacter, status: "pending" }] }), ...common }), "GREETINGS_REVISION_TASK_ACTIVE");
    const greetingStarted = beginGreetingsRevision({ state: greetingBase, ...common });
    expect(greetingStarted.stage).toBe("greetings_authoring");
    expectWorkflowError(() => beginGreetingsRevision({ state: greetingStarted, ...common }), "GREETINGS_REVISION_STAGE_DENIED");
    expectWorkflowError(() => beginGreetingsRevision({ state: at("content_review", { tasks: [{ ...reviewCharacter, id: "revise-greetings-guards-1", status: "completed" }] }), ...common }), "GREETINGS_REVISION_RUN_EXISTS");
    const worldBase = at("post_world_review", { tasks: [reviewWorld] });
    expectWorkflowError(() => beginWorldRevision({ state: at("intake"), blueprint, worldEntries: [{ id: "entry", category: "geography", title: "Entry", content: "Text" }] as never, ...common, artifactIds: ["x"] }), "WORLD_REVISION_STAGE_DENIED");
    expectWorkflowError(() => beginWorldRevision({ state: worldBase, blueprint, worldEntries: [], ...common, artifactIds: ["x"] }), "WORLD_REVISION_TARGET_INVALID");
    expectWorkflowError(() => beginWorldRevision({ state: worldBase, blueprint, worldEntries: [{ id: "entry", category: "geography", title: "Entry", content: "Text" }] as never, ...common, artifactIds: [] }), "WORLD_REVISION_TARGET_INVALID");
    expectWorkflowError(() => beginScopedContentRevision({ state: greetingBase, blueprint, worldEntries: [], scope: "greetings", ...common, artifactIds: ["unexpected"] }), "CONTENT_REVISION_TARGET_INVALID");
    expectWorkflowError(() => beginWorldAuthoring({ state: at("content_review"), blueprint, world: blueprint.world, runId: "world-1", occurredAt }), "WORLD_AUTHORING_PROJECT_NOT_PUBLISHED");
    expectWorkflowError(() => beginWorldAuthoring({ state: at("published", { tasks: [{ ...reviewWorld, status: "pending" }] }), blueprint, world: blueprint.world, runId: "world-1", occurredAt }), "WORLD_AUTHORING_TASK_ACTIVE");
    expectWorkflowError(() => beginWorldAuthoring({ state: at("published"), blueprint, world: { enabled: false }, runId: "world-1", occurredAt }), "WORLD_AUTHORING_DELETE_FORBIDDEN");
  });

  it("materializes and updates a V2 Character expansion candidate", () => {
    const manifest = projectManifestSchema.parse({ schema_version: 1, id: "runtime-demo", title: "Old", kind: "character_card", card: { name: "Old" }, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }] });
    const current = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Card", characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }], world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] } });
    const candidate = blueprintSchema.parse({ ...current, characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }], world: { enabled: true, authoring_timing: "after_characters", categories: [] }, greetings: { enabled: true, character_ids: ["alice", "beth"] } });
    const revision = `sha256:${"a".repeat(64)}`;
    const late = workflowStateSchema.parse({ ...state(), stage: "published", tasks: [{ id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic", capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision }, extensions: {} }] });
    const begun = beginCharacterExpansion({
      state: late, manifest, currentBlueprint: current, candidateBlueprint: candidate,
      newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }],
      affectedArtifactIds: [], reviseWorld: true, runId: "expand-v2", reason: "Add Beth", occurredAt, actor: "director", blueprintRevision: revision,
      placeholderArtifacts: [], candidate: { artifactId: "blueprint-candidate", path: "blueprints/expansion.yaml", revision, version: 1, baseProjectRevision: revision, baseBlueprintRevision: revision },
    });
    expect(begun.extensions.character_expansion).toMatchObject({ schema_version: 2, candidate_artifact_id: "blueprint-candidate", materialized: false });
    expect(begun.artifacts).toContainEqual(expect.objectContaining({ id: "blueprint-candidate", status: "draft" }));
    const updatedRevision = `sha256:${"b".repeat(64)}`;
    const updated = updateCharacterExpansionBlueprint({
      state: begun, manifest, currentBlueprint: candidate, candidateBlueprint: candidate,
      runId: "expand-v2", reason: "Revise expansion candidate", occurredAt, actor: "director", blueprintRevision: revision,
      candidate: { artifactId: "blueprint-candidate-v2", path: "blueprints/expansion-v2.yaml", revision: updatedRevision, version: 2 },
    });
    expect(updated.revision).toBe(begun.revision + 1);
    expect(updated.artifacts).toContainEqual(expect.objectContaining({ id: "blueprint-candidate", status: "stale" }));
    expect(updated.artifacts).toContainEqual(expect.objectContaining({ id: "blueprint-candidate-v2", revision: updatedRevision, status: "draft" }));
    expect(updated.decisions.at(-1)).toMatchObject({ kind: "character.expansion.blueprint_updated", summary: "Revise expansion candidate" });
  });

  it("projects plugin task dependencies from selections and immutable intent", () => {
    const blueprint = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Plugins", characters: [], world: { enabled: true, categories: [] }, greetings: { enabled: false, character_ids: [] }, project_kind: "character_card", plugins: [
      { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
      { plugin_id: "official.ejs", capabilities: ["ejs"] },
      { plugin_id: "official.html", capabilities: ["html.status_bar"] },
    ] });
    expect(materializePluginTasks("plugin_mvu_authoring", blueprintSchema.parse({ ...blueprint, plugins: [] }), [])).toEqual([]);
    expect(materializePluginTasks("plugin_ejs_authoring", blueprint, [])).toMatchObject([{ id: "create-official-ejs", dependencies: ["review-official-mvu-zod"] }]);
    expect(materializePluginTasks("plugin_html_authoring", blueprint, [])).toMatchObject([{ id: "create-official-html", dependencies: ["review-official-ejs"] }]);
    const htmlOnly = blueprintSchema.parse({ ...blueprint, plugins: [{ plugin_id: "official.html", capabilities: ["html.status_bar"] }] });
    expect(materializePluginTasks("plugin_html_authoring", htmlOnly, [])).toMatchObject([{ dependencies: ["review-official-mvu-zod"] }]);
    expect(materializePluginTasks("plugin_mvu_review", blueprint, [])).toMatchObject([{ id: "review-official-mvu-zod", dependencies: ["create-official-mvu-zod"] }]);
    expect(materializePluginTasks("plugin_ejs_review", blueprint, [])).toMatchObject([{ id: "review-official-ejs", dependencies: ["create-official-ejs"] }]);
    expect(materializePluginTasks("plugin_html_review", blueprint, [])).toMatchObject([{ id: "review-official-html", dependencies: ["create-official-html"] }]);
    const noIntent = workflowStateSchema.parse({ ...state(), extensions: { plugin_revision_intent: { malformed: true } } });
    expect(materializePluginTasks("plugin_ejs_authoring", blueprint, [], noIntent)).toMatchObject([{ id: "create-official-ejs" }]);
  });

  it("fails closed for workflow advance boundary states", () => {
    const definition = workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: ["blueprint", "authoring"], required_gates: ["blueprint"], tasks: [] });
    const blueprint = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Boundary", characters: [], world: { enabled: true, categories: [] }, greetings: { enabled: false, character_ids: [] } });
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), outcome: { status: "closed", kind: "cancelled", closed_at: occurredAt, decision_id: "cancelled" } }), definition, blueprint }), "WORKFLOW_CLOSED");
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: state(), definition: workflowDefinitionSchema.parse({ ...definition, id: "different" }), blueprint }), "WORKFLOW_DEFINITION_MISMATCH");
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: state("mode_conversion"), definition: workflowDefinitionSchema.parse({ ...definition, id: "mode-conversion-v1", entry_kind: "mode_conversion" }), blueprint }), "WORKFLOW_ENTRY_NOT_IMPLEMENTED");
    const sourceProcessing = workflowStateSchema.parse({ ...state("source_adaptation"), stage: "source_processing" });
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: sourceProcessing, definition: workflowDefinitionSchema.parse({ id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["source_processing", "blueprint"], required_gates: ["facts"], tasks: [] }), blueprint }), "WORKFLOW_DEFINITION_MISMATCH");
    const factsReview = workflowStateSchema.parse({ ...state("source_adaptation"), stage: "facts_review", gates: [{ id: "facts", status: "pending", input_revisions: [], extensions: {} }] });
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: factsReview, definition: workflowDefinitionSchema.parse({ id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["facts_review", "blueprint"], required_gates: ["facts"], tasks: [] }), blueprint }), "WORKFLOW_GATE_BLOCKED");
    const authoredBlueprint = blueprintSchema.parse({ ...blueprint, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }] });
    const blueprintState = workflowStateSchema.parse({ ...state(), stage: "blueprint", gates: [{ id: "blueprint", status: "pending", input_revisions: [], extensions: {} }], artifacts: [{ id: "blueprint", status: "draft", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }] });
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: blueprintState, definition, blueprint: authoredBlueprint }), "WORKFLOW_GATE_BLOCKED");
    const terminal = workflowStateSchema.parse({ ...state(), stage: "blueprint", gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }], artifacts: [{ id: "blueprint", status: "approved", revision: `sha256:${"a".repeat(64)}`, updated_at: occurredAt, extensions: {} }] });
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: terminal, definition: workflowDefinitionSchema.parse({ ...definition, stages: ["blueprint"] }), blueprint }), "WORKFLOW_ALREADY_PUBLISHED");
    expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...terminal, artifacts: [] }), definition, blueprint: authoredBlueprint }), "WORKFLOW_ARTIFACT_MISSING");
  });
});

it("covers remaining Character expansion candidate and run guards", () => {
  const manifest = projectManifestSchema.parse({ schema_version: 1, id: "runtime-demo", title: "Old", kind: "character_card", card: { name: "Old" }, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }] });
  const current = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Card", characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Leader" }], world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] } });
  const candidate = blueprintSchema.parse({ ...current, characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival", relationship_summary: "Rival" }], greetings: { enabled: true, character_ids: ["alice", "beth"] } });
  const revision = `sha256:${"a".repeat(64)}`;
  const reviewState = workflowStateSchema.parse({ ...state(), stage: "published", tasks: [{ id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic", capabilities: ["task.execute"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 1, result: { id: "review", revision }, extensions: {} }] });
  const call = (overrides: Record<string, unknown> = {}) => beginCharacterExpansion({ state: reviewState, manifest, currentBlueprint: current, candidateBlueprint: candidate, newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival", relationship_summary: "Rival" }], affectedArtifactIds: [], reviseWorld: true, runId: "matrix", reason: "Add Beth", occurredAt, actor: "director", blueprintRevision: revision, placeholderArtifacts: [], ...overrides });
  expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, collaboration_mode: "assisted" }) })).toThrow(/collaboration_mode/u);
  expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, greetings: { enabled: false, character_ids: ["alice", "beth"] } }) })).toThrow(/greetings/u);
  expect(() => call({ candidateBlueprint: blueprintSchema.parse({ ...candidate, greetings: { enabled: true, character_ids: ["alice"] } }) })).toThrow(/roster/u);
  expect(() => call({ newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Different", relationship_summary: "Rival" }] })).toThrow(/request/u);
  expect(() => call({ affectedArtifactIds: ["unknown-artifact"] })).toThrow(/exact artifact/u);
  expect(() => call({ state: workflowStateSchema.parse({ ...reviewState, decisions: [{ id: "character-expansion-matrix", kind: "character.expansion.requested", actor: "director", decided_at: occurredAt, input_revisions: [], summary: "old", extensions: {} }] }) })).toThrow(/run/u);
  const begun = call();
  expect(() => call({ state: workflowStateSchema.parse({ ...reviewState, stage: "content_review", extensions: begun.extensions }) })).toThrow(/active character expansion/u);
  expect(() => updateCharacterExpansionBlueprint({ state: reviewState, manifest, currentBlueprint: current, candidateBlueprint: candidate, runId: "matrix", reason: "update", occurredAt, actor: "director", blueprintRevision: revision })).toThrow(/blueprint stage/u);
  expect(() => updateCharacterExpansionBlueprint({ state: workflowStateSchema.parse({ ...begun, extensions: {} }), manifest, currentBlueprint: current, candidateBlueprint: candidate, runId: "matrix", reason: "update", occurredAt, actor: "director", blueprintRevision: revision })).toThrow(/active expansion/u);
  expect(() => updateCharacterExpansionBlueprint({ state: begun, manifest, currentBlueprint: current, candidateBlueprint: candidate, runId: "wrong", reason: "update", occurredAt, actor: "director", blueprintRevision: revision })).toThrow(/active expansion/u);
});
it("covers configured workflow boundary guards and stage filtering", () => {
  const revA = "sha256:" + "a".repeat(64);
  const revB = "sha256:" + "b".repeat(64);
  const revC = "sha256:" + "c".repeat(64);
  const blueprint = blueprintSchema.parse({
    schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "guard matrix",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }], world: { enabled: true }, greetings: { enabled: false, character_ids: [] }, plugins: [],
  });
  const definition = workflowDefinitionSchema.parse({
    id: "original-v1", entry_kind: "original", stages: ["intake", "blueprint", "authoring"],
    required_gates: ["blueprint"],
    tasks: [{ id: "create-blueprint", kind: "create-blueprint", agent_kind: "director", stage: "blueprint", capabilities: ["blueprint.propose"], output_contract: "proposal@1", max_attempts: 1 }],
  });
  expect(startConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), stage: "blueprint" }), definition, occurredAt })).toMatchObject({ stage: "blueprint" });
  expectWorkflowError(() => startConfiguredWorkflow({ state: state(), definition: workflowDefinitionSchema.parse({ ...definition, id: "other-v1" }), occurredAt }), "WORKFLOW_DEFINITION_MISMATCH");
  expectWorkflowError(() => advanceConfiguredWorkflow({
    state: workflowStateSchema.parse({ ...state(), outcome: { status: "closed", kind: "cancelled", closed_at: occurredAt, decision_id: "cancelled" } }),
    definition, blueprint,
  }), "WORKFLOW_CLOSED");
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: state("mode_conversion"), definition: workflowDefinitionSchema.parse({ ...definition, id: "mode-conversion-v1", entry_kind: "mode_conversion" }), blueprint }), "WORKFLOW_ENTRY_NOT_IMPLEMENTED");
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), workflow_definition_id: "other-v1" }), definition, blueprint }), "WORKFLOW_DEFINITION_MISMATCH");

  const sourceDefinition = workflowDefinitionSchema.parse({
    id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["intake", "source_processing", "blueprint"],
    required_gates: ["facts"],
    tasks: [{ id: "curate-facts", kind: "curate-facts", agent_kind: "fact-curator", stage: "source_processing", capabilities: ["facts.propose"], output_contract: "proposal@1", max_attempts: 1 }],
  });
  const sourceStarted = startConfiguredWorkflow({
    state: state("source_adaptation"), definition: sourceDefinition,
    initialInputArtifacts: [{ id: "source", revision: revA }], occurredAt,
  });
  const sourceComplete = workflowStateSchema.parse({ ...sourceStarted, tasks: sourceStarted.tasks.map((task) => ({ ...task, status: "completed" as const, result: { id: "facts", revision: revB } })) });
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: sourceComplete, definition: sourceDefinition }), "WORKFLOW_DEFINITION_MISMATCH");
  const factsBlocked = workflowStateSchema.parse({
    ...state("source_adaptation"), workflow_definition_id: "source-adaptation-v1", stage: "facts_review",
    tasks: [{ id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 1, result: { id: "facts", revision: revB }, extensions: {} }],
    gates: [{ id: "facts", status: "pending", input_revisions: [], extensions: {} }],
  });
  const factsDefinition = workflowDefinitionSchema.parse({ ...sourceDefinition, stages: ["intake", "source_processing", "facts_review", "blueprint"] });
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: factsBlocked, definition: factsDefinition }), "WORKFLOW_GATE_BLOCKED");

  expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), stage: "blueprint" }), definition }), "WORKFLOW_ARTIFACT_MISSING");
  const blueprintState = workflowStateSchema.parse({
    ...state(), stage: "blueprint", revision: 2,
    gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
    artifacts: [{ id: "blueprint", status: "draft", revision: revC, updated_at: occurredAt, extensions: {} }],
    tasks: [],
  });
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: blueprintState, definition: workflowDefinitionSchema.parse({ ...definition, stages: ["blueprint", "published"] }), blueprint }), "WORKFLOW_PUBLISH_TOOL_REQUIRED");
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...blueprintState, gates: [] }), definition, blueprint }), "WORKFLOW_GATE_BLOCKED");
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...blueprintState, tasks: [{ id: "unfinished", kind: "create-blueprint", status: "pending", assigned_agent: "director", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 1, extensions: {} }] }), definition, blueprint }), "WORKFLOW_TASKS_INCOMPLETE");
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...blueprintState, stage: "compile_preview" }), definition, blueprint }), "WORKFLOW_ALREADY_PUBLISHED");
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...blueprintState, artifacts: [{ id: "blueprint", status: "stale", revision: revC, updated_at: occurredAt, extensions: {} }] }), definition, blueprint }), "WORKFLOW_ARTIFACT_MISSING");
});
it("covers recovery, completion idempotency, and world/greeting lifecycle guards", () => {
  const revision = "sha256:" + "a".repeat(64);
  const curate = workflowStateSchema.parse({
    ...state("source_adaptation"), stage: "source_processing",
    tasks: [{ id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator", capabilities: [], input_artifacts: [], output_contract: "facts-curation-summary@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "facts", revision, contract: "facts-curation-summary@1" }, extensions: {} }],
  });
  expect(completeSourceProcessingTask({ state: curate, taskId: "curate-facts", leaseId: "none", owner: "fact-curator", result: { id: "facts", revision, contract: "facts-curation-summary@1" } })).toBe(curate);
  expectWorkflowError(() => completeSourceProcessingTask({ state: curate, taskId: "missing", leaseId: "none", owner: "fact-curator", result: { id: "facts", revision, contract: "facts-curation-summary@1" } }), "CURATE_FACTS_TASK_NOT_FOUND");

  const failedTask = {
    id: "create-character", kind: "create-character", status: "failed" as const, assigned_agent: "zhuji-creator", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 3, max_attempts: 3,
    failure: { category: "provider_timeout" as const, summary: "timeout", failed_at: occurredAt, failed_by: "worker", attempt: 3 }, extensions: { stage: "authoring" },
  };
  const failedState = workflowStateSchema.parse({ ...state(), stage: "authoring", tasks: [failedTask] });
  expectWorkflowError(() => beginTaskRecovery({ state: failedState, taskId: "create-character", runId: "recover", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "worker" }), "TASK_RECOVERY_DENIED");
  expectWorkflowError(() => beginTaskRecovery({ state: failedState, taskId: "missing", runId: "recover", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "director" }), "TASK_RECOVERY_TARGET_NOT_FAILED");
  expectWorkflowError(() => beginTaskRecovery({ state: workflowStateSchema.parse({ ...failedState, tasks: [{ ...failedTask, attempt: 2 }] }), taskId: failedTask.id, runId: "recover", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "director" }), "TASK_RECOVERY_ATTEMPTS_NOT_EXHAUSTED");
  expectWorkflowError(() => beginTaskRecovery({ state: failedState, taskId: failedTask.id, runId: "recover", failureCategory: "semantic_failure", reason: "retry", occurredAt, actor: "director" }), "TASK_RECOVERY_FAILURE_NOT_RECOVERABLE");
  expectWorkflowError(() => beginTaskRecovery({ state: workflowStateSchema.parse({ ...failedState, entry_kind: "mode_conversion", workflow_definition_id: "mode-conversion-v1" }), taskId: failedTask.id, runId: "recover", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "director" }), "TASK_RECOVERY_STAGE_UNSUPPORTED");
  const dependent = { id: "review-character", kind: "review-character", status: "claimed" as const, assigned_agent: "character-critic", capabilities: [], input_artifacts: [], output_contract: "review-report@1", dependencies: [failedTask.id], attempt: 1, max_attempts: 3, lease: { id: "lease", owner: "critic", claimed_at: occurredAt, expires_at: "2099-01-01T00:00:00.000Z" }, extensions: { stage: "semantic_review" } };
  expectWorkflowError(() => beginTaskRecovery({ state: workflowStateSchema.parse({ ...failedState, tasks: [failedTask, dependent] }), taskId: failedTask.id, runId: "recover", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "director" }), "TASK_RECOVERY_ACTIVE_LEASE");
  const pendingDependent = { ...dependent, status: "pending" as const, lease: undefined };
  const recovered = beginTaskRecovery({ state: workflowStateSchema.parse({ ...failedState, tasks: [failedTask, pendingDependent] }), taskId: failedTask.id, runId: "recover", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "director" });
  expect(recovered.tasks.at(-1)).toMatchObject({ id: "recover-recover", extensions: { recovery_of: failedTask.id } });
  expect(recovered.tasks.find((task) => task.id === pendingDependent.id)?.dependencies).toEqual(["recover-recover"]);
  expectWorkflowError(() => beginTaskRecovery({ state: recovered, taskId: failedTask.id, runId: "recover-2", failureCategory: "provider_timeout", reason: "retry", occurredAt, actor: "director" }), "TASK_RECOVERY_TARGET_NOT_FAILED");

  const repairTarget = workflowStateSchema.parse({ ...state(), stage: "authoring", tasks: [{ ...failedTask, id: "recover-task", status: "needs_user_decision", failure: { category: "provider_timeout", summary: "timeout", failed_at: occurredAt, failed_by: "worker", attempt: 3 }, failure_summary: "needs repair", extensions: { stage: "authoring", recovery_exhausted: true, recovery_generation: 1, recovery_of: "create-character" } }] });
  expectWorkflowError(() => resumeTaskAfterRepair({ state: repairTarget, taskId: "recover-task", runId: "resume", reason: "fix", occurredAt, actor: "worker" }), "TASK_REPAIR_RESUME_DENIED");
  const resumed = resumeTaskAfterRepair({ state: repairTarget, taskId: "recover-task", runId: "resume", reason: "fix", occurredAt, actor: "director" });
  expect(resumed.tasks[0]).toMatchObject({ status: "pending", resume_without_attempt: true });
  expectWorkflowError(() => resumeTaskAfterRepair({ state: workflowStateSchema.parse({ ...repairTarget, tasks: [{ ...repairTarget.tasks[0]!, extensions: { ...repairTarget.tasks[0]!.extensions, repair_resume_count: 1 } }] }), taskId: "recover-task", runId: "resume-2", reason: "fix", occurredAt, actor: "director" }), "TASK_REPAIR_RESUME_EXHAUSTED");
  expectWorkflowError(() => resumeTaskAfterRepair({ state: workflowStateSchema.parse({ ...repairTarget, tasks: [{ ...repairTarget.tasks[0]!, clarifications: [{ id: "clarify", status: "pending", question: "q", reason: "r", uncertainty: "high", impact: "high", affected_modules: ["x"], options: [{ id: "a", label: "A", consequence: "A" }, { id: "b", label: "B", consequence: "B" }], requested_at: occurredAt }] }] }), taskId: "recover-task", runId: "resume-3", reason: "fix", occurredAt, actor: "director" }), "TASK_REPAIR_RESUME_CLARIFICATION_PENDING");

  const worldBlueprint = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "World", characters: [], world: { enabled: true, categories: [] }, greetings: { enabled: false, character_ids: [] } });
  const published = workflowStateSchema.parse({ ...state(), stage: "published", artifacts: [{ id: "preview-old", status: "reviewed", revision, updated_at: occurredAt, extensions: {} }] });
  const worldStarted = beginWorldAuthoring({ state: published, blueprint: worldBlueprint, world: worldBlueprint.world, runId: "world", occurredAt });
  expect(worldStarted.state.stage).toBe("authoring");
  expectWorkflowError(() => beginWorldAuthoring({ state: worldStarted.state, blueprint: worldBlueprint, world: worldBlueprint.world, runId: "world", occurredAt }), "WORLD_AUTHORING_PROJECT_NOT_PUBLISHED");
});

it("covers plugin task materialization dependency matrix", () => {
  const base = blueprintSchema.parse({
    schema_version: 1, project_id: "runtime-demo", entry_kind: "original", project_kind: "character_card", purpose: "plugins",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
    world: { enabled: false }, greetings: { enabled: false, character_ids: [] },
    plugins: [{ plugin_id: "official.html", capabilities: ["html.status_bar"] }],
  });
  const input = [{ id: "blueprint", revision: "sha256:" + "a".repeat(64) }];
  expect(materializePluginTasks("plugin_mvu_authoring", base, input)).toHaveLength(1);
  expect(materializePluginTasks("plugin_mvu_review", base, input)).toHaveLength(1);
  expect(materializePluginTasks("plugin_ejs_authoring", blueprintSchema.parse({ ...base, plugins: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }] }), input)[0]?.dependencies).toEqual([]);
  expect(materializePluginTasks("plugin_html_authoring", base, input)[0]?.dependencies).toEqual(["review-official-mvu-zod"]);
  const withEjs = blueprintSchema.parse({ ...base, plugins: [
    { plugin_id: "official.ejs", capabilities: ["ejs"] },
    { plugin_id: "official.html", capabilities: ["html.message_presentation"] },
  ] });
  expect(materializePluginTasks("plugin_html_authoring", withEjs, input)[0]?.dependencies).toEqual(["review-official-ejs"]);
  expect(materializePluginTasks("plugin_html_review", withEjs, input)[0]?.output_contract).toBe("review-report@1");
  expect(materializePluginTasks("authoring", base, input)).toEqual([]);
});
it("covers runtime stage selector fallback guards", () => {
  const rev = "sha256:" + "e".repeat(64);
  const blueprint = blueprintSchema.parse({
    schema_version: 1,
    project_id: "runtime-demo",
    entry_kind: "original",
    purpose: "selector",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
    world: { enabled: true, categories: [], authoring_timing: "after_characters" },
    greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    plugins: [],
  });
  const baseDefinition = workflowDefinitionSchema.parse({
    id: "original-v1",
    entry_kind: "original",
    stages: ["intake", "blueprint", "authoring", "semantic_review", "content_review", "publish_review"],
    required_gates: ["blueprint", "content", "publish"],
    tasks: [],
  });
  expectWorkflowError(() => startConfiguredWorkflow({
    state: state(),
    definition: workflowDefinitionSchema.parse({ ...baseDefinition, stages: ["blueprint", "intake"] }),
    occurredAt,
  }), "WORKFLOW_DEFINITION_MISMATCH");

  const incompleteExpansion = {
    schema_version: 2 as const,
    run_id: "expansion-guard",
    original_character_ids: ["alice"],
    new_characters: [{ id: "beth", display_name: "Beth", mode: "palette" as const, role: "supporting" as const }],
    affected_artifact_ids: [],
    revise_world: false,
    base_world: { enabled: true, categories: [] },
    base_relationships_enabled: false,
    base_relationship_character_ids: [],
    candidate_artifact_id: "candidate",
    candidate_path: "candidate.json",
    candidate_revision: rev,
    candidate_version: 1,
    base_project_revision: rev,
    base_blueprint_revision: rev,
    materialized: false,
  };
  const expansionState = workflowStateSchema.parse({
    ...state(),
    stage: "blueprint",
    extensions: { character_expansion: incompleteExpansion },
    gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "candidate", revision: rev }], extensions: {} }],
    artifacts: [{ id: "candidate", status: "draft", revision: rev, updated_at: occurredAt, extensions: {} }],
  });
  expectWorkflowError(() => advanceConfiguredWorkflow({
    state: expansionState,
    definition: workflowDefinitionSchema.parse({ ...baseDefinition, stages: ["blueprint", "authoring"] }),
    blueprint,
  }), "CHARACTER_EXPANSION_NOT_MATERIALIZED");

  const previewDefinition = workflowDefinitionSchema.parse({
    ...baseDefinition,
    stages: ["content_review", "publish_review"],
  });
  const contentState = workflowStateSchema.parse({
    ...state(),
    stage: "content_review",
    artifacts: [],
    gates: [{ id: "content", status: "approved", input_revisions: [], extensions: {} }],
  });
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: contentState, definition: previewDefinition, blueprint }), "WORKFLOW_ARTIFACT_MISSING");

  const approvedBlueprint = workflowStateSchema.parse({
    ...state(),
    stage: "blueprint",
    gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision: rev }], extensions: {} }],
    artifacts: [{ id: "blueprint", status: "approved", revision: rev, updated_at: occurredAt, extensions: {} }],
    extensions: {
      world_revision_review_stage: "post_world_review",
      world_revision_run_id: "world-run",
      world_authoring_run_id: "authoring-run",
    },
  });
  const authoringDefinition = workflowDefinitionSchema.parse({
    ...baseDefinition,
    stages: ["blueprint", "authoring", "semantic_review"],
  });
  const authoring = advanceConfiguredWorkflow({ state: approvedBlueprint, definition: authoringDefinition, blueprint });
  expect(authoring.stage).toBe("authoring");
  expect(authoring.tasks.length).toBeGreaterThan(0);

  const worldOnlyDefinition = workflowDefinitionSchema.parse({
    ...baseDefinition,
    stages: ["content_review", "post_world_review", "compile_preview"],
  });
  const worldReviewState = workflowStateSchema.parse({
    ...state(),
    stage: "content_review",
    extensions: { world_revision_review_stage: "post_world_review", world_revision_run_id: "world-run" },
    tasks: [],
  });
  const worldReview = advanceConfiguredWorkflow({ state: worldReviewState, definition: worldOnlyDefinition, blueprint: blueprintSchema.parse({ ...blueprint, characters: [], greetings: { enabled: false, character_ids: [] } }) });
  expect(worldReview.stage).toBe("post_world_review");

  const v1Expansion = {
    schema_version: 1 as const,
    run_id: "expansion-v1",
    original_character_ids: ["alice"],
    new_characters: [{ id: "beth", display_name: "Beth", mode: "palette" as const, role: "supporting" as const }],
    affected_artifact_ids: [],
    revise_world: false,
    base_world: { enabled: true, categories: [] },
    base_relationships_enabled: false,
    base_relationship_character_ids: [],
  };
  const staleGateState = workflowStateSchema.parse({
    ...state(),
    stage: "blueprint",
    extensions: { character_expansion: v1Expansion },
    gates: [{ id: "blueprint", status: "approved", input_revisions: [], extensions: {} }],
    artifacts: [{ id: "blueprint", status: "approved", revision: rev, updated_at: occurredAt, extensions: {} }],
  });
  expectWorkflowError(() => advanceConfiguredWorkflow({
    state: staleGateState,
    definition: workflowDefinitionSchema.parse({ ...baseDefinition, stages: ["blueprint", "authoring"] }),
    blueprint,
  }), "CHARACTER_EXPANSION_BLUEPRINT_GATE_STALE");
});
it("covers runtime selector, repair lineage, scoped revision, and legacy fallback branches", () => {
  const revision = "sha256:" + "f".repeat(64);
  const sourceFacts = workflowStateSchema.parse({
    ...state("source_adaptation"),
    stage: "facts_review",
    gates: [{ id: "facts", status: "approved", input_revisions: [], extensions: {} }],
  });
  expectWorkflowError(() => advanceConfiguredWorkflow({
    state: sourceFacts,
    definition: workflowDefinitionSchema.parse({
      id: "source-adaptation-v1",
      entry_kind: "source_adaptation",
      stages: ["facts_review", "authoring"],
      required_gates: ["facts"],
      tasks: [],
    }),
  }), "WORKFLOW_DEFINITION_MISMATCH");
  const sourceBlueprint = advanceConfiguredWorkflow({
    state: sourceFacts,
    definition: workflowDefinitionSchema.parse({
      id: "source-adaptation-v1",
      entry_kind: "source_adaptation",
      stages: ["facts_review", "blueprint"],
      required_gates: ["facts"],
      tasks: [],
    }),
  });
  expect(sourceBlueprint.tasks.at(-1)).toMatchObject({ kind: "create-blueprint", input_artifacts: [] });

  const noPlugins = blueprintSchema.parse({
    schema_version: 1,
    project_id: "runtime-demo",
    entry_kind: "original",
    purpose: "No plugins",
    characters: [],
    world: { enabled: true, categories: [] },
    greetings: { enabled: false, character_ids: [] },
    plugins: [],
  });
  expect(materializePluginTasks("plugin_html_authoring", noPlugins, [])).toEqual([]);

  const rootTask = {
    id: "curate-facts-root",
    kind: "curate-facts",
    status: "superseded" as const,
    assigned_agent: "fact-curator",
    capabilities: ["task.execute", "facts.propose"],
    input_artifacts: [],
    output_contract: "facts-curation-summary@1",
    dependencies: [],
    attempt: 3,
    max_attempts: 3,
    extensions: { stage: "source_processing" },
  };
  const lineageTask = {
    ...rootTask,
    id: "curate-facts-retry",
    status: "failed" as const,
    extensions: { stage: "source_processing", repair_of: "curate-facts-root", repair_generation: 1, repair_root: "curate-facts-root" },
  };
  const lineageState = workflowStateSchema.parse({
    ...state("source_adaptation"),
    stage: "source_processing",
    tasks: [rootTask, lineageTask],
  });
  const lineageRepair = beginSourceProcessingRepair({
    state: lineageState,
    sourceInputs: [{ id: "source", revision }],
    runId: "lineage-2",
    reason: "retry lineage",
    occurredAt,
    actor: "director",
  });
  expect(lineageRepair.tasks.at(-1)).toMatchObject({
    id: "curate-facts-lineage-2",
    extensions: { repair_generation: 2, repair_root: "curate-facts-root" },
  });

  const greetingBlueprint = blueprintSchema.parse({
    schema_version: 1,
    project_id: "runtime-demo",
    entry_kind: "original",
    purpose: "Greetings",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
    world: { enabled: false, categories: [] },
    greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
  });
  const greetingState = workflowStateSchema.parse({
    ...state(),
    stage: "content_review",
    artifacts: [{ id: "author-greetings.yaml", status: "approved", revision, updated_at: occurredAt, extensions: {} }],
  });
  const scopedGreetings = beginScopedContentRevision({
    state: greetingState,
    blueprint: greetingBlueprint,
    worldEntries: [],
    scope: "greetings",
    runId: "greetings-scope",
    reason: "refresh greetings",
    artifactIds: [],
    occurredAt,
    actor: "director",
  });
  expect(scopedGreetings.stage).toBe("greetings_authoring");

  const legacyRepair = workflowStateSchema.parse({
    ...state(),
    stage: "authoring",
    tasks: [{
      id: "legacy-repair",
      kind: "create-character",
      status: "needs_user_decision",
      assigned_agent: "zhuji-creator",
      capabilities: ["task.execute", "character.propose"],
      input_artifacts: [],
      output_contract: "proposal@1",
      dependencies: [],
      attempt: 1,
      max_attempts: 1,
      failure_summary: "legacy failure summary",
      extensions: { stage: "authoring", recovery_of: "create-character", recovery_generation: 1, recovery_exhausted: true },
    }],
  });
  const resumedLegacy = resumeTaskAfterRepair({
    state: legacyRepair,
    taskId: "legacy-repair",
    runId: "legacy-resume",
    reason: "repair",
    occurredAt,
    actor: "director",
  });
  expect(resumedLegacy.decisions.at(-1)?.extensions).toMatchObject({
    prior_failure_summary: "legacy failure summary",
  });
});


describe("runtime branch matrix", () => {
  it("covers revision targets, world stale guards, plugin dependencies, and content gates", () => {
    const revision = `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const blueprint = blueprintSchema.parse({
      schema_version: 1,
      project_id: "runtime-demo",
      entry_kind: "original",
      purpose: "Branch matrix",
      project_kind: "character_card",
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }],
      world: { enabled: true, authoring_timing: "after_characters", categories: ["concepts"] },
      greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
      relationships: { enabled: true, character_ids: ["alice", "beth"] },
      plugins: [{ plugin_id: "official.html", capabilities: ["html.status_bar"] }],
    });
    const characterId = "author-characters-alice-zhuji-01-appearance.yaml";
    const relationshipId = "author-relationships.yaml";
    const reviewed = workflowStateSchema.parse({
      ...state(),
      stage: "content_review",
      artifacts: [
        { id: characterId, status: "draft", revision, contract: "character-module@1", updated_at: occurredAt, extensions: {} },
        { id: relationshipId, status: "draft", revision, contract: "relationships@1", updated_at: occurredAt, extensions: {} },
        { id: "preview-old", status: "reviewed", revision, updated_at: occurredAt, extensions: {} },
      ],
      gates: [
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "pending", input_revisions: [], extensions: {} },
      ],
      tasks: [{
        id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1",
        dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision }, extensions: { stage: "semantic_review" },
      }],
    });
    const characterRevision = beginCharacterRevision({
      state: reviewed,
      blueprint,
      runId: "matrix-character",
      reason: "refresh character and relationships",
      artifactIds: [characterId, relationshipId],
      occurredAt,
      actor: "director",
    });
    expect(characterRevision.tasks.slice(-2)).toMatchObject([
      { kind: "create-character-module", dependencies: [] },
      { kind: "create-relationships", capabilities: ["task.execute", "relationships.propose", "task.clarify"] },
    ]);
    expect(characterRevision.extensions).toMatchObject({ character_revision_run_id: "matrix-character", greetings_revision_run_id: "matrix-character" });
    const duplicate = workflowStateSchema.parse({
      ...characterRevision,
      stage: "content_review",
      tasks: characterRevision.tasks.map((task) => ({ ...task, status: "completed" as const })),
    });
    expectWorkflowError(() => beginCharacterRevision({
      state: duplicate, blueprint, runId: "matrix-character", reason: "duplicate",
      artifactIds: [characterId], occurredAt, actor: "director",
    }), "CHARACTER_REVISION_RUN_EXISTS");

    const worldReview = workflowStateSchema.parse({
      ...state(),
      stage: "post_world_review",
      artifacts: [{ id: "author-world-concepts-entry.yaml", status: "draft", revision, updated_at: occurredAt, extensions: {} }],
      tasks: [{
        id: "review-world", kind: "review-world", status: "completed", assigned_agent: "world-lore-critic",
        capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1",
        dependencies: [], attempt: 1, max_attempts: 3, result: { id: "world-review", revision }, extensions: { stage: "post_world_review" },
      }],
    });
    expectWorkflowError(() => beginWorldRevision({
      state: workflowStateSchema.parse({ ...worldReview, artifacts: [] }),
      blueprint,
      worldEntries: [{ schema_version: 1, id: "entry", category: "concepts", title: "Entry", content: "Text", related_ids: [] }] as never,
      runId: "matrix-world", reason: "stale", artifactIds: ["author-world-concepts-entry.yaml"], occurredAt, actor: "director",
    }), "WORLD_REVISION_TARGET_STALE");
    const worldRevision = beginWorldRevision({
      state: worldReview,
      blueprint,
      worldEntries: [{ schema_version: 1, id: "entry", category: "concepts", title: "Entry", content: "Text", related_ids: [] }] as never,
      runId: "matrix-world", reason: "refresh", artifactIds: ["author-world-concepts-entry.yaml"], occurredAt, actor: "director",
    });
    expect(worldRevision.tasks.at(-1)).toMatchObject({ dependencies: [], extensions: { stage: "authoring" } });

    const html = materializePluginTasks("plugin_html_authoring", blueprint, [], undefined);
    const ejs = materializePluginTasks("plugin_ejs_authoring", blueprintSchema.parse({ ...blueprint, plugins: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }] }), [], undefined);
    expect(html[0]?.dependencies).toContain("review-official-mvu-zod");
    expect(ejs[0]?.dependencies).toEqual([]);

    const definition = workflowDefinitionSchema.parse({
      id: "original-v1", entry_kind: "original", stages: ["content_review", "compile_preview"],
      required_gates: ["content"], tasks: [],
    });
    const contentState = workflowStateSchema.parse({
      ...state(), stage: "content_review",
      gates: [{ id: "content", status: "approved", input_revisions: [], extensions: {} }],
      artifacts: [{ id: "blueprint", status: "draft", revision, updated_at: occurredAt, extensions: {} }],
      tasks: [],
    });
    expect(advanceConfiguredWorkflow({ state: contentState, definition, blueprint }).stage).toBe("compile_preview");
  });
});


it("covers runtime optional metadata, revision dispatch, and repair guard branches", () => {
  const revision = "sha256:" + "a".repeat(64);
  const reviewCharacter = {
    id: "review-character", kind: "review-character", status: "completed" as const, assigned_agent: "character-critic",
    capabilities: ["task.execute"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
    attempt: 1, max_attempts: 1, result: { id: "review", revision }, extensions: {},
  };
  const reviewWorld = {
    id: "review-world", kind: "review-world", status: "completed" as const, assigned_agent: "world-lore-critic",
    capabilities: ["task.execute"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
    attempt: 1, max_attempts: 1, result: { id: "world-review", revision }, extensions: {},
  };
  const characterBlueprint = blueprintSchema.parse({
    schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Character",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
    world: { enabled: false }, greetings: { enabled: false, character_ids: [] }, relationships: { enabled: false, character_ids: [] },
  });
  const characterArtifactId = "author-characters-alice-zhuji-01-appearance.yaml";
  const characterState = workflowStateSchema.parse({
    ...state(), stage: "semantic_review", tasks: [reviewCharacter],
    artifacts: [{ id: characterArtifactId, status: "draft", revision, updated_at: occurredAt, extensions: {} }],
  });
  const characterRevision = beginCharacterRevision({
    state: characterState, blueprint: characterBlueprint, runId: "optional-character", reason: "refresh",
    artifactIds: [characterArtifactId], occurredAt, actor: "director",
  });
  expect(characterRevision.extensions.greetings_revision_run_id).toBeUndefined();

  const worldBlueprint = blueprintSchema.parse({
    schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "World",
    characters: [], world: { enabled: true, categories: ["geography"] }, greetings: { enabled: false, character_ids: [] },
  });
  const worldEntry = { schema_version: 1 as const, id: "entry", category: "geography", title: "Entry", content: "World text", related_ids: [] };
  const worldArtifactId = "author-world-geography-entry.yaml";
  const worldState = workflowStateSchema.parse({
    ...state(), stage: "post_world_review", tasks: [reviewWorld],
    artifacts: [{ id: worldArtifactId, status: "draft", revision, updated_at: occurredAt, extensions: {} }],
  });
  const worldRevision = beginScopedContentRevision({
    state: worldState, blueprint: worldBlueprint, worldEntries: [worldEntry] as never,
    scope: "world", runId: "world-scope", reason: "refresh world", artifactIds: [worldArtifactId], occurredAt, actor: "director",
  });
  expect(worldRevision.stage).toBe("authoring");

  const greetingRevision = beginGreetingsRevision({
    state: workflowStateSchema.parse({
      ...state(), stage: "content_review", artifacts: [{ id: "source", status: "draft", revision, updated_at: occurredAt, extensions: {} }],
    }),
    runId: "greeting-input", reason: "refresh", occurredAt, actor: "director",
  });
  expect(greetingRevision.tasks[0]?.input_artifacts).toEqual([{ id: "source", revision }]);

  const factsState = workflowStateSchema.parse({
    ...state("source_adaptation"), stage: "facts_review", tasks: [{
      id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator",
      capabilities: ["task.execute"], input_artifacts: [{ id: "source", revision }], output_contract: "facts-curation-summary@1",
      dependencies: [], attempt: 1, max_attempts: 3, result: { id: "facts", revision }, extensions: {},
    }],
  });
  const factsWithConflict = workflowStateSchema.parse({
    ...factsState,
    decisions: [{ id: "facts-recuration-conflict", kind: "existing", actor: "director", decided_at: occurredAt, input_revisions: [], summary: "existing", extensions: { curation_run_id: "facts-run" } }],
  });
  expectWorkflowError(() => beginFactsRecuration({
    state: factsWithConflict, sourceInputs: [{ id: "source", revision }], runId: "facts-run", reason: "retry", occurredAt, actor: "director",
  }), "FACTS_RECURATION_ID_CONFLICT");

  const repairTask = {
    id: "repairable", kind: "create-character", status: "needs_user_decision" as const, assigned_agent: "zhuji-creator",
    capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
    attempt: 1, max_attempts: 1, failure_summary: "legacy", extensions: { recovery_exhausted: true, recovery_generation: 1, recovery_of: "create-character" },
  };
  const repairState = workflowStateSchema.parse({ ...state(), stage: "authoring", tasks: [repairTask] });
  expectWorkflowError(() => resumeTaskAfterRepair({
    state: workflowStateSchema.parse({ ...repairState, outcome: { status: "closed", kind: "cancelled", closed_at: occurredAt, decision_id: "closed" } }),
    taskId: "repairable", runId: "closed", reason: "repair", occurredAt, actor: "director",
  }), "WORKFLOW_CLOSED");
  expectWorkflowError(() => resumeTaskAfterRepair({
    state: workflowStateSchema.parse({
      ...repairState,
      tasks: [repairTask, {
        ...repairTask, id: "active", status: "claimed", lease: { id: "lease", owner: "worker", claimed_at: occurredAt, expires_at: "2099-01-01T00:00:00.000Z" },
      }],
    }),
    taskId: "repairable", runId: "active", reason: "repair", occurredAt, actor: "director",
  }), "TASK_REPAIR_RESUME_ACTIVE_LEASE");
  expectWorkflowError(() => resumeTaskAfterRepair({
    state: workflowStateSchema.parse({ ...repairState, decisions: [{ id: "task-repair-resume-conflict", kind: "existing", actor: "director", decided_at: occurredAt, input_revisions: [], summary: "old", extensions: {} }] }),
    taskId: "repairable", runId: "conflict", reason: "repair", occurredAt, actor: "director",
  }), "TASK_REPAIR_RESUME_ID_CONFLICT");
});


it("covers original stage task materialization variants", () => {
  const revision = "sha256:" + "1".repeat(64);
  const character = { id: "alice", display_name: "Alice", mode: "zhuji" as const, core_concept: "Lead" };
  const base = blueprintSchema.parse({
    schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "stage variants",
    characters: [character], world: { enabled: true, authoring_timing: "before_characters", categories: ["concepts"] },
    greetings: { enabled: true, character_ids: ["alice"], requirements: [] }, plugins: [],
  });
  const advance = (from: string, to: string, blueprint: typeof base, extras: Record<string, unknown> = {}, projectKind?: "character_card" | "worldbook") =>
    advanceConfiguredWorkflow({
      state: workflowStateSchema.parse({
        ...state(), stage: from, artifacts: from === "blueprint"
          ? [{ id: "blueprint", status: "draft", revision, updated_at: occurredAt, extensions: {} }]
          : [],
        gates: from === "blueprint"
          ? [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision }], extensions: {} }]
          : [],
        ...extras,
      }),
      definition: workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: [from, to], required_gates: ["blueprint", "content", "publish"], tasks: [] }),
      blueprint, projectKind,
    });
  expect(advance("intake", "pre_world_authoring", base).tasks[0]).toMatchObject({ kind: "create-world" });
  expect(advance("pre_world_authoring", "pre_world_review", base).tasks[0]).toMatchObject({ kind: "review-world" });
  expect(advance("authoring", "semantic_review", base).tasks[0]).toMatchObject({ kind: "review-character" });
  const expansion = {
    schema_version: 1 as const, run_id: "expansion-materialize", original_character_ids: ["alice"],
    new_characters: [{ id: "beth", display_name: "Beth", mode: "palette" as const, role: "supporting" as const }], affected_artifact_ids: [], revise_world: false,
    base_world: base.world, base_relationships_enabled: false, base_relationship_character_ids: [],
  };
  const semanticExpansion = advance("authoring", "semantic_review", base, { extensions: { character_expansion: expansion } });
  expect(semanticExpansion.tasks[0]?.input_artifacts).toEqual([]);
  expect(advance("semantic_review", "greetings_authoring", base).tasks[0]).toMatchObject({ kind: "create-greetings" });
  const noGreetings = blueprintSchema.parse({ ...base, greetings: { enabled: false, character_ids: [] } });
  expect(advance("greetings_authoring", "content_review", base).tasks[0]).toMatchObject({ kind: "review-greetings" });
  expect(advance("authoring", "content_review", base, { extensions: { world_only_run: true } }).tasks[0]).toMatchObject({ kind: "review-world" });
  expect(advance("authoring", "content_review", noGreetings, { extensions: { world_only_run: true } }).tasks[0]).toMatchObject({ kind: "review-world" });
});


it("covers optional runtime revisions, expansion contracts, and lifecycle duplicates", () => {
  const revision = "sha256:" + "2".repeat(64);
  const manifest = projectManifestSchema.parse({ schema_version: 1, id: "runtime-demo", title: "Runtime", kind: "character_card", card: { name: "Runtime" }, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }] });
  const current = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "Runtime", characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }], world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] } });
  const candidate = blueprintSchema.parse({ ...current, characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }], greetings: { enabled: true, character_ids: ["alice", "beth"] } });
  const targetId = "author-characters-alice-zhuji-01-appearance.yaml";
  const reviewed = workflowStateSchema.parse({
    ...state(), stage: "published",
    artifacts: [{ id: targetId, status: "draft", revision, contract: "character-module@1", updated_at: occurredAt, extensions: {} }],
    tasks: [{ id: "review-characters", kind: "review-character", status: "completed", assigned_agent: "character-critic", capabilities: ["review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision }, extensions: {} }],
  });
  const v1 = beginCharacterExpansion({
    state: reviewed, manifest, currentBlueprint: current, candidateBlueprint: candidate,
    newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }],
    affectedArtifactIds: [targetId], reviseWorld: false, runId: "expansion-v1-optional", reason: "Add Beth",
    occurredAt, actor: "director", blueprintRevision: revision, placeholderArtifacts: [{ id: "placeholder", revision, contract: "placeholder@1" }],
  });
  expect(v1.extensions.character_expansion).toMatchObject({ schema_version: 1 });
  expect(v1.artifacts).toContainEqual(expect.objectContaining({ id: "placeholder", status: "draft" }));
  const characterRevision = beginCharacterRevision({
    state: workflowStateSchema.parse({ ...reviewed, stage: "content_review" }),
    blueprint: current, runId: "character-contract", reason: "refresh", artifactIds: [targetId], occurredAt, actor: "director",
  });
  expect(characterRevision.tasks.length).toBeGreaterThan(0);
  expectWorkflowError(() => beginCharacterRevision({
    state: workflowStateSchema.parse({ ...characterRevision, stage: "content_review", tasks: characterRevision.tasks.map((task) => ({ ...task, status: "completed" as const })) }),
    blueprint: current, runId: "character-contract", reason: "duplicate", artifactIds: [targetId], occurredAt, actor: "director",
  }), "CHARACTER_REVISION_RUN_EXISTS");
});
it("covers optional runtime lineage, metadata, and lifecycle map branches", () => {
  const revision = "sha256:" + "3".repeat(64);
  const sourceTask = {
    id: "curate-facts",
    kind: "curate-facts",
    status: "claimed" as const,
    assigned_agent: "fact-curator",
    capabilities: ["task.execute"],
    input_artifacts: [],
    output_contract: "facts-curation-summary@1",
    dependencies: [],
    attempt: 1,
    max_attempts: 3,
    lease: { id: "lease", owner: "fact-curator", claimed_at: occurredAt, expires_at: "2099-01-01T00:00:00.000Z" },
    extensions: { stage: "source_processing" },
  };
  const sourceState = workflowStateSchema.parse({ ...state("source_adaptation"), stage: "source_processing", tasks: [sourceTask] });
  const completedSource = completeSourceProcessingTask({
    state: sourceState, taskId: sourceTask.id, leaseId: "lease", owner: "fact-curator",
    result: { id: "facts-summary", revision, contract: "facts-curation-summary@1" },
    clock: { now: () => new Date(occurredAt) },
  });
  expect(completedSource.tasks[0]).toMatchObject({ status: "completed", result: { id: "facts-summary" } });

  const repairTarget = {
    ...sourceTask,
    status: "failed" as const,
    attempt: 3,
    max_attempts: 3,
    lease: undefined,
    extensions: { stage: "source_processing", repair_of: "curate-facts-root" },
  };
  const repaired = beginSourceProcessingRepair({
    state: workflowStateSchema.parse({
      ...state("source_adaptation"), stage: "source_processing",
      tasks: [{ ...repairTarget, id: "curate-facts-root", status: "superseded" as const }, repairTarget],
    }),
    sourceInputs: [{ id: "source", revision }],
    runId: "repair-fallbacks", reason: "repair", occurredAt, actor: "director",
  });
  expect(repaired.tasks.at(-1)).toMatchObject({ extensions: { repair_generation: 2, repair_root: "curate-facts-root" } });

  const resumable = workflowStateSchema.parse({
    ...state(), stage: "authoring",
    tasks: [
      {
        id: "repair-target", kind: "create-character", status: "needs_user_decision", assigned_agent: "zhuji-creator",
        capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
        attempt: 1, max_attempts: 1, extensions: { stage: "authoring", recovery_exhausted: true, recovery_generation: 1, recovery_of: "create-character" },
      },
      {
        id: "completed-other", kind: "create-character", status: "completed", assigned_agent: "zhuji-creator",
        capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 1, result: { id: "other", revision }, extensions: { stage: "authoring" },
      },
    ],
  });
  const resumed = resumeTaskAfterRepair({ state: resumable, taskId: "repair-target", runId: "resume-fallback", reason: "repair", occurredAt, actor: "director" });
  expect(resumed.tasks.find((task) => task.id === "completed-other")?.status).toBe("completed");
  expect(resumed.decisions.at(-1)?.extensions).not.toHaveProperty("prior_failure_summary");

  const greetings = beginGreetingsRevision({
    state: workflowStateSchema.parse({
      ...state(), stage: "content_review",
      artifacts: [{ id: "author-greetings.yaml", status: "draft", revision, contract: "greetings@1", updated_at: occurredAt, extensions: {} }],
    }),
    runId: "greeting-contract", reason: "refresh", occurredAt, actor: "director",
  });
  expect(greetings.tasks[0]?.input_artifacts).toContainEqual(expect.objectContaining({ contract: "greetings@1" }));

  const worldBlueprint = blueprintSchema.parse({
    schema_version: 1, project_id: "runtime-demo", entry_kind: "original", purpose: "World",
    characters: [], world: { enabled: true, categories: [] }, greetings: { enabled: false, character_ids: [] },
  });
  const worldState = workflowStateSchema.parse({
    ...state(), stage: "published",
    artifacts: [
      { id: "author-world-concepts-entry.yaml", status: "draft", revision, contract: "world-entry@1", updated_at: occurredAt, extensions: {} },
      { id: "preview-old", status: "stale", revision, updated_at: occurredAt, extensions: {} },
    ],
    gates: [{ id: "facts", status: "not_required", input_revisions: [], extensions: {} }],
  });
  const worldStarted = beginWorldAuthoring({ state: worldState, blueprint: worldBlueprint, world: worldBlueprint.world, runId: "world-fallback", occurredAt });
  expect(worldStarted.state.tasks[0]?.input_artifacts).toContainEqual(expect.objectContaining({ contract: "world-entry@1" }));
  expect(worldStarted.state.artifacts.find((item) => item.id === "preview-old")?.status).toBe("stale");
  const worldDuplicate = workflowStateSchema.parse({ ...worldState, tasks: [{ ...worldState.tasks[0], id: "create-world-world-fallback", kind: "create-world", status: "completed", assigned_agent: "world-lore-creator", capabilities: ["task.execute"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 3, extensions: { stage: "authoring", world_authoring_run_id: "world-fallback" } }] });
  expectWorkflowError(() => beginWorldAuthoring({ state: worldDuplicate, blueprint: worldBlueprint, world: worldBlueprint.world, runId: "world-fallback", occurredAt }), "WORLD_AUTHORING_RUN_EXISTS");

  const worldEntry = { schema_version: 1 as const, id: "entry", category: "concepts", title: "Entry", content: "Text", related_ids: [] };
  const reviewedWorld = workflowStateSchema.parse({
    ...state(), stage: "post_world_review",
    artifacts: [{ id: "author-world-concepts-entry.yaml", status: "draft", revision, contract: "world-entry@1", updated_at: occurredAt, extensions: {} }],
    tasks: [{ id: "review-world", kind: "review-world", status: "completed", assigned_agent: "world-lore-critic", capabilities: ["review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision }, extensions: { stage: "post_world_review" } }],
  });
  const revisedWorld = beginWorldRevision({ state: reviewedWorld, blueprint: worldBlueprint, worldEntries: [worldEntry] as never, runId: "world-contract", reason: "refresh", artifactIds: ["author-world-concepts-entry.yaml"], occurredAt, actor: "director" });
  const revisedTask = revisedWorld.tasks.find((task) => task.kind === "create-world");
  expect(revisedTask?.input_artifacts).toContainEqual(expect.objectContaining({ contract: "world-entry@1" }));
  expectWorkflowError(() => beginWorldRevision({ state: workflowStateSchema.parse({ ...reviewedWorld, tasks: [...reviewedWorld.tasks, { ...revisedTask!, status: "completed" as const }] }), blueprint: worldBlueprint, worldEntries: [worldEntry] as never, runId: "world-contract", reason: "duplicate", artifactIds: ["author-world-concepts-entry.yaml"], occurredAt, actor: "director" }), "WORLD_REVISION_RUN_EXISTS");
});
it("covers runtime world-only, plugin, expansion, and revision guards", () => {
  const revision = `sha256:${"4".repeat(64)}`;
  const manifest = projectManifestSchema.parse({ schema_version: 1, id: "runtime-guards", title: "Runtime", kind: "character_card", card: { name: "Runtime" }, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }] });
  const current = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-guards", entry_kind: "original", purpose: "Runtime", characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }], world: { enabled: false }, greetings: { enabled: true, character_ids: ["alice"] } });
  const candidate = blueprintSchema.parse({ ...current, characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }], greetings: { enabled: true, character_ids: ["alice", "beth"] } });
  const targetId = "author-characters-alice-zhuji-01-appearance.yaml";
  const reviewTask = { id: "review-characters", kind: "review-character", status: "completed" as const, assigned_agent: "character-critic", capabilities: ["review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [], attempt: 1, max_attempts: 3, result: { id: "review", revision }, extensions: {} };
  const reviewed = workflowStateSchema.parse({ ...state(), stage: "published", artifacts: [{ id: targetId, status: "draft", revision, updated_at: occurredAt, extensions: {} }], tasks: [reviewTask] });
  const beginArgs = { state: reviewed, manifest, currentBlueprint: current, candidateBlueprint: candidate, newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette" as const, role: "supporting" as const, core_concept: "Rival" }], affectedArtifactIds: [] as string[], reviseWorld: false, runId: "runtime-guards", reason: "Add Beth", occurredAt, actor: "director", blueprintRevision: revision, placeholderArtifacts: [] };

  expectWorkflowError(() => beginCharacterExpansion({ ...beginArgs, state: workflowStateSchema.parse({ ...reviewed, tasks: [] }) }), "CHARACTER_EXPANSION_REVIEW_REQUIRED");
  expectWorkflowError(() => beginCharacterExpansion({ ...beginArgs, affectedArtifactIds: [targetId, targetId] }), "CHARACTER_EXPANSION_TARGET_INVALID");
  const currentRelationships = blueprintSchema.parse({ ...current, characters: [...current.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }], greetings: { enabled: true, character_ids: ["alice", "beth"] }, relationships: { enabled: true, character_ids: ["alice", "beth"], requirements: [], extensions: {} } });
  const relationshipManifest = projectManifestSchema.parse({ ...manifest, characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }, { id: "beth", display_name: "Beth", mode: "palette", role: "supporting" }] });
  expectWorkflowError(() => beginCharacterExpansion({ ...beginArgs, manifest: relationshipManifest, currentBlueprint: currentRelationships, candidateBlueprint: blueprintSchema.parse({ ...currentRelationships, relationships: { enabled: false, character_ids: [], requirements: [], extensions: {} } }), newCharacters: [] }), "CHARACTER_EXPANSION_RELATIONSHIPS_DELETE_FORBIDDEN");

  const worldbook = blueprintSchema.parse({ schema_version: 1, project_id: "runtime-guards", project_kind: "worldbook", entry_kind: "original", purpose: "World", characters: [], world: { enabled: true, categories: [] }, greetings: { enabled: false, character_ids: [] } });
  const worldDefinition = workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: ["blueprint", "pre_world_authoring"], required_gates: [], tasks: [] });
  const worldState = workflowStateSchema.parse({ ...state(), stage: "blueprint", artifacts: [{ id: "blueprint", status: "draft", revision, updated_at: occurredAt, extensions: {} }], gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision }], extensions: {} }], extensions: { world_only_run: true, world_authoring_run_id: "world-extension" } });
  expect(advanceConfiguredWorkflow({ state: worldState, definition: worldDefinition, blueprint: worldbook, projectKind: "worldbook" }).tasks[0]).toMatchObject({ id: "create-world-world-extension" });
  expect(advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...worldState, stage: "semantic_review", extensions: { world_only_run: true } }), definition: workflowDefinitionSchema.parse({ ...worldDefinition, stages: ["semantic_review", "content_review"] }), blueprint: worldbook, projectKind: "worldbook" }).tasks[0]).toMatchObject({ kind: "review-world" });
  expect(advanceConfiguredWorkflow({ state: workflowStateSchema.parse({ ...state(), stage: "authoring" }), definition: workflowDefinitionSchema.parse({ ...worldDefinition, stages: ["authoring", "content_review"] }), blueprint: blueprintSchema.parse({ ...current, greetings: { enabled: false, character_ids: [] } }), projectKind: "character_card" }).tasks).toEqual([]);
  expectWorkflowError(() => advanceConfiguredWorkflow({ state: worldState, definition: workflowDefinitionSchema.parse({ ...worldDefinition, stages: ["intake"] }), blueprint: worldbook, projectKind: "worldbook" }), "WORKFLOW_ALREADY_PUBLISHED");

  const completedSource = workflowStateSchema.parse({ ...state("source_adaptation"), stage: "source_processing", tasks: [{ ...reviewTask, id: "curate-facts", kind: "curate-facts", status: "completed", assigned_agent: "fact-curator", output_contract: "facts-curation-summary@1", result: { id: "facts", revision }, extensions: { stage: "source_processing" } }, { ...reviewTask, id: "other", status: "pending" }] });
  const completedSourceResult = completeSourceProcessingTask({ state: completedSource, taskId: "curate-facts", leaseId: "none", owner: "fact-curator", result: { id: "facts", revision, contract: "facts-curation-summary@1" } });
  expect(completedSourceResult).toBe(completedSource);

  const v1 = beginCharacterExpansion(beginArgs);
  expectWorkflowError(() => updateCharacterExpansionBlueprint({ state: workflowStateSchema.parse({ ...v1, tasks: [{ ...reviewTask, id: "expansion-task", status: "pending", extensions: { expansion_run_id: "runtime-guards" } }] }), manifest, currentBlueprint: candidate, candidateBlueprint: candidate, runId: "runtime-guards", reason: "blocked", occurredAt, actor: "director", blueprintRevision: revision, candidate: { artifactId: "candidate", path: "candidate.json", revision, version: 1 } }), "CHARACTER_EXPANSION_LEGACY_RUN");
  const v1Updated = updateCharacterExpansionBlueprint({ state: v1, manifest, currentBlueprint: candidate, candidateBlueprint: candidate, runId: "runtime-guards", reason: "update", occurredAt, actor: "director", blueprintRevision: revision });
  expect(v1Updated.decisions.at(-1)?.input_revisions[0]?.id).toBe("blueprint");

  const v2 = beginCharacterExpansion({ ...beginArgs, runId: "runtime-v2", candidate: { artifactId: "candidate-v2", path: "candidate-v2.json", revision, version: 1, baseProjectRevision: revision, baseBlueprintRevision: revision } });
  expectWorkflowError(() => updateCharacterExpansionBlueprint({ state: workflowStateSchema.parse({ ...v2, tasks: [{ ...reviewTask, id: "v2-expansion-task", status: "pending", extensions: { expansion_run_id: "runtime-v2" } }] }), manifest, currentBlueprint: candidate, candidateBlueprint: candidate, runId: "runtime-v2", reason: "blocked", occurredAt, actor: "director", blueprintRevision: revision, candidate: { artifactId: "candidate-v2-next", path: "candidate-v2-next.json", revision, version: 2 } }), "CHARACTER_EXPANSION_UPDATE_TASKS_EXIST");

  const worldEntry = { schema_version: 1 as const, id: "entry", category: "concepts", title: "Entry", content: "Text", related_ids: [] };
  expectWorkflowError(() => beginWorldRevision({ state: workflowStateSchema.parse({ ...reviewed, stage: "post_world_review", tasks: [{ ...reviewTask, id: "active-world", kind: "create-world", status: "pending", assigned_agent: "world-lore-creator" }] }), blueprint: worldbook, worldEntries: [worldEntry] as never, runId: "active-world", reason: "active", artifactIds: ["author-world-concepts-entry.yaml"], occurredAt, actor: "director" }), "WORLD_REVISION_TASK_ACTIVE");
  expectWorkflowError(() => beginWorldRevision({ state: workflowStateSchema.parse({ ...reviewed, stage: "post_world_review", tasks: [] }), blueprint: worldbook, worldEntries: [worldEntry] as never, runId: "missing-review", reason: "missing", artifactIds: ["author-world-concepts-entry.yaml"], occurredAt, actor: "director" }), "WORLD_REVISION_REVIEW_REQUIRED");
});

it("covers remaining runtime stage and dependency fallback branches", () => {
  const revision = "sha256:" + "5".repeat(64);
  const base = blueprintSchema.parse({
    schema_version: 1,
    project_id: "runtime-demo",
    entry_kind: "original",
    purpose: "runtime branches",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
    world: { enabled: false, categories: [] },
    greetings: { enabled: true, character_ids: ["alice"], requirements: [] },
    plugins: [],
  });

  // A plugin stage with no matching selection must produce no task.
  expect(materializePluginTasks("plugin_html_authoring", base, [], undefined)).toEqual([]);

  const advance = (from: string, to: string, blueprint: typeof base, extensions: Record<string, unknown> = {}) =>
    advanceConfiguredWorkflow({
      state: workflowStateSchema.parse({ ...state(), stage: from, extensions, revision: 5, gates: [], artifacts: [], tasks: [] }),
      definition: workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: [from, to], required_gates: [], tasks: [] }),
      blueprint,
    });

  // Cover world-only and ordinary semantic/content review dispatches.
  expect(advance("authoring", "semantic_review", base).tasks[0]).toMatchObject({ kind: "review-character" });
  expect(advance("authoring", "content_review", base, { world_only_run: false }).tasks[0]).toMatchObject({ kind: "review-greetings" });
  expect(advance("greetings_authoring", "content_review", blueprintSchema.parse({ ...base, greetings: { enabled: false, character_ids: [] } })).tasks).toEqual([]);

  // A stage missing from the definition has no configured successor.
  expectWorkflowError(() => advanceConfiguredWorkflow({
    state: workflowStateSchema.parse({ ...state(), stage: "content_review", revision: 5, gates: [], artifacts: [], tasks: [] }),
    definition: workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: ["intake"], required_gates: [], tasks: [] }),
    blueprint: base,
  }), "WORKFLOW_ALREADY_PUBLISHED");

  // Relationship expansion can reuse a completed final module or its canonical task id.
  const relationshipBlueprint = blueprintSchema.parse({
    ...base,
    greetings: { enabled: true, character_ids: ["alice", "beth"], requirements: [] },
    relationships: { enabled: true, character_ids: ["alice", "beth"], requirements: [], extensions: {} },
    characters: [...base.characters, { id: "beth", display_name: "Beth", mode: "palette", core_concept: "Rival" }],
  });
  const manifest = projectManifestSchema.parse({
    schema_version: 1,
    id: "runtime-demo",
    title: "Runtime",
    kind: "character_card",
    card: { name: "Runtime" },
    characters: [
      { id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" },
    ],
  });
  const review = workflowStateSchema.parse({
    ...state(),
    stage: "published",
    tasks: [
      {
        id: "create-alice-self_introduction",
        kind: "create-character-module",
        status: "completed",
        assigned_agent: "zhuji-creator",
        capabilities: ["character.propose"],
        input_artifacts: [],
        output_contract: "proposal@1",
        dependencies: [],
        attempt: 1,
        max_attempts: 3,
        result: { id: "alice-self", revision },
        extensions: { character_id: "alice", module: "self_introduction", stage: "authoring" },
      },
      {
        id: "review-characters",
        kind: "review-character",
        status: "completed",
        assigned_agent: "character-critic",
        capabilities: ["review.submit"],
        input_artifacts: [],
        output_contract: "review-report@1",
        dependencies: [],
        attempt: 1,
        max_attempts: 3,
        result: { id: "review", revision },
        extensions: {},
      },
    ],
  });
  const expansion = beginCharacterExpansion({
    state: review,
    manifest,
    currentBlueprint: base,
    candidateBlueprint: relationshipBlueprint,
    newCharacters: [{ id: "beth", display_name: "Beth", mode: "palette", role: "supporting", core_concept: "Rival" }],
    affectedArtifactIds: [],
    reviseWorld: false,
    runId: "relationship-branches",
    reason: "add Beth",
    occurredAt,
    actor: "director",
    blueprintRevision: revision,
    placeholderArtifacts: [],
  });
  const materializedExpansion = advanceConfiguredWorkflow({
    state: workflowStateSchema.parse({
      ...expansion,
      gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision }], extensions: {} }],
    }),
    definition: workflowDefinitionSchema.parse({ id: "original-v1", entry_kind: "original", stages: ["blueprint", "authoring"], required_gates: ["blueprint"], tasks: [] }),
    blueprint: relationshipBlueprint,
  });
  expect(materializedExpansion.tasks.some((task) => task.kind === "create-relationships")).toBe(true);

  const withFactsGate = workflowStateSchema.parse({
    ...state("source_adaptation"),
    stage: "facts_review",
    revision: 5,
    gates: [{ id: "facts", status: "approved", input_revisions: [{ id: "source", revision }], extensions: {} }],
    tasks: [],
  });
  expect(advanceConfiguredWorkflow({
    state: withFactsGate,
    definition: workflowDefinitionSchema.parse({ id: "source-adaptation-v1", entry_kind: "source_adaptation", stages: ["facts_review", "blueprint"], required_gates: ["facts"], tasks: [] }),
    blueprint: base,
  }).stage).toBe("blueprint");
});
