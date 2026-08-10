import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, createProjectState, type ArtifactRecord, type BlueprintPrecheckRecord, type ProjectRepository, type ZhujiProposalValue } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

function zhujiProposal(): ZhujiProposalValue {
  const instant = "這是一段符合語料條件、包含自然標點的角色話語。";
  return {
    kind: "zhuji",
    character_id: "yukino",
    module: {
      schema_version: 1,
      mode: "zhuji",
      module: "trait_dialogue",
      title: "特質對話",
      data: {
        人物說話節奏: "冷靜、直接，句子短而有明確停頓。",
        人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "精準詞彙", 方言痕跡: "無", 語氣助詞使用: "克制", 語言情感程度: "低調", 用詞程度選擇: "正式" },
        扮演關鍵要點: ["先觀察再回答"],
        Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["在壓力下保持清晰"], instant: [instant], Results: ["對話保持角色一致"] })),
      },
    },
  };
}

function blueprintArtifact(projectId: string, precheckId: string) {
  const content = JSON.stringify({ kind: "blueprint", project_id: projectId, blueprint_direction: { selected: "calm and direct" } });
  const hash = contentHash(content);
  return {
    id: "blueprint-artifact",
    key: `blueprint:${projectId}`,
    kind: "blueprint" as const,
    name: "project-blueprint",
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "director",
    operation_id: "interview",
    blueprint_precheck_id: precheckId,
    blueprint_precheck_revision: contentHash("candidate"),
  };
}

function modeArtifact(id: string, key: string, kind: "zhuji" | "palette", name: string, value: unknown): ArtifactRecord {
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id, key, kind, name, content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "creator", operation_id: "seed" };
}

