import {
  MemoryProjectRepository,
  contentHash,
  qualityProfileForLevel,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type FactReviewDecisionRecord,
  type OperationRecord,
} from "@st-workspace/core";

export interface ScenarioRosterEntry {
  id: string;
  label?: string;
  mode?: "zhuji" | "palette";
}

export interface ScenarioFact {
  statement: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: string;
  coverage?: string[];
  status: "accepted" | "candidate";
  fact_revision?: number;
}

export interface ProjectScenarioOptions {
  projectName?: string;
  projectId?: string;
  roster?: ScenarioRosterEntry[];
  primaryCharacterId?: string;
  sourceAdaptation?: boolean;
  acceptedFacts?: ScenarioFact[];
  candidateFacts?: ScenarioFact[];
  recoverableOperation?: boolean;
  outOfRosterCharacterId?: string;
}

export interface ProjectScenario {
  repository: MemoryProjectRepository;
  projectId: string;
  roster: ScenarioRosterEntry[];
  artifactIds: Record<string, string>;
  factIds: string[];
}

const ZHUJI_MODULE = "appearance";
const PALETTE_MODULE = "basic_information";

function hash(value: string): string {
  return contentHash(value);
}

function now(): string {
  return new Date().toISOString();
}

function zhujiContent(characterId: string): string {
  return JSON.stringify({
    schema_version: 1,
    mode: "zhuji",
    character_id: characterId,
    module: {
      schema_version: 1,
      mode: "zhuji",
      module: ZHUJI_MODULE,
      title: "外觀",
      data: { summary: "外觀描述" },
    },
  });
}

function paletteContent(characterId: string): string {
  return JSON.stringify({
    schema_version: 1,
    mode: "palette",
    character_id: characterId,
    module: {
      schema_version: 1,
      mode: "palette",
      module: PALETTE_MODULE,
      title: "基本資訊",
      content: "基本資訊描述",
    },
  });
}

function characterContent(id: string, displayName: string): string {
  return JSON.stringify({
    document: {
      schema_version: 1,
      id,
      display_name: displayName,
      aliases: [],
      summary: `${displayName} 的完整角色設定。`,
      relationships: [],
      sections: [{ id: "personality", content: "冷靜而直接。", provenance: [], extensions: {} }],
      provenance: [],
      extensions: {},
    },
  });
}

function modeArtifact(
  id: string,
  key: string,
  characterId: string,
  mode: "zhuji" | "palette",
  actor: string,
  operationId: string,
  extra?: Partial<ArtifactRecord>,
): ArtifactRecord {
  const content = mode === "zhuji" ? zhujiContent(characterId) : paletteContent(characterId);
  const item: ArtifactRecord = {
    id,
    key,
    kind: mode,
    name: `${characterId}/${mode === "zhuji" ? ZHUJI_MODULE : PALETTE_MODULE}`,
    content,
    media_type: "application/json",
    content_hash: hash(content),
    revision: hash(content),
    status: "draft",
    created_at: now(),
    updated_at: now(),
    created_by: actor,
    operation_id: operationId,
  };
  return { ...item, ...extra };
}

function characterArtifact(
  id: string,
  key: string,
  characterId: string,
  displayName: string,
  actor: string,
  operationId: string,
): ArtifactRecord {
  const content = characterContent(characterId, displayName);
  return {
    id,
    key,
    kind: "character",
    name: displayName,
    content,
    media_type: "application/json",
    content_hash: hash(content),
    revision: hash(content),
    status: "draft",
    created_at: now(),
    updated_at: now(),
    created_by: actor,
    operation_id: operationId,
  };
}

function factRecord(index: number, spec: ScenarioFact, createdBy: string, runId: string): FactRecord {
  const candidate_occurrence_id = `occ-${index}`;
  const id = `fact-${index}`;
  const fact: FactRecord = {
    id,
    candidate_occurrence_id,
    statement: spec.statement,
    ...(spec.subject === undefined ? {} : { subject: spec.subject }),
    ...(spec.predicate === undefined ? {} : { predicate: spec.predicate }),
    ...(spec.value === undefined ? {} : { value: spec.value }),
    ...(spec.classification === undefined ? {} : { classification: spec.classification as FactRecord["classification"] }),
    ...(spec.coverage === undefined ? {} : { coverage: spec.coverage }),
    status: spec.status,
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["source-1 — " + spec.statement],
    fact_revision: spec.fact_revision ?? 1,
    ...(spec.status === "accepted" ? { review_run_id: runId, decision_id: `decision-${index}` } : {}),
    created_at: now(),
    updated_at: now(),
    created_by: createdBy,
  };
  return fact;
}

