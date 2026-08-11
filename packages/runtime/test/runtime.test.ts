import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { CoreError, MemoryProjectRepository, contentHash, createProjectState, type ArtifactRecord, type BlueprintPrecheckRecord, type ProjectRepository, type ZhujiProposalValue } from "@st-workspace/core";
import { encodePngChunk, pngSignature } from "@st-workspace/adapters-png";
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
    const baseBlueprint = blueprintArtifact("blueprint-order", precheck.id);
    const blueprintContent = JSON.stringify({
      kind: "blueprint",
      project_id: "blueprint-order",
      blueprint_direction: { selected: "calm and direct" },
      characters: [
        { id: "yukino", label: "雪之下", ordinal: 1, mode: "zhuji" },
        { id: "demo", label: "Demo", ordinal: 2, mode: "palette" },
      ],
    });
    const blueprintHash = contentHash(blueprintContent);
    const blueprint = {
      ...baseBlueprint,
      content: blueprintContent,
      content_hash: blueprintHash,
      revision: blueprintHash,
    };
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

  it("rejects authoring for a character outside the Blueprint roster", async () => {
    const repository = new MemoryProjectRepository("roster-check");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-roster",
      schema_version: 1,
      project_id: "roster-check",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "roster-check", characters: [{ id: "other", label: "Other", ordinal: 1, mode: "zhuji", display_name: "Other" }] },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "roster-check", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [blueprintArtifact("roster-check", precheck.id)],
      operations: [{ id: "interview", kind: "interview", request: "interview", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.submitZhujiProposal(zhujiProposal(), { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "BLUEPRINT_CHARACTER_NOT_IN_ROSTER" });
  });

  it("rejects authoring when the submitted mode mismatches the Blueprint mode", async () => {
    const repository = new MemoryProjectRepository("mode-mismatch");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-mismatch",
      schema_version: 1,
      project_id: "mode-mismatch",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "mode-mismatch", characters: [{ id: "yukino", label: "雪之下", ordinal: 1, mode: "palette", display_name: "雪之下" }] },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "mode-mismatch", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [blueprintArtifact("mode-mismatch", precheck.id)],
      operations: [{ id: "interview", kind: "interview", request: "interview", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const mismatchContent = JSON.stringify({ kind: "blueprint", project_id: "mode-mismatch", blueprint_direction: { selected: "calm and direct" }, characters: [{ id: "yukino", label: "雪之下", ordinal: 1, mode: "palette" }] });
    const mismatchHash = contentHash(mismatchContent);
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      artifacts: [{ ...state.artifacts[0]!, content: mismatchContent, content_hash: mismatchHash, revision: mismatchHash }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.submitZhujiProposal(zhujiProposal(), { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "BLUEPRINT_MODE_MISMATCH" });
  });

  it("does not count historical mode modules toward the previous-module gate", async () => {
    const repository = new MemoryProjectRepository("history-modules");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-history",
      schema_version: 1,
      project_id: "history-modules",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "history-modules", characters: [{ id: "yukino", label: "雪之下", ordinal: 1, mode: "zhuji", display_name: "雪之下" }] },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "history-modules", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    const oldAppearance = modeArtifact("zhuji-history-old", "zhuji:yukino/appearance", "zhuji", "yukino/appearance", { kind: "zhuji", character_id: "yukino", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", content: "Tall." } });
    const newAppearance = modeArtifact("zhuji-history-new", "zhuji:yukino/appearance", "zhuji", "yukino/appearance", { kind: "zhuji", character_id: "other", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", content: "Changed." } });
    const historyContent = JSON.stringify({ kind: "blueprint", project_id: "history-modules", blueprint_direction: { selected: "calm and direct" }, characters: [{ id: "yukino", label: "雪之下", ordinal: 1, mode: "zhuji" }] });
    const historyHash = contentHash(historyContent);
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [{ ...blueprintArtifact("history-modules", precheck.id), content: historyContent, content_hash: historyHash, revision: historyHash }, oldAppearance, newAppearance],
      operations: [{ id: "interview", kind: "interview", request: "interview", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await expect(runtime.submitZhujiProposal(zhujiProposal(), { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "AUTHORING_PREVIOUS_MODULE_REQUIRED" });
  });

  it("reports a package plan with current projections and mode-aware outputs", async () => {
    const repository = new MemoryProjectRepository("build-readiness");
    const timestamp = new Date().toISOString();
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-readiness",
      schema_version: 1,
      project_id: "build-readiness",
      operation_id: "interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "build-readiness", characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji", display_name: "Alpha" }, { id: "beta", label: "Beta", ordinal: 2, mode: "palette", display_name: "Beta" }] },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: timestamp,
      created_by: "director",
    };
    const characterContent = (id: string, displayName: string) => ({ kind: "character", document: { schema_version: 1, id, display_name: displayName, aliases: [], summary: "A complete character.", relationships: [], sections: [], provenance: [], extensions: {} } });
    const greetingContent = { document: { greetings: [{ kind: "primary", content: "First line.", character_ids: ["alpha"] }, { kind: "alternate", content: "Alt one." }, { kind: "alternate", content: "Alt two." }, { kind: "group_only", content: "Group." }] } };
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Readiness",
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [
        modeArtifact("character-alpha-r", "character:alpha", "character", "alpha", characterContent("alpha", "Alpha")),
        modeArtifact("character-beta-r", "character:beta", "character", "beta", characterContent("beta", "Beta")),
        modeArtifact("zhuji-alpha-r", "zhuji:alpha/appearance", "zhuji", "alpha/appearance", { kind: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", content: "Tall." } }),
        modeArtifact("greeting-readiness", "greeting:greetings", "greeting", "greetings", greetingContent),
      ],
      operations: [{ id: "interview", kind: "interview", request: "interview", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const readiness = await new WorkspaceRuntime(repository).buildReadiness();
    expect(readiness.modes).toEqual({ zhuji: true, palette: false });
    expect(readiness.primary_character).toMatchObject({ id: "alpha" });
    expect(readiness.greeting_entries).toBe(4);
    expect(readiness.alternate_greeting_count).toBe(2);
    expect(readiness.group_greeting_count).toBe(1);
    expect(readiness.first_greeting).toContain("First line.");
    expect(readiness.png_expected).toBe(true);
    expect(readiness.card_name).toBe("Readiness");
    expect(readiness.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "greeting", artifact_id: "greeting-readiness", revision: expect.any(String) }),
      expect.objectContaining({ kind: "zhuji", artifact_id: "zhuji-alpha-r", revision: expect.any(String) }),
    ]));
    expect(readiness.output_paths?.json).toBe("exports/Readiness-雙模式角色卡.json");
    expect(readiness.output_paths?.png).toBe("exports/Readiness-雙模式角色卡.png");
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
    const created = await runtime.submitTemplateProposal(
      { kind: "character", document: { schema_version: 1, id: "yukino", display_name: "Yukino", summary: "A calm character." } },
      { actor: "writer", attachments: [] },
    );
    expect(created.status).toBe("completed");
    expect((await repository.read()).artifacts[0]?.name).toBe("Yukino");
    await expect(runtime.request("Review current character", { actor: "writer", attachments: [] }, { agent: "director" })).rejects.toMatchObject({ code: "AGENT_CAPABILITY_DENIED" });
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
    await runtime.submitTemplateProposal(
      { kind: "character", document: { schema_version: 1, id: "yukino", display_name: "Yukino", summary: "A calm character." } },
      { actor: "writer", attachments: [] },
    );
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
      "測試專案",
      "小町",
      "小町的角色概念",
      "小町的背景",
      "小町的性格",
      "zhuji",
      "關係已整理",
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

  it("resumes a pending authoring operation from a later natural-language answer", async () => {
    const repository = new MemoryProjectRepository("runtime-resume-authoring");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      operations: [{ id: "op-pending-authoring", kind: "authoring", request: "建立角色", actor: "user", status: "needs_input" as const, created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.request("筆記：寫下雪乃的新設定", { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.operation_id).toBe("op-pending-authoring");
    const state = await repository.read();
    expect(state.operations.find((item) => item.id === "op-pending-authoring")?.status).toBe("completed");
    expect(state.artifacts.some((artifact) => artifact.kind === "draft_note")).toBe(true);
  });

  it("lets the user skip a pending build choice without creating a new operation", async () => {
    const repository = new MemoryProjectRepository("runtime-resume-build-skip");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      operations: [{ id: "op-pending-build", kind: "build", request: "Preview current card", actor: "user", status: "needs_input" as const, question: "請選擇要使用的打包模式（珠璣或調色盤）。", created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const skipped = await runtime.request("先不要", { actor: "user", attachments: [] });
    expect(skipped.status).toBe("completed");
    expect(skipped.operation_id).toBe("op-pending-build");
    expect(skipped.summary).toContain("已略過");
    const state = await repository.read();
    expect(state.operations.find((item) => item.id === "op-pending-build")?.status).toBe("completed");
    expect(state.builds).toHaveLength(0);
  });

  it("resumes a pending knowledge refresh with the remaining sources", async () => {
    const repository = new MemoryProjectRepository("runtime-resume-knowledge");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      sources: [{ id: "source-1", candidate_id: "candidate-1", title: "Official page", canonical_text: "Yukino is direct and calm.", original_hash: contentHash("hash"), revision: contentHash("rev"), media_type: "text/plain", created_at: timestamp }],
      operations: [{ id: "op-pending-knowledge", kind: "knowledge", request: "整理知識", actor: "user", status: "needs_input" as const, created_at: timestamp, updated_at: timestamp, progress: [] }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.request("好，繼續吧", { actor: "user", attachments: [] });
    expect(result.operation_id).toBe("op-pending-knowledge");
    expect(result.status).toBe("completed");
    expect((await repository.read()).operations.find((item) => item.id === "op-pending-knowledge")?.status).toBe("completed");
  });

  it("stores a project cover image with crop geometry and exposes it through the dashboard", async () => {
    const repository = new MemoryProjectRepository("runtime-images");
    const runtime = new WorkspaceRuntime(repository);
    const png = makeTestPng(8, 4, 0);
    const result = await runtime.setProjectImage(
      { actor: "user", attachments: [{ name: "cover.png", content: png, media_type: "image/png" }] },
      { aspect_ratio: "1:1", source: "繪師授權", license: "商用可" },
    );
    expect(result.image_id).toBeTruthy();
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    const state = await repository.read();
    expect(state.images).toHaveLength(1);
    const image = state.images[0]!;
    expect(image.blob_hash).toBe(contentHash(await runtime.getProjectImage(result.image_id).then((entry) => entry?.content ?? new Uint8Array(0))));
    expect(image.crop).toMatchObject({ width: 4, height: 4, offset_x: 2, offset_y: 0 });
    expect(image.source).toBe("繪師授權");
    expect(image.license).toBe("商用可");
    const fetched = await runtime.getProjectImage(result.image_id);
    expect(fetched?.media_type).toBe("image/png");
    expect(fetched?.content.byteLength).toBeGreaterThan(0);
    const snapshot = await runtime.dashboardSnapshot();
    expect(snapshot.images).toHaveLength(1);
    expect(snapshot.images[0]).toMatchObject({ width: 4, height: 4, source: "繪師授權" });
    expect(await runtime.removeProjectImage(result.image_id)).toBe(true);
    expect(await runtime.removeProjectImage(result.image_id)).toBe(false);
    expect((await repository.read()).images).toHaveLength(0);
  });

  it("requires exactly one PNG attachment when setting a project cover image", async () => {
    const runtime = new WorkspaceRuntime(new MemoryProjectRepository("runtime-images-required"));
    await expect(runtime.setProjectImage({ actor: "user", attachments: [] }, {})).rejects.toMatchObject({ code: "CARD_IMAGE_REQUIRED" });
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(runtime.setProjectImage({ actor: "user", attachments: [{ name: "cover.png", content: notPng, media_type: "image/png" }] }, {})).rejects.toMatchObject({ code: "CARD_IMAGE_REQUIRED" });
    await expect(runtime.setProjectImage(
      { actor: "user", attachments: [{ name: "cover.png", content: makeTestPng(2049, 2048, 0), media_type: "image/png" }] },
      {},
    )).rejects.toMatchObject({ code: "CARD_IMAGE_TOO_LARGE", recoverable: true });

    const boundary = await runtime.setProjectImage(
      { actor: "user", attachments: [{ name: "cover.png", content: makeTestPng(2048, 2048, 0), media_type: "image/png" }] },
      {},
    );
    expect(boundary.width).toBe(2048);
    expect(boundary.height).toBe(2048);
  });

  it("validates lease ownership before and after recovery", async () => {
    const repository = new MemoryProjectRepository("runtime-lease-check");
    const timestamp = new Date().toISOString();
    const base: OperationRecord = { id: "op-lease", kind: "authoring", request: "Draft note: Create character: Lease. Personality: calm and clear.", actor: "writer", status: "running", created_at: timestamp, updated_at: timestamp, progress: [], execution_snapshot: { execution_agent_id: "director", execution_agent_role: "orchestrator", initiated_by: "writer", created_at: timestamp } };
    await repository.commit(0, (state) => ({ ...state, operations: [base] }));
    const runtime = new WorkspaceRuntime(repository);
    const claimed = await runtime.claimOperation("op-lease", "worker-1");
    const token = claimed?.lease_token ?? "";
    expect(token.length).toBeGreaterThan(0);
    await expect(runtime.recoverOperation("op-lease", { actor: "worker-1", attachments: [] }, { lease: { owner: "worker-2", token } })).rejects.toMatchObject({ code: "OPERATION_LEASE_LOST" });
    await expect(runtime.recoverOperation("op-lease", { actor: "worker-1", attachments: [] }, { lease: { owner: "worker-1", token: "wrong-token" } })).rejects.toMatchObject({ code: "OPERATION_LEASE_LOST" });
    const recovered = await runtime.recoverOperation("op-lease", { actor: "worker-1", attachments: [] }, { lease: { owner: "worker-1", token } });
    expect(recovered.status).toBe("completed");
  });

  it("rejects an expired lease during recovery", async () => {
    const repository = new MemoryProjectRepository("runtime-lease-expired");
    const timestamp = new Date().toISOString();
    const past = new Date(Date.now() - 5_000).toISOString();
    const leased: OperationRecord = { id: "op-expired", kind: "authoring", request: "Draft note: Create character: Expired. Personality: calm.", actor: "writer", status: "running", created_at: timestamp, updated_at: timestamp, progress: [], lease_owner: "worker-1", lease_token: "token-1", lease_expires_at: past, execution_snapshot: { execution_agent_id: "director", execution_agent_role: "orchestrator", initiated_by: "writer", created_at: timestamp } };
    await repository.commit(0, (state) => ({ ...state, operations: [leased] }));
    const runtime = new WorkspaceRuntime(repository);
    await expect(runtime.recoverOperation("op-expired", { actor: "worker-1", attachments: [] }, { lease: { owner: "worker-1", token: "token-1" } })).rejects.toMatchObject({ code: "OPERATION_LEASE_LOST" });
  });

  it("ignores failOperation when the lease does not match and clears it when it does", async () => {
    const repository = new MemoryProjectRepository("runtime-fail-lease");
    const timestamp = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const leased: OperationRecord = { id: "op-held-fail", kind: "authoring", request: "Draft note: Create character: HeldFail. Personality: calm.", actor: "writer", status: "running", created_at: timestamp, updated_at: timestamp, progress: [], lease_owner: "worker-1", lease_token: "token-1", lease_expires_at: future };
    await repository.commit(0, (state) => ({ ...state, operations: [leased] }));
    const runtime = new WorkspaceRuntime(repository);
    await runtime.failOperation("op-held-fail", new Error("boom"), "worker-2", { owner: "worker-2", token: "token-1" });
    let after = (await repository.read()).operations[0];
    expect(after?.status).toBe("running");
    expect(after?.lease_owner).toBe("worker-1");
    await runtime.failOperation("op-held-fail", new Error("boom"), "worker-1", { owner: "worker-1", token: "token-1" });
    after = (await repository.read()).operations[0];
    expect(after?.status).toBe("failed");
    expect(after?.lease_owner).toBeUndefined();
    expect(after?.lease_token).toBeUndefined();
  });

  it("does not pre-write lease fields for synchronous operations", async () => {
    const repository = new MemoryProjectRepository("runtime-sync-no-lease");
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.request("Draft note: Create character: SyncLease. Personality: calm and clear.", { actor: "writer", attachments: [] });
    expect(result.status).toBe("completed");
    const operation = (await repository.read()).operations[0];
    expect(operation?.lease_owner).toBeUndefined();
    expect(operation?.lease_token).toBeUndefined();
    expect(operation?.lease_expires_at).toBeUndefined();
  });

  it("reuses the operation when the same idempotency key is requested again", async () => {
    const repository = new MemoryProjectRepository("runtime-idempotency");
    const runtime = new WorkspaceRuntime(repository);
    const first = await runtime.request("Draft note: Create character: Idem. Personality: calm and clear.", { actor: "writer", attachments: [] }, { idempotency_key: "key-1" });
    expect(first.status).toBe("completed");
    const second = await runtime.request("Draft note: Create character: Idem. Personality: calm and clear.", { actor: "writer", attachments: [] }, { idempotency_key: "key-1" });
    expect(second.operation_id).toBe(first.operation_id);
    const state = await repository.read();
    expect(state.operations.filter((item) => item.idempotency_key === "key-1")).toHaveLength(1);
    expect(state.audit.some((entry) => entry.event === "request.idempotent_replay")).toBe(true);
    expect(state.artifacts.filter((item) => item.name === "Idem")).toHaveLength(1);
  });

  it("clears the lease when an operation moves to needs_input", async () => {
    const repository = new MemoryProjectRepository("runtime-needs-input-lease");
    const timestamp = new Date().toISOString();
    const base: OperationRecord = { id: "op-unclear", kind: "authoring", request: "unclear", actor: "writer", status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
    await repository.commit(0, (state) => ({ ...state, operations: [base] }));
    const runtime = new WorkspaceRuntime(repository);
    const claimed = await runtime.claimOperation("op-unclear", "worker-1");
    const result = await runtime.recoverOperation("op-unclear", { actor: "worker-1", attachments: [] }, { lease: { owner: "worker-1", token: claimed?.lease_token ?? "" } });
    expect(result.status).toBe("needs_input");
    const after = (await repository.read()).operations[0];
    expect(after?.lease_owner).toBeUndefined();
    expect(after?.lease_token).toBeUndefined();
  });

  it("exposes the error class from the latest failure audit", async () => {
    const repository = new MemoryProjectRepository("runtime-error-class");
    const timestamp = new Date().toISOString();
    const base: OperationRecord = { id: "op-summary", kind: "authoring", request: "Draft note: Create character: Summary. Personality: calm.", actor: "writer", status: "failed", created_at: timestamp, updated_at: timestamp, progress: [] };
    await repository.commit(0, (state) => ({ ...state, operations: [base] }));
    const runtime = new WorkspaceRuntime(repository);
    const clean = await runtime.dashboardSnapshot();
    expect(clean.operations.find((item) => item.id === "op-summary")?.error_class).toBeUndefined();
    await runtime.failOperation("op-summary", new Error("soft failure"), "writer");
    const recoverable = await runtime.dashboardSnapshot();
    expect(recoverable.operations.find((item) => item.id === "op-summary")?.error_class).toBe("recoverable");
    await runtime.failOperation("op-summary", new CoreError("HARD_ERROR", "fatal failure", false), "writer");
    const fatalSnapshot = await runtime.dashboardSnapshot();
    expect(fatalSnapshot.operations.find((item) => item.id === "op-summary")?.error_class).toBe("fatal");
    const auditDetails = (await repository.read()).audit.filter((entry) => entry.event === "operation.failed").at(-1)?.details;
    expect(auditDetails).toMatchObject({ recoverable: false, code: "HARD_ERROR" });
  });

  it("requires a mode for publish preview when both modes are available", async () => {
    const repository = new MemoryProjectRepository("runtime-preview-mode");
    const timestamp = new Date().toISOString();
    const moduleArtifact = (id: string, kind: "zhuji" | "palette", module: string): ArtifactRecord => ({
      id,
      key: `${kind}:demo/${module}`,
      kind,
      name: `${kind}/${module}`,
      content: JSON.stringify({ kind, character_id: "demo", module: { schema_version: 1, mode: kind, module, title: module, data: {} } }),
      media_type: "application/json",
      content_hash: contentHash(id),
      revision: contentHash(id),
      status: "draft",
      created_at: timestamp,
      updated_at: timestamp,
      created_by: "test",
      operation_id: "op",
    });
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [moduleArtifact("zhuji-1", "zhuji", "basic_information"), moduleArtifact("palette-1", "palette", "personality_palette")],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const ambiguous = await runtime.publishPreview();
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.diagnostics.map((item) => item.code)).toContain("MODE_SELECTION_REQUIRED");
    const zhuji = await runtime.publishPreview("zhuji");
    expect(typeof zhuji.ok).toBe("boolean");
    expect(zhuji.diagnostics.map((item) => item.code)).not.toContain("MODE_SELECTION_REQUIRED");
    const palette = await runtime.publishPreview("palette");
    expect(typeof palette.ok).toBe("boolean");
    expect(palette.diagnostics.map((item) => item.code)).not.toContain("MODE_SELECTION_REQUIRED");
  });

  describe("console cancel and dashboard contracts", () => {
    function runningOperation(id: string, status: "running" | "needs_input" | "completed" = "running") {
      const now = new Date().toISOString();
      return { id, kind: "authoring" as const, request: `Draft note: Create character: ${id}.`, actor: "writer", status, created_at: now, updated_at: now, progress: [] };
    }

    it("rejects cancelling a missing operation", async () => {
      const runtime = new WorkspaceRuntime(new MemoryProjectRepository("cancel-missing"));
      await expect(runtime.cancelOperation("nope")).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    });

    it("rejects cancelling a terminal operation without changing it", async () => {
      const repository = new MemoryProjectRepository("cancel-terminal");
      await repository.commit(0, (current) => ({ ...current, operations: [...current.operations, runningOperation("op-done", "completed")] }));
      const runtime = new WorkspaceRuntime(repository);
      await expect(runtime.cancelOperation("op-done")).rejects.toMatchObject({ code: "OPERATION_NOT_CANCELLABLE" });
      const state = await repository.read();
      expect(state.operations.find((item) => item.id === "op-done")?.status).toBe("completed");
    });

    it("cancels a running operation with an audited failed transition", async () => {
      const repository = new MemoryProjectRepository("cancel-running");
      const now = new Date().toISOString();
      await repository.commit(0, (current) => ({
        ...current,
        operations: [...current.operations, { ...runningOperation("op-busy"), lease_owner: "worker", lease_token: "lease-1", lease_expires_at: new Date(Date.now() + 60_000).toISOString() }],
      }));
      const runtime = new WorkspaceRuntime(repository);
      const result = await runtime.cancelOperation("op-busy", "console");
      expect(result).toEqual({ operation_id: "op-busy", status: "cancelled", summary: "Operation cancelled." });
      const state = await repository.read();
      const after = state.operations.find((item) => item.id === "op-busy");
      expect(after?.status).toBe("failed");
      expect(after?.result_summary).toBe("The operation was cancelled from the workspace console");
      expect(after?.lease_owner).toBeUndefined();
      expect(after?.lease_token).toBeUndefined();
      expect(state.audit.some((entry) => entry.operation_id === "op-busy" && entry.event === "operation.failed" && entry.details.code === "OPERATION_CANCELLED" && entry.details.recoverable === true)).toBe(true);
    });

    it("cancels a needs_input operation", async () => {
      const repository = new MemoryProjectRepository("cancel-needs-input");
      await repository.commit(0, (current) => ({ ...current, operations: [...current.operations, runningOperation("op-waiting", "needs_input")] }));
      const runtime = new WorkspaceRuntime(repository);
      await expect(runtime.cancelOperation("op-waiting")).resolves.toMatchObject({ status: "cancelled" });
    });

    it("exposes the pending precheck checks and derived issue views in the dashboard snapshot", async () => {
      const repository = new MemoryProjectRepository("dashboard-contracts");
      const now = new Date().toISOString();
      const candidate = JSON.stringify({ kind: "blueprint", project_id: "dashboard-contracts", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }] });
      const precheck: BlueprintPrecheckRecord = {
        id: "precheck-1",
        schema_version: 1,
        project_id: "dashboard-contracts",
        operation_id: "op-interview",
        collaboration_mode: "assisted",
        candidate_blueprint: JSON.parse(candidate) as Record<string, unknown>,
        candidate_blueprint_revision: contentHash(candidate),
        checks: [
          { subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "user_confirmed", user_answer: "pending confirmation" },
          { subject_id: "demo", dimension: "background", uncertainty: "high", impact: "low", basis: "safe_extension", action: "preserve_explicit" },
        ],
        status: "needs_input",
        created_at: now,
        created_by: "director",
      };
      await repository.commit(0, (current) => ({
        ...current,
        blueprint_prechecks: [precheck],
        issues: [
          {
            id: "issue-1",
            artifact_id: "artifact-1",
            review_id: "review-1",
            code: "PLACEHOLDER_REMAINS",
            message: "unfinished",
            severity: "error" as const,
            effective_severity: "error" as const,
            status: "open" as const,
            overridable: true,
            created_at: now,
            updated_at: now,
          },
          {
            id: "issue-2",
            artifact_id: "artifact-1",
            review_id: "review-1",
            code: "CONTENT_TOO_SHORT",
            message: "too short",
            severity: "warning" as const,
            effective_severity: "warning" as const,
            status: "ignored" as const,
            overridable: true,
            override: { by: "director", reason: "reviewed", timestamp: now, against_effective_severity: "warning", severity: "info" },
            created_at: now,
            updated_at: now,
          },
        ],
      }));
      const runtime = new WorkspaceRuntime(repository);
      const snapshot = await runtime.dashboardSnapshot();
      expect(snapshot.prechecks).toHaveLength(1);
      expect(snapshot.prechecks[0]?.checks).toEqual([
        expect.objectContaining({ subject_id: "demo", dimension: "character_core", action: "user_confirmed" }),
        expect.objectContaining({ subject_id: "demo", dimension: "background", action: "preserve_explicit" }),
      ]);
      const open = snapshot.issues.find((item) => item.id === "issue-1");
      expect(open).toMatchObject({ overridable: true });
      expect(open?.override).toBeUndefined();
      const ignored = snapshot.issues.find((item) => item.id === "issue-2");
      expect(ignored).toMatchObject({ overridable: true, override: { severity: "info", against_effective_severity: "warning", reason: "reviewed", by: "director" } });
    });
  });

  describe("cover image workflow", () => {
    async function blueprintRuntimeWithRoster(roster: Array<{ id: string; label?: string; mode?: string }>, primaryCharacterId?: string) {
      const repository = new MemoryProjectRepository("image-roster");
      const timestamp = new Date().toISOString();
      const blueprintContent = JSON.stringify({
        kind: "blueprint",
        project_id: "image-roster",
        blueprint_direction: { selected: "calm and direct" },
        characters: roster,
        ...(primaryCharacterId === undefined ? {} : { primary_character_id: primaryCharacterId }),
      });
      const blueprintHash = contentHash(blueprintContent);
      const precheck: BlueprintPrecheckRecord = {
        id: "precheck-image",
        schema_version: 1,
        project_id: "image-roster",
        operation_id: "interview",
        collaboration_mode: "free",
        candidate_blueprint: { project_id: "image-roster", characters: roster, ...(primaryCharacterId === undefined ? {} : { primary_character_id: primaryCharacterId }) },
        candidate_blueprint_revision: contentHash("candidate"),
        checks: [{ subject_id: "image-roster", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
        status: "recorded",
        created_at: timestamp,
        created_by: "director",
      };
      await repository.commit(0, (state) => ({
        ...state,
        project_status: "ready",
        interview: { ...state.interview, status: "complete", flow: "character" },
        blueprint_prechecks: [precheck],
        artifacts: [{ ...blueprintArtifact("image-roster", precheck.id), content: blueprintContent, content_hash: blueprintHash, revision: blueprintHash }],
        operations: [{ id: "interview", kind: "interview", request: "interview", status: "completed", created_at: timestamp, updated_at: timestamp, progress: [] }],
      }));
      return new WorkspaceRuntime(repository, { interviewRequired: true });
    }

    it("rejects an upload bound to a character outside the roster", async () => {
      const runtime = await blueprintRuntimeWithRoster([{ id: "demo", label: "Demo", mode: "zhuji" }], "demo");
      await expect(
        runtime.setProjectImage({ actor: "server", attachments: [{ name: "cover.png", content: makeTestPng(512, 768), media_type: "image/png" }] }, { character_id: "gamma" })
      ).rejects.toMatchObject({ code: "IMAGE_CHARACTER_NOT_IN_ROSTER" });
      const snapshot = await runtime.dashboardSnapshot();
      expect(snapshot.images).toHaveLength(0);
    });

    it("allows uploads when no Blueprint roster is bound", async () => {
      const repository = new MemoryProjectRepository("image-open");
      const runtime = new WorkspaceRuntime(repository);
      const result = await runtime.setProjectImage({ actor: "server", attachments: [{ name: "cover.png", content: makeTestPng(512, 768), media_type: "image/png" }] }, { character_id: "anything" });
      expect(result.image_id).toBeTruthy();
    });

    it("records audit entries and marks the export stale after publishing", async () => {
      const repository = new MemoryProjectRepository("image-stale");
      const runtime = new WorkspaceRuntime(repository);
      const upload = await runtime.setProjectImage(
        { actor: "server", attachments: [{ name: "cover.png", content: makeTestPng(512, 768), media_type: "image/png" }] },
        { source: "assets/cover.png", license: "CC BY" }
      );
      let state = await repository.read();
      expect(state.images).toHaveLength(1);
      expect(state.audit.some((entry) => entry.event === "image.updated" && entry.details.action === "added" && entry.details.image_id === upload.image_id)).toBe(true);
      let snapshot = await runtime.dashboardSnapshot();
      expect(snapshot.images_stale).toBe(false);
      const past = new Date(Date.now() - 3600_000).toISOString();
      await repository.commit(state.revision, (current) => ({
        ...current,
        publishes: [
          {
            id: "pub-1",
            operation_id: "op-build",
            artifact_ids: ["a"],
            content_ref: { hash: "a".repeat(64), size: 1 },
            content_hash: "a".repeat(64),
            png_ref: { hash: "b".repeat(64), size: 1 },
            created_at: past,
          },
        ],
      }));
      snapshot = await runtime.dashboardSnapshot();
      expect(snapshot.images_stale).toBe(true);
      await runtime.removeProjectImage(upload.image_id, "server");
      state = await repository.read();
      expect(state.images).toHaveLength(0);
      expect(state.audit.some((entry) => entry.event === "image.updated" && entry.details.action === "removed" && entry.details.image_id === upload.image_id)).toBe(true);
    });

    it("exposes the roster and manifest primary for the image panel", async () => {
      const runtime = await blueprintRuntimeWithRoster(
        [
          { id: "alpha", label: "Alpha", mode: "zhuji" },
          { id: "beta", label: "Beta", mode: "zhuji" },
        ],
        "beta"
      );
      const snapshot = await runtime.dashboardSnapshot();
      expect(snapshot.roster).toEqual([expect.objectContaining({ id: "alpha" }), expect.objectContaining({ id: "beta" })]);
      expect(snapshot.primary_character_id).toBe("beta");
    });
  });
});

function makeTestPng(width: number, height: number, filter = 0): Buffer {
  const channels = 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = filter;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * channels;
      const left = x < Math.floor(width / 2);
      raw[pixelOffset] = left ? 255 : 0;
      raw[pixelOffset + 1] = left ? 0 : 0;
      raw[pixelOffset + 2] = left ? 0 : 255;
      raw[pixelOffset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([pngSignature, encodePngChunk("IHDR", ihdr), encodePngChunk("IDAT", deflateSync(raw)), encodePngChunk("IEND", Buffer.alloc(0))]);
}