describe("natural language runtime boundary", () => {
  it("runs a source request without project IDs or workflow parameters", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-1", title: "Official page", status: "pending", content: "canonical content" }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    await runtime.selectSourceCandidates([{ candidate_id: "candidate-1", decision: "approve" }], { actor: "director", attachments: [] });
    const result = await runtime.request("把批准的來源加入目前專案", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.completed).toEqual(["candidate-1"]);
  });

  it("does not start world authoring before source facts are reviewed", async () => {
    const repository = new MemoryProjectRepository("source-gated");
    const timestamp = new Date().toISOString();
    const candidateBlueprint = {
      flow: "source_adaptation",
      source_adaptation: { subject_name: "芙莉蓮", source_medium: "動漫", source_identifiers: ["葬送的芙莉蓮"] },
    };
    const precheck: BlueprintPrecheckRecord = {
      id: "source-precheck",
      schema_version: 1,
      project_id: "source-gated",
      operation_id: "source-interview",
      collaboration_mode: "free",
      candidate_blueprint: candidateBlueprint,
      candidate_blueprint_revision: contentHash(JSON.stringify(candidateBlueprint)),
      checks: [{ subject_id: "source-gated", dimension: "character_core", uncertainty: "low", impact: "low", basis: "source adaptation metadata captured", action: "safe_extension" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    const blueprint = blueprintArtifact("source-gated", precheck.id);
    const blueprintContent = JSON.stringify({ kind: "blueprint", project_id: "source-gated", ...candidateBlueprint });
    const blueprintRevision = contentHash(blueprintContent);
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { schema_version: 1, status: "complete", flow: "source_adaptation", answers: [], values: {} },
      blueprint_prechecks: [precheck],
      artifacts: [{ ...blueprint, content: blueprintContent, content_hash: blueprintRevision, revision: blueprintRevision }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.submitTemplateProposal({
      kind: "world",
      entries: [{ schema_version: 1, id: "magic-system", category: "systems", title: "魔法規則", content: "魔法遵循清楚且可追溯的規則。" }],
    }, { actor: "world-lore-creator", attachments: [] })).rejects.toMatchObject({ code: "SOURCE_FACTS_REQUIRED" });
  });

  it("returns one recoverable question for an unknown goal", async () => {
    const runtime = new WorkspaceRuntime(new MemoryProjectRepository("demo"));
    const result = await runtime.request("幫我處理一下", { actor: "director", attachments: [] });
    expect(result.status).toBe("needs_input");
    expect(result.question).toContain("描述");
  });

  it("configures quality through a compact preset and persists its snapshot", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.configureQualityProfile("strict", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    expect((await repository.read()).quality_profile).toMatchObject({ level: "strict", blocking_severity: "warning" });
    expect((await repository.read()).quality_profile.policy_snapshot).toMatchObject({ level: "strict", captured_by: "director" });
    const naturalLanguage = await runtime.request("quality none", { actor: "director", attachments: [] });
    expect(naturalLanguage.status).toBe("completed");
    expect((await repository.read()).quality_profile.blocking_severity).toBe("none");
  });

  it("persists an assisted-mode blueprint precheck after interview completion", async () => {
    const repository = new MemoryProjectRepository("assisted-demo");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "interviewing",
      interview: {
        schema_version: 1,
        status: "active",
        flow: "character",
        current: { id: "additional_settings", text: "confirm", kind: "confirmation", options: ["no"] },
        answers: [],
        values: { concept: "core", background: "background", personality: "personality", authoring_mode: "palette", collaboration_mode: "assisted" },
      },
      operations: [{ id: "interview-assisted", kind: "interview", request: "project interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const result = await new WorkspaceRuntime(repository, { interviewRequired: true }).answerInterview("no", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    expect((await repository.read()).blueprint_prechecks[0]).toMatchObject({ collaboration_mode: "assisted", status: "recorded" });
  });

  it("pauses assisted mode for an unresolved high-impact precheck and resumes after confirmation", async () => {
    const repository = new MemoryProjectRepository("assisted-block");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "interviewing",
      interview: { schema_version: 1, status: "active", flow: "character", current: { id: "additional_settings", text: "confirm", kind: "confirmation", options: ["no"] }, answers: [], values: { collaboration_mode: "assisted" } },
      operations: [{ id: "interview-block", kind: "interview", request: "project interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    const paused = await runtime.answerInterview("no", { actor: "user", attachments: [] });
    expect(paused.status).toBe("needs_input");
    expect((await repository.read()).blueprint_prechecks[0]?.status).toBe("needs_input");
    for (let index = 0; index < 4; index += 1) {
      const step = await runtime.answerInterview("確認", { actor: "user", attachments: [] });
      expect(step.status).toBe(index === 3 ? "completed" : "needs_input");
    }
  });

  it("keeps legacy completed intake safe when collaboration and direction provenance are absent", async () => {
    const repository = new MemoryProjectRepository("legacy-complete");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "interviewing",
      interview: {
        schema_version: 1,
        status: "active",
        flow: "character",
        current: { id: "additional_settings", text: "confirm", kind: "confirmation", options: ["no"] },
        answers: [],
        values: { concept: "legacy core", blueprint_direction: "legacy direction" },
      },
      operations: [{ id: "legacy-interview", kind: "interview", request: "interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const result = await new WorkspaceRuntime(repository, { interviewRequired: true }).answerInterview("no", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.blueprint_prechecks[0]).toMatchObject({ collaboration_mode: "free", status: "recorded" });
    expect((state.blueprint_prechecks[0]?.candidate_blueprint.blueprint_direction as { selected_at?: string }).selected_at).toBeUndefined();
    expect(state.artifacts).toHaveLength(1);
  });

  it("preserves Blueprint direction provenance after the user requests another option set", async () => {
    const repository = new MemoryProjectRepository("direction-retry");
    const retryAt = "2026-08-09T00:00:00.000Z";
    const selectedAt = "2026-08-09T00:00:01.000Z";
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "interviewing",
      interview: {
        schema_version: 1,
        status: "active",
        flow: "character",
        current: { id: "additional_settings", text: "confirm", kind: "confirmation", options: ["no"] },
        answers: [
          { question_id: "blueprint_direction", answer: "再給幾個", actor: "user", occurred_at: retryAt },
          { question_id: "blueprint_direction", answer: "柔和但有界線", actor: "user", occurred_at: selectedAt },
        ],
        values: { concept: "core", blueprint_direction: "柔和但有界線", collaboration_mode: "free" },
      },
      operations: [{ id: "direction-retry-interview", kind: "interview", request: "project interview", status: "needs_input", created_at: retryAt, updated_at: retryAt, progress: [] }],
    }));
    const result = await new WorkspaceRuntime(repository, { interviewRequired: true }).answerInterview("no", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const precheck = (await repository.read()).blueprint_prechecks[0];
    expect(precheck?.candidate_blueprint.blueprint_direction).toMatchObject({ scope: "character_setting", selected: "柔和但有界線", character_setting_direction: "柔和但有界線", selected_at: selectedAt });
    expect((precheck?.candidate_blueprint.blueprint_direction as { history?: unknown[] }).history).toHaveLength(2);
  });

  it("hides a legacy adult self-introduction question at the runtime boundary", async () => {
    const repository = new MemoryProjectRepository("legacy-sensitive");
    await repository.commit(0, (state) => ({
      ...state,
      interview: {
        schema_version: 1,
        status: "active",
        flow: "character",
        current: { id: "zhuji_intro:性相關", text: "legacy", kind: "self_introduction", min_length: 30 },
        answers: [],
        values: {},
      },
    }));
    const context = await new WorkspaceRuntime(repository, { interviewRequired: true }).interviewContext();
    expect(context.question?.id).toBe("concept");
  });

  it("lets assisted mode confirm a recoverable precheck without restarting intake", async () => {
    const repository = new MemoryProjectRepository("assisted-confirm");
    const base = createProjectState("assisted-confirm");
    const timestamp = new Date().toISOString();
    const pending: BlueprintPrecheckRecord = {
      id: "precheck-pending",
      schema_version: 1,
      project_id: "assisted-confirm",
      operation_id: "interview-pending",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "assisted-confirm" },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "assisted-confirm", dimension: "character_core", uncertainty: "high", impact: "high", basis: "needs confirmation", action: "user_confirmed", user_answer: "pending confirmation" }],
      status: "needs_input",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, () => ({
      ...base,
      project_status: "interviewing",
      interview: { schema_version: 1, status: "complete", flow: "character", answers: [], values: {} },
      blueprint_prechecks: [pending],
      operations: [{ id: "interview-pending", kind: "interview", request: "project interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const first = await new WorkspaceRuntime(repository, { interviewRequired: true }).answerInterview("use the explicit core", { actor: "user", attachments: [] });
    expect(first.status).toBe("needs_input");
    const result = await new WorkspaceRuntime(repository, { interviewRequired: true }).answerInterview("確認", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    expect((await repository.read()).blueprint_prechecks[0]?.status).toBe("recorded");
  });

  it("does not let authoring bypass a pending blueprint precheck", async () => {
    const repository = new MemoryProjectRepository("precheck-gate");
    const timestamp = new Date().toISOString();
    const pending: BlueprintPrecheckRecord = {
      id: "precheck-gate",
      schema_version: 1,
      project_id: "precheck-gate",
      operation_id: "interview-gate",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "precheck-gate" },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "precheck-gate", dimension: "character_core", uncertainty: "high", impact: "high", basis: "needs confirmation", action: "user_confirmed", user_answer: "pending confirmation" }],
      status: "needs_input",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "interviewing",
      interview: { schema_version: 1, status: "complete", flow: "character", answers: [], values: {} },
      blueprint_prechecks: [pending],
      operations: [{ id: "interview-gate", kind: "interview", request: "interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.submitZhujiProposal(zhujiProposal(), { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_REQUIRED" });
    await expect(runtime.request("Create character: Bypass. Personality: calm.", { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "BLUEPRINT_PRECHECK_REQUIRED" });
    expect((await repository.read()).artifacts).toHaveLength(0);
  });

  it("requires a confirmed Blueprint and enforces module order for interview-backed authoring", async () => {
    const repository = new MemoryProjectRepository("blueprint-order");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-recorded",
      schema_version: 1,
      project_id: "blueprint-order",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "blueprint-order", blueprint_direction: { selected: "calm" } },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "blueprint-order", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      operations: [{ id: "interview", kind: "interview", request: "interview", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.submitZhujiProposal(zhujiProposal(), { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "BLUEPRINT_REQUIRED" });
    const blueprint = blueprintArtifact("blueprint-order", precheck.id);
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      artifacts: [blueprint, {
        ...blueprint,
        id: "malformed-zhuji",
        key: "zhuji:demo/appearance",
        kind: "zhuji" as const,
        name: "demo/appearance",
        content: "not-json",
        content_hash: contentHash("not-json"),
        revision: contentHash("not-json"),
      }],
    }));
    await expect(runtime.submitZhujiProposal(zhujiProposal(), { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "AUTHORING_PREVIOUS_MODULE_REQUIRED" });
    const paletteResult = await runtime.submitTemplateProposal({
      kind: "palette",
      character_id: "demo",
      module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "A calm baseline." },
    }, { actor: "palette-creator", attachments: [] });
    expect(paletteResult.status).toBe("completed");
    const final = await repository.read();
    expect(final.artifacts).toHaveLength(3);
    expect(final.artifacts.at(-1)).toMatchObject({ kind: "palette", blueprint_precheck_id: precheck.id });
  });

  it("keeps published snapshots and creates a Blueprint successor for direction edits", async () => {
    const repository = new MemoryProjectRepository("published-blueprint");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-published",
      schema_version: 1,
      project_id: "published-blueprint",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "published-blueprint", flow: "character", blueprint_direction: { selected: "calm" }, intake_values: { blueprint_direction: "calm" } },
      candidate_blueprint_revision: contentHash("candidate-published"),
      checks: [{ subject_id: "published-blueprint", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    const originalBlueprint = blueprintArtifact("published-blueprint", precheck.id);
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "published",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [originalBlueprint],
      publishes: [{ id: "publish-1", operation_id: "publish-operation", artifact_ids: [originalBlueprint.id], content: "{}", content_hash: contentHash("{}"), created_at: timestamp }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    const proposed = await runtime.request("修改 Blueprint 方向：更溫柔但保留清楚界線", { actor: "user", attachments: [] });
    expect(proposed.status).toBe("needs_input");
    expect((await repository.read()).publishes).toHaveLength(1);
    expect((await repository.read()).blueprint_prechecks.at(-1)?.status).toBe("needs_input");
    const firstConfirm = await runtime.request("確認", { actor: "user", attachments: [] });
    expect(firstConfirm.status).toBe("needs_input");
    const confirmed = await runtime.request("確認", { actor: "user", attachments: [] });
    expect(confirmed.status).toBe("completed");
    const state = await repository.read();
    expect(state.project_status).toBe("ready");
    expect(state.publishes).toHaveLength(1);
    expect(state.artifacts).toHaveLength(2);
    expect(state.artifacts.at(-1)?.based_on).toBe(originalBlueprint.revision);
    const secondProposed = await runtime.request("更新 Blueprint 方向：保留柔和基調但更明確", { actor: "user", attachments: [] });
    expect(secondProposed.status).toBe("needs_input");
    expect((await runtime.request("好", { actor: "user", attachments: [] })).status).toBe("needs_input");
    expect((await runtime.request("好", { actor: "user", attachments: [] })).status).toBe("completed");
    const revisedState = await repository.read();
    const fallbackProposed = await runtime.request("change Blueprint direction", { actor: "user", attachments: [] });
    expect(fallbackProposed.status).toBe("needs_input");
    expect((await runtime.request("confirm", { actor: "user", attachments: [] })).status).toBe("needs_input");
    expect((await runtime.request("confirm", { actor: "user", attachments: [] })).status).toBe("completed");
    const fallbackState = await repository.read();
    expect(JSON.parse(fallbackState.artifacts.at(-1)!.content)).toMatchObject({ blueprint_direction: { selected: "change Blueprint direction" } });
    expect(revisedState.artifacts).toHaveLength(3);
    expect(JSON.parse(revisedState.artifacts.at(-1)!.content)).toMatchObject({ blueprint_direction: { scope: "character_setting", selected: "保留柔和基調但更明確", character_setting_direction: "保留柔和基調但更明確" } });
  });

  it("revises only the addressed character direction in a multi-character Blueprint", async () => {
    const repository = new MemoryProjectRepository("published-multi-blueprint");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-multi-published",
      schema_version: 1,
      project_id: "published-multi-blueprint",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: {
        project_id: "published-multi-blueprint",
        flow: "character",
        characters: [
          { id: "character-1", label: "甲", ordinal: 1, direction: { selected: "甲舊方向", history: [] } },
          { id: "character-2", label: "乙", ordinal: 2, direction: { selected: "乙舊方向", history: [] } },
        ],
        intake_values: {},
      },
      candidate_blueprint_revision: contentHash("candidate-multi-published"),
      checks: [
        { subject_id: "character-1", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
        { subject_id: "character-2", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
      ],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    const originalBlueprint = blueprintArtifact("published-multi-blueprint", precheck.id);
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "published",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [originalBlueprint],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.request("修改甲的 Blueprint 方向：甲的新方向", { actor: "user", attachments: [] })).resolves.toMatchObject({ status: "needs_input" });
    await expect(runtime.request("確認", { actor: "user", attachments: [] })).resolves.toMatchObject({ status: "needs_input" });
    await expect(runtime.request("確認", { actor: "user", attachments: [] })).resolves.toMatchObject({ status: "completed" });
    const state = await repository.read();
    const revised = JSON.parse(state.artifacts.at(-1)!.content) as { characters: Array<{ id: string; direction?: { selected?: string } }> };
    expect(revised.characters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "character-1", direction: expect.objectContaining({ selected: "甲的新方向" }) }),
      expect.objectContaining({ id: "character-2", direction: expect.objectContaining({ selected: "乙舊方向" }) }),
    ]));
  });

  it("reports a recoverable error when a published project has no prior Blueprint", async () => {
    const repository = new MemoryProjectRepository("no-blueprint");
    await repository.commit(0, (state) => ({ ...state, project_status: "published", interview: { ...state.interview, status: "complete" } }));
    await expect(new WorkspaceRuntime(repository, { interviewRequired: true }).request("修改 Blueprint 方向：新的方向", { actor: "user", attachments: [] })).rejects.toMatchObject({ code: "BLUEPRINT_REQUIRED" });
  });

  it("rethrows unexpected interview engine failures instead of misclassifying them", async () => {
    const malformed = createProjectState("malformed");
    malformed.interview = { schema_version: 1, status: "active", flow: "new_project", current: null as never, answers: [], values: {} };
    malformed.operations = [{ id: "interview-malformed", kind: "interview", request: "interview", status: "needs_input", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }];
    const repository: ProjectRepository = {
      read: async () => malformed,
      commit: async () => malformed,
    };
    await expect(new WorkspaceRuntime(repository).answerInterview("answer", { actor: "user", attachments: [] })).rejects.toThrow();
  });

  it("registers candidates from a search without exposing candidate IDs", async () => {
    const runtime = new WorkspaceRuntime(new MemoryProjectRepository("demo"), {
      searcher: async () => [{ title: "Official page", url: "https://example.test/official", snippet: "official" }],
    });
    const result = await runtime.request("搜尋官方來源", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.summary).toContain("1 個候選來源");
  });

  it("resumes the same operation when the user supplies an attachment", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const first = await runtime.request("把來源加入目前專案", { actor: "director", attachments: [] });
    expect(first.status).toBe("needs_input");
    const second = await runtime.request("這是來源檔案", {
      actor: "director",
      attachments: [{ name: "official.txt", content: new TextEncoder().encode("resumed content") }],
    });
    expect(second.status).toBe("completed");
    expect(second.operation_id).toBe(first.operation_id);
    expect((await repository.read()).sources[0]?.canonical_text).toBe("resumed content");
  });

  it("accepts a first-time attachment without a candidate ID", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.request("把這個檔案加入來源", {
      actor: "director",
      attachments: [{ name: "official.md", content: new TextEncoder().encode("attached source") }],
    });
    expect(result.status).toBe("completed");
    expect((await repository.read()).sources[0]?.canonical_text).toBe("attached source");
  });

  it("routes authoring and review through natural language only", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const created = await runtime.request("Create character: Yukino. Personality: calm, direct, and observant.", { actor: "writer", attachments: [] });
    expect(created.status).toBe("completed");
    expect((await repository.read()).artifacts[0]?.name).toBe("Yukino");
    const selfReview = await runtime.request("Review current character", { actor: "writer", attachments: [] });
    expect(selfReview.status).toBe("blocked");
    const peerReview = await runtime.request("Review current character", { actor: "reviewer", attachments: [] });
    expect(peerReview.status).toBe("completed");
    const reevaluate = await runtime.request("Re-evaluate quality profile", { actor: "reviewer", attachments: [] });
    expect(reevaluate.status).toBe("completed");
    expect((await repository.read()).reviews).toHaveLength(1);
  });

  it("asks for a source before knowledge refresh when none exists", async () => {
    const runtime = new WorkspaceRuntime(new MemoryProjectRepository("demo"));
    const result = await runtime.request("Refresh knowledge", { actor: "curator", attachments: [] });
    expect(result.status).toBe("needs_input");
    expect(result.question).toContain("來源");
  });

  it("routes preview, publish and import intents without low-level IDs", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    await runtime.request("Create character: Yukino. Personality: calm, direct, and observant.", { actor: "writer", attachments: [] });
    const preview = await runtime.request("Preview current card", { actor: "builder", attachments: [] });
    expect(preview.status).toBe("completed");
    const publish = await runtime.request("Publish current card", { actor: "publisher", attachments: [] });
    expect(publish.status).toBe("completed");
    const imported = await runtime.request("Import character card", { actor: "importer", attachments: [{ name: "card.json", content: new TextEncoder().encode(JSON.stringify({ name: "Imported", description: "A complete imported card" })) }] });
    expect(imported.status).toBe("completed");
    expect((await repository.read()).publishes).toHaveLength(1);
  });

  it("resumes a dual-mode build choice on the same operation and asks again for the next build", async () => {
    const repository = new MemoryProjectRepository("runtime-mode-choice");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Runtime Mode Choice",
      artifacts: [
        modeArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", {
          kind: "zhuji",
          character_id: "demo",
          module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } },
        }),
        modeArtifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", {
          kind: "palette",
          character_id: "demo",
          module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" },
        }),
      ],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const first = await runtime.request("Preview current card", { actor: "builder", attachments: [] });
    expect(first.status).toBe("needs_input");
    const invalid = await runtime.request("我還沒決定", { actor: "builder", attachments: [] });
    expect(invalid.status).toBe("needs_input");
    expect(invalid.operation_id).toBe(first.operation_id);
    const selected = await runtime.request("珠璣", { actor: "builder", attachments: [] });
    expect(selected.status).toBe("completed");
    expect(selected.operation_id).toBe(first.operation_id);
    expect(selected.completed).toHaveLength(1);
    expect((await repository.read()).builds).toHaveLength(1);

    const next = await runtime.request("Preview current card", { actor: "builder", attachments: [] });
    expect(next.status).toBe("needs_input");
    expect(next.operation_id).not.toBe(first.operation_id);
    expect((await repository.read()).builds).toHaveLength(1);
  });

  it("reports active operation status and rejects empty requests", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    await expect(runtime.request("", { actor: "director", attachments: [] })).rejects.toMatchObject({ code: "REQUEST_EMPTY" });
    const result = await runtime.request("an unclear request", { actor: "director", attachments: [] });
    expect(result.status).toBe("needs_input");
    expect((await runtime.status()).status).toBe("needs_input");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: state.operations.map((operation) => ({ ...operation, status: "completed" as const })) }));
    expect((await runtime.status()).status).toBe("completed");
  });

  it("exposes Zhuji context and writes a validated module through the creator route", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const before = await runtime.zhujiContext("yukino");
    expect(before.context.module_order).toEqual(["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"]);
    expect(JSON.stringify(before.schema)).toContain("trait_dialogue");
    expect(before.context.existing).toHaveLength(0);
    const result = await runtime.submitZhujiProposal(zhujiProposal(), { actor: "zhuji-creator", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.agent_id).toBe("zhuji-creator");
    const after = await runtime.zhujiContext("yukino");
    expect(after.context.existing).toHaveLength(1);
    expect(after.context.existing[0]?.module).toBe("trait_dialogue");
    expect((await runtime.zhujiContext()).context.existing).toHaveLength(1);
    expect((await runtime.zhujiContext("other")).context.existing).toHaveLength(0);
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      artifacts: [...current.artifacts, { id: "artifact-invalid-zhuji", key: "zhuji:invalid", kind: "zhuji" as const, name: "invalid", content: "not-json", media_type: "application/json", content_hash: contentHash("not-json"), revision: contentHash("not-json"), status: "draft" as const, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "test", operation_id: after.context.existing[0]?.artifact_id ?? "operation_missing" }],
    }));
    expect((await runtime.zhujiContext()).context.existing).toHaveLength(1);
    await expect(runtime.submitZhujiProposal({ kind: "zhuji", character_id: "yukino", module: { module: "bad" } }, { actor: "zhuji-creator", attachments: [] })).rejects.toMatchObject({ code: "ZHUJI_SCHEMA_INVALID" });
  });

  it("replays a persisted typed template proposal without duplicating the domain result", async () => {
    const repository = new MemoryProjectRepository("replay-template");
    const runtime = new WorkspaceRuntime(repository);
    const palette = {
      kind: "palette" as const,
      character_id: "demo",
      module: { schema_version: 1 as const, mode: "palette" as const, module: "basic_information" as const, title: "Basic information", content: "A calm character." },
    };
    const submitted = await runtime.submitTemplateProposal(palette, { actor: "palette-creator", attachments: [] });
    expect(submitted.status).toBe("completed");
    expect((await repository.read()).artifacts).toHaveLength(1);
    const operationId = submitted.operation_id;
    const state = await repository.read();
    expect(state.operations[0]?.command).toMatchObject({ version: 1, type: "template_proposal" });
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId ? { ...item, status: "running", updated_at: new Date().toISOString() } : item),
    }));
    const recovered = await runtime.recoverOperation(operationId, { actor: "palette-creator", attachments: [] }, { agent: "palette-creator" });
    expect(recovered.status).toBe("completed");
    expect((await repository.read()).artifacts).toHaveLength(1);
    expect((await repository.read()).operations.find((item) => item.id === operationId)?.status).toBe("completed");
  });

  it("replays an import operation from its persisted attachment references", async () => {
    const repository = new MemoryProjectRepository("replay-import");
    const runtime = new WorkspaceRuntime(repository);
    const content = JSON.stringify({ name: "Replayed", description: "A complete card" });
    const first = await runtime.request("Import character card", {
      actor: "importer",
      attachments: [{ name: "card.json", content: new TextEncoder().encode(content), media_type: "application/json" }],
    });
    expect(first.status).toBe("completed");
    const operationId = first.operation_id;
    let state = await repository.read();
    expect(state.operations[0]?.command?.attachment_refs).toHaveLength(1);
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId ? { ...item, status: "running", updated_at: new Date().toISOString() } : item),
    }));
    const recovered = await runtime.recoverOperation(operationId, { actor: "importer", attachments: [] });
    expect(recovered.status).toBe("completed");
    state = await repository.read();
    expect(state.imports.filter((item) => item.operation_id === operationId)).toHaveLength(1);
    expect(state.operations.find((item) => item.id === operationId)?.status).toBe("completed");
  });

  it("appends audit events when confirming an assisted precheck instead of replacing history", async () => {
    const repository = new MemoryProjectRepository("audit-append");
    const base = createProjectState("audit-append");
    const timestamp = new Date().toISOString();
    const pending: BlueprintPrecheckRecord = {
      id: "precheck-pending-audit",
      schema_version: 1,
      project_id: "audit-append",
      operation_id: "interview-pending-audit",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "audit-append" },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "audit-append", dimension: "character_core", uncertainty: "high", impact: "high", basis: "needs confirmation", action: "user_confirmed", user_answer: "pending confirmation" }],
      status: "needs_input",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, () => ({
      ...base,
      project_status: "interviewing",
      interview: { schema_version: 1, status: "complete", flow: "character", answers: [], values: {} },
      blueprint_prechecks: [pending],
      operations: [{ id: "interview-pending-audit", kind: "interview", request: "project interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
      audit: [
        { id: "audit-1", operation_id: "first", event: "interview.started", actor: "user", occurred_at: timestamp, project_revision: 1, details: {} },
        { id: "audit-2", operation_id: "first", event: "interview.answer.recorded", actor: "user", occurred_at: timestamp, project_revision: 2, details: {} },
      ],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    const first = await runtime.answerInterview("use the explicit core", { actor: "user", attachments: [] });
    expect(first.status).toBe("needs_input");
    const result = await runtime.answerInterview("確認", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.audit.length).toBeGreaterThan(2);
    expect(state.audit.map((event) => event.id)).toEqual(expect.arrayContaining(["audit-1", "audit-2"]));
  });

  it("supplements a pending precheck item and recomputes the candidate Blueprint revision", async () => {
    const repository = new MemoryProjectRepository("supplement-confirm");
    const base = createProjectState("supplement-confirm");
    const timestamp = new Date().toISOString();
    const pending: BlueprintPrecheckRecord = {
      id: "precheck-supplement",
      schema_version: 1,
      project_id: "supplement-confirm",
      operation_id: "interview-supplement",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "supplement-confirm", characters: [{ id: "character-1", label: "角色", ordinal: 1 }], intake_values: {} },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "character-1", dimension: "character_core", uncertainty: "high", impact: "high", basis: "no core recorded", action: "user_confirmed", user_answer: "pending confirmation", intake_key: "concept:character-1" }],
      status: "needs_input",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, () => ({
      ...base,
      project_status: "interviewing",
      interview: { schema_version: 1, status: "complete", flow: "character", answers: [], values: {} },
      blueprint_prechecks: [pending],
      operations: [{ id: "interview-supplement", kind: "interview", request: "project interview", status: "needs_input", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    const first = await runtime.answerInterview("確認", { actor: "user", attachments: [] });
    expect(first.status).toBe("needs_input");
    const result = await runtime.answerInterview("補充：角色核心是穩重而可靠", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    const recorded = state.blueprint_prechecks[0]!;
    expect(recorded.status).toBe("recorded");
    expect(recorded.candidate_blueprint_revision).not.toBe(contentHash("candidate"));
    const intake = (recorded.candidate_blueprint as { intake_values?: Record<string, unknown> }).intake_values;
    expect(intake?.["concept:character-1"]).toBe("補充：角色核心是穩重而可靠");
    expect(recorded.checks[0]?.user_answer).toBe("補充：角色核心是穩重而可靠");
    expect(state.artifacts).toHaveLength(1);
  });

  it("merges a character expansion interview into the existing Blueprint roster", async () => {
    const repository = new MemoryProjectRepository("expansion-merge");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    const firstPass = [
      "角色設定",
      "單角色卡",
      "完全原創",
      "雪乃",
      "palette",
      "雪乃的角色概念",
      "雪乃的背景",
      "雪乃的性格",
      "我直接命名",
      "測試專案",
      "不需要",
      "冷靜而可靠",
      "自由創作",
      "不需要",
    ];
    for (const answer of firstPass) {
      const step = await runtime.answerInterview(answer, { actor: "user", attachments: [] });
      if (step.status === "completed") break;
    }
    let state = await repository.read();
    expect(state.artifacts.filter((item) => item.kind === "blueprint")).toHaveLength(1);
    const interview = state.interview;
    await repository.commit(state.revision, (current) => ({
      ...current,
      interview: { ...interview, status: "idle", flow: "new_project", answers: [], values: {}, current: undefined, characters: undefined, active_character_id: undefined },
    }));
    const restarted = await runtime.startInterview("重新開始訪談", { actor: "user", attachments: [] });
    expect(restarted.status).toBe("needs_input");
    const expansionPass = [
      "擴充既有角色卡",
      "小町",
      "小町的角色概念",
      "小町的背景",
      "小町的性格",
      "zhuji",
      "關係已整理",
      "擴充後專案",
      "不需要",
      "維持原有方向",
      "自由創作",
      "不需要",
    ];
    for (const answer of expansionPass) {
      const step = await runtime.answerInterview(answer, { actor: "user", attachments: [] });
      if (step.status === "completed") break;
    }
    state = await repository.read();
    const blueprints = state.artifacts.filter((item) => item.kind === "blueprint");
    expect(blueprints).toHaveLength(2);
    const merged = JSON.parse(blueprints[blueprints.length - 1]!.content) as {
      characters?: Array<{ id?: unknown; display_name?: unknown; mode?: unknown }>;
      primary_character_id?: unknown;
    };
    expect(merged.characters?.map((character) => character.id)).toEqual(["character-1", "character-2"]);
    expect(merged.characters?.[0]?.display_name).toBe("雪乃");
    expect(merged.characters?.[1]?.display_name).toBe("小町");
    expect(merged.characters?.[1]?.mode).toBe("zhuji");
    expect(merged.primary_character_id).toBe("character-1");
  });
});