function decisionRecord(fact: FactRecord, reviewer: string, runId: string): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id: fact.decision_id ?? `decision-${fact.id}`,
    operation_id: "op-fact-review",
    review_run_id: runId,
    candidate_occurrence_id: fact.candidate_occurrence_id ?? fact.id,
    fact_id: fact.id,
    reviewer_identity: reviewer,
    decision: "accepted",
    reason: "符合來源與品質標準。",
    evidence: [],
    candidate_revision: `rev-${fact.fact_revision ?? 1}`,
    expected_projection_revision: "projection-1",
    resulting_fact_revision: fact.fact_revision ?? 1,
    created_at: now(),
  };
}

function defaultRoster(): ScenarioRosterEntry[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `c${String(index + 1).padStart(2, "0")}`,
    label: `角色${index + 1}`,
    mode: index % 2 === 0 ? "zhuji" : "palette",
  }));
}

function defaultAcceptedFacts(): ScenarioFact[] {
  return [
    { statement: "角色一 個性沉穩。", subject: "c01", predicate: "個性", value: "沉穩", classification: "trait", coverage: ["personality"], status: "accepted", fact_revision: 1 },
    { statement: "角色二 與角色一 是摯友。", subject: "c02", predicate: "關係", value: "摯友", classification: "relationship", coverage: ["relationships"], status: "accepted", fact_revision: 1 },
  ];
}

function defaultCandidateFacts(): ScenarioFact[] {
  return [
    { statement: "角色三 喜歡天文。", subject: "c03", predicate: "喜好", value: "天文", classification: "trait", coverage: ["personality"], status: "candidate", fact_revision: 1 },
    { statement: "角色四 來自北方。", subject: "c04", predicate: "來歷", value: "北方", classification: "event", coverage: ["background"], status: "candidate", fact_revision: 1 },
  ];
}

/**
 * Builds a fully wired project scenario: recorded Blueprint precheck with a
 * mixed-mode roster, reviewed content artifacts, accepted/candidate facts with
 * matching review decisions, and an optional recoverable (fenced) operation.
 */
