import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  computeBuildPlan,
  contentHash,
  createProjectState,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type FactRecord,
  type SourceRecord,
} from "@st-workspace/core";
import {
  AuthoringService,
  BuildService,
  buildCoverageSnapshot,
  buildDefaultRequirementSet,
  createCoverageBindingForArtifact,
  deriveArtifactCoverageScope,
  deriveArtifactScopeResolutionIds,
  projectActiveCoverageBindings,
  recordUserDecisionAndResolution,
  runFormalCoverageAssessment,
  validateWorkflow,
} from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";
const actorInput = { actor: "director", executionAgent: { id: "director", name: "director", role: "orchestrator" } as const };

function sourceRecord(id: string, text: string): SourceRecord {
  return { id, candidate_id: `candidate-${id}`, title: id, canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: now };
}

const characters = [
  { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
  { id: "beta", label: "Beta", ordinal: 2, mode: "palette" },
];

function precheck(projectId: string, world = false): BlueprintPrecheckRecord {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      project_id: projectId,
      flow: "character",
      collaboration_mode: "assisted",
      characters,
      primary_character_id: "alpha",
      ...(world ? { world: { enabled: true, concept: "steampunk" } } : {}),
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "blueprint",
    content: JSON.stringify({ kind: "blueprint", project_id: projectId, characters, primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact(overrides: Partial<FactRecord> = {}): FactRecord {
  return {
    id: "fact-1",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    status: "candidate",
    confidence: 0.8,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    created_at: now,
    updated_at: now,
    created_by: "fact-curator",
    ...overrides,
  };
}

const acceptedAlphaFact = fact({
  id: "fact-acc",
  statement: "Alpha is calm.",
  value: "calm",
  status: "accepted",
  coverage_targets: ["req.personality"],
  fact_revision: 1,
  accepted_fact_revision: contentHash("accepted-1"),
  candidate_occurrence_id: "occ-1",
  review_run_id: "run-1",
  decision_id: "dec-1",
  created_by: "fact-reviewer-1",
  evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
});

function reviewRun(status: "open" | "blocked" | "completed", id = "run-1") {
  return {
    schema_version: 1 as const,
    id,
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("text") }],
    policy_revision: "pol-1",
    status,
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(factId: string, occurrenceId: string, resultingFactRevision: number, runId = "run-1", id = "dec-1") {
  return {
    schema_version: 1 as const,
    id,
    operation_id: "op-review",
    review_run_id: runId,
    candidate_occurrence_id: occurrenceId,
    fact_id: factId,
    reviewer_identity: "fact-reviewer-1",
    decision: "accepted" as const,
    reason: "supported",
    evidence: [],
    candidate_revision: "cand-1",
    expected_projection_revision: "proj-1",
    resulting_fact_revision: resultingFactRevision,
    created_at: now,
  };
}

function operation(id: string, kind: string) {
  return { id, kind, request: kind, status: "running" as const, created_at: now, updated_at: now, progress: [] };
}

function characterArtifact(id: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const content = JSON.stringify({
    document: {
      schema_version: 1,
      id,
      display_name: id === "alpha" ? "Alpha" : "Beta",
      summary: "Calm and direct.",
      aliases: [],
      relationships: [],
      sections: [{ id: "personality", title: "Personality", content: "Calm and direct." }],
      provenance: [],
      extensions: {},
    },
  });
  return {
    id: `character-${id}`,
    key: `character:${id}`,
    kind: "character",
    name: id,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    ...overrides,
  };
}

async function baseRepository(factsToUse: FactRecord[], world = false, flow = "source_adaptation"): Promise<MemoryProjectRepository> {
  const repository = new MemoryProjectRepository("coverage-project");
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow, status: "complete" },
    blueprint_prechecks: [precheck("coverage-project", world)],
    artifacts: [blueprintArtifact("coverage-project")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: factsToUse,
  }));
  return repository;
}

async function commitRun(repository: MemoryProjectRepository, revision: number, run: { id: string }, decisions: unknown[]): Promise<void> {
  await repository.commit(revision, (state) => ({
    ...state,
    fact_review_runs: [...state.fact_review_runs, run as never],
    fact_review_decisions: [...state.fact_review_decisions, ...(decisions as never[])],
  }));
}

async function commitAssessment(repository: MemoryProjectRepository, revision: number, set: CoverageRequirementSet, assessment: CoverageAssessment): Promise<void> {
  await repository.commit(revision, (state) => ({
    ...state,
    coverage_requirement_sets: [...state.coverage_requirement_sets, set],
    coverage_assessments: [...state.coverage_assessments, assessment],
  }));
}

async function coverageWorkflowState(options: { facts?: FactRecord[]; world?: boolean; characterArtifacts?: ArtifactRecord[]; operations?: Array<ReturnType<typeof operation>>; flow?: string } = {}): Promise<{ repository: MemoryProjectRepository; set: CoverageRequirementSet }> {
  const repository = await baseRepository(options.facts ?? [acceptedAlphaFact], options.world ?? false, options.flow ?? "source_adaptation");
  await commitRun(repository, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
  const state = await repository.read();
  const set = buildDefaultRequirementSet(state, "director");
  const formal = runFormalCoverageAssessment(state, set, "op-a", "system");
  await commitAssessment(repository, 2, set, formal);
  await repository.commit(3, (state) => ({
    ...state,
    artifacts: [...state.artifacts, ...(options.characterArtifacts ?? [])],
    operations: [...state.operations, ...(options.operations ?? [])],
  }));
  return { repository, set };
}

describe("Audit 5 batch 3: authoring coverage binding and publish lineage", () => {
  describe("#14 artifact coverage scope", () => {
    it("keeps character A resolutions out of character B bindings", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha"), characterArtifact("beta")] });
      let state = await repository.read();
      const first = recordUserDecisionAndResolution(state, "creative_completion", ["req.personality"], "authorize", "alpha res", "typed", actorInput, "op-dec-1", "alpha");
      state = first.state;
      const second = recordUserDecisionAndResolution(state, "creative_completion", ["req.appearance"], "authorize", "beta res", "typed", actorInput, "op-dec-2", "beta");
      state = second.state;
      const formal2 = runFormalCoverageAssessment(state, set, "op-b", "system");
      state = { ...state, coverage_assessments: [...state.coverage_assessments, formal2] };

      const alphaScope = deriveArtifactCoverageScope(state, characterArtifact("alpha"));
      expect(alphaScope.character_ids).toEqual(["alpha"]);
      const alphaResolutionIds = deriveArtifactScopeResolutionIds(state, characterArtifact("alpha"), formal2);
      const betaResolutionIds = deriveArtifactScopeResolutionIds(state, characterArtifact("beta"), formal2);
      expect(alphaResolutionIds).toEqual([first.resolutions[0]!.id]);
      expect(betaResolutionIds).toEqual([second.resolutions[0]!.id]);
      expect(alphaResolutionIds).not.toContain(second.resolutions[0]!.id);
      expect(betaResolutionIds).not.toContain(first.resolutions[0]!.id);
    });

    it("separates world and character scopes", async () => {
      const { repository, set } = await coverageWorkflowState({ world: true, characterArtifacts: [characterArtifact("alpha")] });
      let state = await repository.read();
      const charRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.personality"], "authorize", "char", "typed", actorInput, "op-dec-1", "alpha");
      state = charRes.state;
      const worldRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.world_context"], "authorize", "world", "typed", actorInput, "op-dec-2");
      state = worldRes.state;
      const formal2 = runFormalCoverageAssessment(state, set, "op-b", "system");
      state = { ...state, coverage_assessments: [...state.coverage_assessments, formal2] };

      const worldArtifact: ArtifactRecord = {
        ...characterArtifact("alpha"),
        id: "world-1",
        key: "world_lore:alpha",
        kind: "world_lore",
        name: "World",
        content: JSON.stringify({ schema_version: 1, entries: [{ id: "e1", title: "Entry", content: "Steampunk." }] }),
        content_hash: contentHash("world-1"),
        revision: contentHash("world-1"),
      };
      const worldScope = deriveArtifactCoverageScope(state, worldArtifact);
      expect(worldScope.world).toBe(true);
      expect(worldScope.character_ids).toEqual([]);
      const worldResolutionIds = deriveArtifactScopeResolutionIds(state, worldArtifact, formal2);
      expect(worldResolutionIds).toEqual([worldRes.resolutions[0]!.id]);
      expect(worldResolutionIds).not.toContain(charRes.resolutions[0]!.id);

      const charResolutionIds = deriveArtifactScopeResolutionIds(state, characterArtifact("alpha"), formal2);
      expect(charResolutionIds).toContain(charRes.resolutions[0]!.id);
      expect(charResolutionIds).not.toContain(worldRes.resolutions[0]!.id);
    });

    it("includes every participating character for relationship artifacts", async () => {
      const { repository, set } = await coverageWorkflowState();
      let state = await repository.read();
      const alphaRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.personality"], "authorize", "alpha", "typed", actorInput, "op-dec-1", "alpha");
      state = alphaRes.state;
      const betaRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.appearance"], "authorize", "beta", "typed", actorInput, "op-dec-2", "beta");
      state = betaRes.state;
      const formal2 = runFormalCoverageAssessment(state, set, "op-b", "system");
      state = { ...state, coverage_assessments: [...state.coverage_assessments, formal2] };

      const relationshipArtifact: ArtifactRecord = {
        ...characterArtifact("alpha"),
        id: "rel-1",
        key: "relationships:alpha-beta",
        kind: "relationship",
        name: "Alpha and Beta",
        content: JSON.stringify({ document: { schema_version: 1, team_code: "AB0001", character_ids: ["alpha", "beta"], character_summaries: [], perspectives: [], groups: [], summary: "Bond", provenance: [], extensions: {} } }),
        content_hash: contentHash("rel-1"),
        revision: contentHash("rel-1"),
      };
      const resolutionIds = deriveArtifactScopeResolutionIds(state, relationshipArtifact, formal2);
      expect(resolutionIds).toEqual([alphaRes.resolutions[0]!.id, betaRes.resolutions[0]!.id].sort());
    });

    it("applies an explicit global policy to plugin artifacts", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha"), characterArtifact("beta")] });
      let state = await repository.read();
      const alphaRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.personality"], "authorize", "alpha", "typed", actorInput, "op-dec-1", "alpha");
      state = alphaRes.state;
      const betaRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.appearance"], "authorize", "beta", "typed", actorInput, "op-dec-2", "beta");
      state = betaRes.state;
      const formal2 = runFormalCoverageAssessment(state, set, "op-b", "system");
      state = { ...state, coverage_assessments: [...state.coverage_assessments, formal2] };

      const pluginArtifact: ArtifactRecord = {
        ...characterArtifact("alpha"),
        id: "plugin-1",
        key: "plugin:official.mvu-zod",
        kind: "plugin",
        name: "plugin",
        content: JSON.stringify({ plugin_id: "official.mvu-zod", schema_version: 1, proposal: {} }),
        content_hash: contentHash("plugin-1"),
        revision: contentHash("plugin-1"),
      };
      const scope = deriveArtifactCoverageScope(state, pluginArtifact);
      expect(scope.global).toBe(true);
      const resolutionIds = deriveArtifactScopeResolutionIds(state, pluginArtifact, formal2);
      expect(resolutionIds).toEqual([alphaRes.resolutions[0]!.id, betaRes.resolutions[0]!.id].sort());
    });

    it("produces deterministic resolution ordering and binding hashes", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha"), characterArtifact("beta")] });
      let state = await repository.read();
      const alphaRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.personality"], "authorize", "alpha", "typed", actorInput, "op-dec-1", "alpha");
      state = alphaRes.state;
      const betaRes = recordUserDecisionAndResolution(state, "creative_completion", ["req.appearance"], "authorize", "beta", "typed", actorInput, "op-dec-2", "beta");
      state = betaRes.state;
      const formal2 = runFormalCoverageAssessment(state, set, "op-b", "system");
      state = { ...state, coverage_assessments: [...state.coverage_assessments, formal2] };

      const binding1 = createCoverageBindingForArtifact(state, characterArtifact("alpha"), "director");
      const binding2 = createCoverageBindingForArtifact(state, characterArtifact("alpha"), "director");
      expect(binding1).toBeDefined();
      expect(binding2).toBeDefined();
      expect(binding1!.resolution_ids).toEqual(binding2!.resolution_ids);
      expect(binding1!.input_snapshot_hash).toBe(binding2!.input_snapshot_hash);
      expect(binding1!.resolution_ids).toEqual([alphaRes.resolutions[0]!.id]);
    });
  });

  describe("#1 typed authoring atomic binding", () => {
    it("creates artifact and binding in one transaction for typed character templates", async () => {
      const { repository } = await coverageWorkflowState({ operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      const result = await service.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const after = await repository.read();
      const created = after.artifacts.find((artifact) => artifact.id === result.artifact_id);
      expect(created).toBeDefined();
      expect(after.coverage_authoring_bindings).toHaveLength(1);
      const binding = after.coverage_authoring_bindings[0]!;
      expect(binding.artifact_id).toBe(result.artifact_id);
      expect(binding.artifact_revision).toBe(created!.revision);
      expect(after.audit.some((event) => event.event === "template.created" && String(event.details?.artifact_id) === result.artifact_id)).toBe(true);
    });

    it("replays the same command without duplicating bindings", async () => {
      const { repository } = await coverageWorkflowState({ operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      const proposal = { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } };
      const first = await service.createTemplate("op-t1", proposal, actorInput);
      const second = await service.createTemplate("op-t1", proposal, actorInput);
      expect(second.artifact_id).toBe(first.artifact_id);
      const after = await repository.read();
      expect(after.coverage_authoring_bindings).toHaveLength(1);
      expect(after.artifacts.filter((artifact) => artifact.kind === "character")).toHaveLength(1);
    });

    it("re-authoring the same content under a new assessment creates a new artifact and binding", async () => {
      const { repository, set } = await coverageWorkflowState({ operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      const proposal = { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } };
      const first = await service.createTemplate("op-t1", proposal, actorInput);

      const state = await repository.read();
      const recorded = recordUserDecisionAndResolution(state, "creative_completion", ["req.personality"], "authorize", "new", "typed", actorInput, "op-dec-new", "alpha");
      const formal2 = runFormalCoverageAssessment(recorded.state, set, "op-b", "system");
      await repository.commit(5, (current) => ({
        ...current,
        coverage_user_decisions: [...current.coverage_user_decisions, recorded.decision],
        coverage_resolutions: [...current.coverage_resolutions, ...recorded.resolutions],
        coverage_assessments: [...current.coverage_assessments, formal2],
      }));

      const second = await service.createTemplate("op-t1", proposal, actorInput);
      expect(second.artifact_id).not.toBe(first.artifact_id);
      const after = await repository.read();
      expect(after.coverage_authoring_bindings).toHaveLength(2);
      expect(after.coverage_authoring_bindings.some((binding) => binding.artifact_id === second.artifact_id)).toBe(true);
    });

    it("does not create bindings when the coverage workflow is not enabled", async () => {
      const repository = await baseRepository([acceptedAlphaFact], false, "character");
      await repository.commit(1, (state) => ({ ...state, operations: [...state.operations, operation("op-t1", "authoring")] }));
      const service = new AuthoringService(repository);
      const result = await service.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const after = await repository.read();
      expect(after.artifacts.some((artifact) => artifact.id === result.artifact_id)).toBe(true);
      expect(after.coverage_authoring_bindings).toHaveLength(0);
    });
  });

  describe("#3 active publish binding projection", () => {
    it("ignores historical bindings outside the plan", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      const result = await service.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const state = await repository.read();
      await repository.commit(5, (current) => ({
        ...current,
        coverage_authoring_bindings: [
          ...current.coverage_authoring_bindings,
          {
            id: "binding-historical",
            artifact_id: "character-gone",
            artifact_revision: "rev-gone",
            assessment_id: "old",
            assessment_revision: "old",
            requirement_set_revision: set.revision,
            fact_projection_revision: "fp",
            resolution_ids: [],
            input_snapshot_hash: "hash",
            created_by: "director",
            created_at: now,
          },
        ],
      }));
      const after = await repository.read();
      const plan = computeBuildPlan(after);
      const projection = projectActiveCoverageBindings(after, plan);
      expect(projection.some((item) => item.status === "missing")).toBe(false);
      expect(projection.some((item) => item.status === "current" && item.entry.artifact_id === result.artifact_id)).toBe(true);
    });

    it("keeps snapshot hashes stable across historical bindings", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      await service.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const state = await repository.read();
      const assessment = state.coverage_assessments.at(-1)!;
      const plan = computeBuildPlan(state);
      const before = buildCoverageSnapshot(state, assessment, plan);
      await repository.commit(5, (current) => ({
        ...current,
        coverage_authoring_bindings: [
          ...current.coverage_authoring_bindings,
          {
            id: "binding-historical",
            artifact_id: "character-gone",
            artifact_revision: "rev-gone",
            assessment_id: "old",
            assessment_revision: "old",
            requirement_set_revision: set.revision,
            fact_projection_revision: "fp",
            resolution_ids: [],
            input_snapshot_hash: "hash",
            created_by: "director",
            created_at: now,
          },
        ],
      }));
      const after = await repository.read();
      const afterAssessment = after.coverage_assessments.at(-1)!;
      const afterPlan = computeBuildPlan(after);
      const snapshot = buildCoverageSnapshot(after, afterAssessment, afterPlan);
      expect(snapshot.snapshot_hash).toBe(before.snapshot_hash);
      expect(snapshot.authoring_binding_ids).toEqual(before.authoring_binding_ids);
    });

    it("treats superseded revisions as missing", async () => {
      const { repository } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      const result = await service.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const state = await repository.read();
      const artifact = state.artifacts.find((item) => item.id === result.artifact_id)!;
      const newRevision = contentHash("new-content");
      const superseded = { ...artifact, id: "character-alpha-v2", revision: newRevision, content_hash: newRevision };
      await repository.commit(5, (current) => ({ ...current, artifacts: [...current.artifacts, superseded] }));
      const after = await repository.read();
      const plan = computeBuildPlan(after);
      const projection = projectActiveCoverageBindings(after, plan);
      expect(projection.find((item) => item.entry.artifact_id === "character-alpha-v2")?.status).toBe("missing");
      expect(projection.find((item) => item.entry.artifact_id === result.artifact_id)).toBeUndefined();
    });

    it("does not false-block removed characters", async () => {
      const { repository } = await coverageWorkflowState({ operations: [operation("op-t1", "authoring")] });
      const service = new AuthoringService(repository);
      const result = await service.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const state = await repository.read();
      const artifact = state.artifacts.find((item) => item.id === result.artifact_id)!;
      const removedPlan = computeBuildPlan({ ...state, artifacts: state.artifacts.filter((item) => item.id !== artifact.id) });
      const projection = projectActiveCoverageBindings({ ...state, artifacts: state.artifacts.filter((item) => item.id !== artifact.id) }, removedPlan);
      expect(projection).toHaveLength(0);
    });

    it("only includes plan entries for the selected mode", async () => {
      const repository = await baseRepository([acceptedAlphaFact]);
      await commitRun(repository, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
      const state = await repository.read();
      const set = buildDefaultRequirementSet(state, "director");
      const formal = runFormalCoverageAssessment(state, set, "op-a", "system");
      await commitAssessment(repository, 2, set, formal);
      const zhujiModule: ArtifactRecord = {
        ...characterArtifact("alpha"),
        id: "zhuji-1",
        key: "zhuji:alpha/appearance",
        kind: "zhuji",
        name: "alpha/appearance",
        content: JSON.stringify({ schema_version: 1, mode: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Tall." } } }),
        content_hash: contentHash("zhuji-1"),
        revision: contentHash("zhuji-1"),
      };
      const paletteModule: ArtifactRecord = {
        ...characterArtifact("beta"),
        id: "palette-1",
        key: "palette:beta/basic_information",
        kind: "palette",
        name: "beta/basic_information",
        content: JSON.stringify({ schema_version: 1, mode: "palette", character_id: "beta", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Beta info." } }),
        content_hash: contentHash("palette-1"),
        revision: contentHash("palette-1"),
      };
      await repository.commit(3, (current) => ({ ...current, artifacts: [...current.artifacts, zhujiModule, paletteModule] }));
      const after = await repository.read();
      const zhujiPlan = computeBuildPlan(after, "zhuji");
      expect(zhujiPlan.entries.some((entry) => entry.artifact_id === "zhuji-1")).toBe(true);
      expect(zhujiPlan.entries.some((entry) => entry.artifact_id === "palette-1")).toBe(false);
    });
  });

  describe("#2 preview and publish fail closed", () => {
    it("blocks preview when a sensitive artifact lacks a binding", async () => {
      const { repository } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-build", "build")] });
      const service = new BuildService(repository);
      const result = await service.run("op-build", "Preview current card", "writer");
      expect(result.status).toBe("blocked");
      const after = await repository.read();
      expect(after.builds.at(-1)?.status).toBe("failed");
      expect(after.builds.at(-1)?.diagnostics.join(" ")).toContain("COVERAGE_AUTHORING_BINDING_MISSING");
    });

    it("blocks publish when a sensitive artifact lacks a binding", async () => {
      const { repository } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-pub", "build")] });
      const service = new BuildService(repository);
      const result = await service.run("op-pub", "Publish current card", "writer");
      expect(result.status).toBe("blocked");
      const after = await repository.read();
      expect(after.publishes).toHaveLength(0);
      expect(after.audit.some((event) => event.event === "publish.gate_blocked")).toBe(true);
    });

    it("treats a binding with the wrong artifact revision as stale", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-build", "build")] });
      const state = await repository.read();
      const assessment = state.coverage_assessments.at(-1)!;
      const artifact = state.artifacts.find((item) => item.kind === "character")!;
      const binding = createCoverageBindingForArtifact(state, artifact, "director")!;
      await repository.commit(4, (current) => ({
        ...current,
        coverage_authoring_bindings: [{ ...binding, artifact_revision: contentHash("wrong-revision") }],
      }));
      const service = new BuildService(repository);
      const result = await service.run("op-build", "Preview current card", "writer");
      expect(result.status).toBe("blocked");
      const after = await repository.read();
      expect(after.builds.at(-1)?.diagnostics.join(" ")).toContain("COVERAGE_AUTHORING_BINDING_STALE");
    });

    it("blocks duplicate current bindings", async () => {
      const { repository } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-build", "build")] });
      const state = await repository.read();
      const artifact = state.artifacts.find((item) => item.kind === "character")!;
      const binding = createCoverageBindingForArtifact(state, artifact, "director")!;
      await repository.commit(4, (current) => ({
        ...current,
        coverage_authoring_bindings: [...current.coverage_authoring_bindings, binding, { ...binding, id: "binding-dup" }],
      }));
      const service = new BuildService(repository);
      const result = await service.run("op-build", "Preview current card", "writer");
      expect(result.status).toBe("blocked");
      const after = await repository.read();
      expect(after.builds.at(-1)?.diagnostics.join(" ")).toContain("COVERAGE_AUTHORING_BINDING_DUPLICATE");
    });

    it("passes with an exact current binding", async () => {
      const { repository, set } = await coverageWorkflowState({ characterArtifacts: [characterArtifact("alpha")], operations: [operation("op-t1", "authoring"), operation("op-build", "build")] });
      const authoring = new AuthoringService(repository);
      await authoring.createTemplate("op-t1", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } }, actorInput);
      const service = new BuildService(repository);
      const result = await service.run("op-build", "Preview current card", "writer");
      expect(result.status).toBe("completed");
      expect(set.revision.length).toBeGreaterThan(0);
    });

    it("keeps legacy projects without the coverage workflow on the existing path", async () => {
      const repository = await baseRepository([], false, "character");
      await repository.commit(1, (state) => ({
        ...state,
        artifacts: [...state.artifacts, characterArtifact("alpha")],
        operations: [...state.operations, operation("op-build", "build")],
      }));
      const service = new BuildService(repository);
      const result = await service.run("op-build", "Preview current card", "writer");
      expect(result.status).toBe("completed");
      const after = await repository.read();
      expect(after.builds.at(-1)?.diagnostics.join(" ")).not.toContain("COVERAGE_AUTHORING_BINDING");
    });
  });
});