export async function projectScenario(options: ProjectScenarioOptions = {}): Promise<ProjectScenario> {
  const projectId = options.projectId ?? "scenario-project";
  const repository = new MemoryProjectRepository(projectId);
  const roster = options.roster ?? defaultRoster();
  const primaryCharacterId = options.primaryCharacterId ?? roster[0]?.id ?? "c01";
  const projectName = options.projectName ?? "情境專案";
  const timestamp = now();
  const actor = "writer";
  const operationId = "op-author";
  const precheckId = "precheck-scenario";
  const runId = "fact-run-1";

  const blueprintCandidate = {
    project_id: projectId,
    characters: roster.map((entry, index) => ({
      id: entry.id,
      ...(entry.label === undefined ? {} : { label: entry.label }),
      ordinal: index + 1,
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
    })),
    primary_character_id: primaryCharacterId,
    ...(options.sourceAdaptation === true ? { intent: "source_adaptation", source_adaptation: { subjects: roster.map((entry) => ({ character_id: entry.id, subject_name: entry.label ?? entry.id })) } } : {}),
    world: { enabled: false },
    relationships: { enabled: false },
  };
  const precheck: BlueprintPrecheckRecord = {
    id: precheckId,
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-interview",
    collaboration_mode: "assisted",
    candidate_blueprint: blueprintCandidate,
    candidate_blueprint_revision: hash(JSON.stringify(blueprintCandidate)),
    checks: [
      { subject_id: primaryCharacterId, dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
    ],
    status: "recorded",
    created_at: timestamp,
    created_by: "director",
  };

  const blueprintContent = JSON.stringify({
    kind: "blueprint",
    project_id: projectId,
    characters: roster.map((entry, index) => ({ id: entry.id, ...(entry.label === undefined ? {} : { label: entry.label }), ordinal: index + 1, ...(entry.mode === undefined ? {} : { mode: entry.mode }) })),
    primary_character_id: primaryCharacterId,
    ...(options.sourceAdaptation === true ? { intent: "source_adaptation", source_adaptation: { subjects: roster.map((entry) => ({ character_id: entry.id, subject_name: entry.label ?? entry.id })) } } : {}),
    blueprint_direction: { selected: "維持原有方向" },
  });
  const blueprintArtifact: ArtifactRecord = {
    id: "blueprint-scenario",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "情境 Blueprint",
    content: blueprintContent,
    media_type: "application/json",
    content_hash: hash(blueprintContent),
    revision: hash(blueprintContent),
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "director",
    operation_id: "op-interview",
    blueprint_precheck_id: precheckId,
    blueprint_precheck_revision: precheck.candidate_blueprint_revision,
  };

  const artifactIds: Record<string, string> = {};
  const artifacts: ArtifactRecord[] = [blueprintArtifact];
  roster.forEach((entry, index) => {
    const characterId = entry.id;
    const characterArtifactId = `character-${index + 1}`;
    const character = characterArtifact(characterArtifactId, `character:${characterId}`, characterId, entry.label ?? characterId, actor, operationId);
    artifactIds[character.key] = character.id;
    artifacts.push(character);
    const mode = entry.mode ?? "zhuji";
    const modeArtifactId = `mode-${index + 1}`;
    const item = modeArtifact(modeArtifactId, `${mode}:${characterId}/${mode === "zhuji" ? ZHUJI_MODULE : PALETTE_MODULE}`, characterId, mode, actor, operationId);
    artifactIds[item.key] = item.id;
    artifacts.push(item);
  });

  if (options.outOfRosterCharacterId !== undefined) {
    const outsiderId = options.outOfRosterCharacterId;
    const outsider = modeArtifact("mode-outsider", `zhuji:${outsiderId}/${ZHUJI_MODULE}`, outsiderId, "zhuji", actor, operationId);
    artifactIds[outsider.key] = outsider.id;
    artifacts.push(outsider);
  }

  const reviews: Array<{ id: string; artifact_id: string; artifact_revision: string; reviewer: string; status: "passed"; issue_ids: string[]; created_at: string }> =
    artifacts.filter((item) => item.kind !== "blueprint").map((item, index) => ({
      id: `review-${index + 1}`,
      artifact_id: item.id,
      artifact_revision: item.revision,
      reviewer: "character-critic",
      status: "passed" as const,
      issue_ids: [],
      created_at: timestamp,
    }));

  const acceptedFacts = (options.acceptedFacts ?? defaultAcceptedFacts()).map((spec, index) => factRecord(index + 1, spec, "fact-curator", runId));
  const candidateFacts = (options.candidateFacts ?? defaultCandidateFacts()).map((spec, index) => factRecord(index + 1 + acceptedFacts.length, spec, "fact-curator", runId));
  const facts = [...acceptedFacts, ...candidateFacts];
  const decisions: FactReviewDecisionRecord[] = acceptedFacts.map((fact) => decisionRecord(fact, "fact-reviewer-1", runId));

  const operations: OperationRecord[] = [
    { id: "op-interview", kind: "interview", request: "建立新專案", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] },
    { id: operationId, kind: "authoring", request: "Draft note: Create character: 情境角色", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] },
    { id: "op-fact-review", kind: "review", request: "Review fact candidates", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] },
  ];
  if (options.recoverableOperation === true) {
    operations.push({
      id: "op-recover",
      kind: "authoring",
      request: "Draft note: Create character: 復原角色",
      status: "running",
      actor: "worker",
      created_at: timestamp,
      updated_at: timestamp,
      progress: [],
      lease_owner: "worker",
      lease_token: "lease-token-1",
      lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      attempt: 1,
      execution_snapshot: {
        execution_agent_id: "director",
        execution_agent_role: "orchestrator",
        initiated_by: "writer",
        route_kind: "authoring",
        created_at: timestamp,
      },
    });
    const pendingContent = "Draft note: Create character: 復原角色。性格：沉著。";
    const pendingArtifact: ArtifactRecord = {
      id: "artifact-pending",
      key: "character:restored",
      kind: "character",
      name: "復原角色",
      content: pendingContent,
      media_type: "text/markdown",
      content_hash: hash(pendingContent),
      revision: hash(pendingContent),
      status: "draft",
      created_at: timestamp,
      updated_at: timestamp,
      created_by: "director",
      operation_id: "op-recover",
    };
    artifacts.push(pendingArtifact);
    artifactIds[pendingArtifact.key] = pendingArtifact.id;
  }

  await repository.commit(0, (state) => ({
    ...state,
    project_id: projectId,
    project_name: projectName,
    project_status: "ready" as const,
    interview: { ...state.interview, status: "complete" as const, flow: options.sourceAdaptation === true ? "source_adaptation" as const : "character" as const },
    quality_profile: qualityProfileForLevel("none"),
    blueprint_prechecks: [precheck],
    artifacts,
    reviews,
    facts,
    fact_review_decisions: decisions,
    operations,
    audit: [
      ...state.audit,
      {
        id: "audit-precheck",
        operation_id: "op-interview",
        event: "blueprint.precheck.recorded",
        actor: "director",
        occurred_at: timestamp,
        project_revision: 1,
        details: { precheck_id: precheckId },
      },
    ],
  }));

  return {
    repository,
    projectId,
    roster,
    artifactIds,
    factIds: facts.map((fact) => fact.id),
  };
}
