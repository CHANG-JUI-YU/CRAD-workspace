import { describe, expect, it } from "vitest";
import {
  amendInterviewAnswer,
  beginInterview,
  createInterviewState,
  createProjectState,
  MemoryProjectRepository,
  replayInterviewState,
  validateState,
  workflow_answer_interview,
  type InterviewState,
  type ProjectState,
  type RequestResult,
} from "@st-workspace/core";
import { beginUrlIngestion, fetchAndValidateUrlContent, ingestUserSupplementEvidence } from "../src/coverage-supplement-service.js";
import { queryDashboardSources, queryDashboardUrlIngestions } from "../src/dashboard-read-model.js";
import { WorkspaceRuntime } from "../src/index.js";

const SOURCE_ADAPTATION_VALUES = [
  "角色設定",
  "單人角色卡",
  "原作改編",
  "雪乃，來自某部動漫",
  "動漫",
  "官方角色頁、雪乃、作品名稱",
  "二創詮釋",
  "雪乃",
  "palette",
  "我心中更克制、溫柔且重視界線的版本",
  "沿用原作背景，但調整成適合本專案的生活脈絡",
  "冷靜、觀察力強，面對信任的人會逐步展現柔軟",
  "我直接命名",
  "雪乃二創專案",
  "不需要",
  "外冷內熱、慢熟但對重要的人很忠誠",
  "自由創作",
  "沒有",
];

function replayedState(values: readonly string[]): InterviewState {
  let state = beginInterview(createInterviewState());
  for (const value of values) {
    state = workflow_answer_interview(state, { answer: value, actor: "user" });
  }
  return state;
}

function completedState(): InterviewState {
  return replayedState(SOURCE_ADAPTATION_VALUES);
}

function questionIdOf(state: InterviewState, fragment: string): string {
  const answer = state.answers.find((item) => item.question_id.includes(fragment));
  if (answer === undefined) throw new Error(`no answer matches ${fragment}`);
  return answer.question_id;
}

async function completeInterview(runtime: WorkspaceRuntime): Promise<void> {
  await runtime.request("建立新專案", { actor: "user", attachments: [] });
  let result: RequestResult | undefined;
  for (const value of SOURCE_ADAPTATION_VALUES) {
    result = await runtime.answerInterview(value, { actor: "user", attachments: [] });
  }
  expect(result?.status).toBe("completed");
}

describe("Audit 8 batch 9: append-only interview amendments (core)", () => {
  it("replays a recorded answer list into a state and captures question ids", () => {
    const state = completedState();
    const replayed = replayInterviewState(state.answers);
    expect(replayed).toBeDefined();
    expect(replayed?.state.status).toBe("complete");
    expect(Object.keys(replayed?.questions ?? {})).toHaveLength(state.answers.length);
  });

  it("appends an amendment and supersedes the original answer", () => {
    const state = completedState();
    const conceptId = questionIdOf(state, "concept");
    const amended = amendInterviewAnswer(state, { question_id: conceptId, answer: "更克制、更重視界線的版本" });
    expect(amended.answers).toHaveLength(state.answers.length + 1);
    const original = amended.answers.find((item) => item.question_id === conceptId && item.amendment_of === undefined);
    expect(original?.superseded_by?.question_id).toBe(amended.answers.at(-1)?.question_id);
    const amendment = amended.answers.at(-1);
    expect(amendment?.amendment_of).toMatchObject({ question_id: conceptId });
    expect(amended.values[conceptId]).toBe("更克制、更重視界線的版本");
    expect(amended.status).toBe("complete");
  });

  it("returns the original state unchanged for an identical answer", () => {
    const state = completedState();
    const conceptId = questionIdOf(state, "concept");
    const originalAnswer = state.answers.find((item) => item.question_id === conceptId)?.answer;
    const amended = amendInterviewAnswer(state, { question_id: conceptId, answer: originalAnswer ?? "" });
    expect(amended).toBe(state);
  });

  it("refuses to amend when there is no current answer for the question", () => {
    expect(() => amendInterviewAnswer(beginInterview(createInterviewState()), { question_id: "concept", answer: "x" }))
      .toThrowError(expect.objectContaining({ code: "INTERVIEW_ANSWER_NOT_FOUND", recoverable: true }));
    const state = completedState();
    expect(() => amendInterviewAnswer(state, { question_id: "no-such-question", answer: "x" }))
      .toThrowError(expect.objectContaining({ code: "INTERVIEW_ANSWER_NOT_FOUND", recoverable: true }));
  });

  it("refuses to amend a legacy record that cannot be replayed", () => {
    const state = completedState();
    const corrupted: InterviewState = { ...state, answers: state.answers.map((item, index) => index === 0 ? { ...item, answer: "非法選項" } : item) };
    expect(replayInterviewState(corrupted.answers)).toBeUndefined();
    expect(() => amendInterviewAnswer(corrupted, { question_id: corrupted.answers[1]!.question_id, answer: "x" }))
      .toThrowError(expect.objectContaining({ code: "INTERVIEW_AMENDMENT_REPLAY_FAILED", recoverable: true }));
  });
});

describe("Audit 8 batch 9: interview amendment runtime", () => {
  async function completedRuntime(projectId: string) {
    const repository = new MemoryProjectRepository(projectId);
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await completeInterview(runtime);
    return { repository, runtime };
  }

  it("exposes revision and history from the interview context", async () => {
    const { runtime, repository } = await completedRuntime("batch9-ctx");
    const context = await runtime.interviewContext();
    expect(context.revision).toBe((await repository.read()).revision);
    expect(context.status).toBe("complete");
    expect(context.history).toHaveLength(SOURCE_ADAPTATION_VALUES.length);
    expect(context.history.every((entry) => entry.status === "current")).toBe(true);
    expect(context.history.at(-1)?.question_text).toBeDefined();
  });

  it("previews an amendment without committing anything", async () => {
    const { runtime, repository } = await completedRuntime("batch9-preview");
    const before = await repository.read();
    const conceptId = questionIdOf(before.interview, "concept");
    const preview = await runtime.interviewAmendmentImpactPreview({ question_id: conceptId, answer: "預覽的新概念" });
    expect(preview.noop).toBe(false);
    expect(preview.revision).toBe(before.revision);
    expect(preview.superseded_precheck_ids.length).toBeGreaterThan(0);
    expect(preview.answers).toHaveLength(SOURCE_ADAPTATION_VALUES.length + 1);
    expect(preview.history.at(-1)?.status).toBe("amendment");
    expect(preview.downstream_invalidation).toMatchObject({ invalidated: false, sources: [], items: [] });
    const after = await repository.read();
    expect(after.revision).toBe(before.revision);
    expect(after.interview.answers).toHaveLength(SOURCE_ADAPTATION_VALUES.length);
    expect(after.audit).toHaveLength(before.audit.length);
  });

  it("previews an identical answer as a noop", async () => {
    const { runtime } = await completedRuntime("batch9-preview-noop");
    const context = await runtime.interviewContext();
    const conceptAnswer = context.answers.find((item) => item.question_id.includes("concept"));
    expect(conceptAnswer).toBeDefined();
    const preview = await runtime.interviewAmendmentImpactPreview({ question_id: conceptAnswer!.question_id, answer: conceptAnswer!.answer });
    expect(preview.noop).toBe(true);
    expect(preview.superseded_precheck_ids).toEqual([]);
    expect(preview.answers).toHaveLength(context.answers.length);
  });

  it("commits an amendment with audit and supersedes recorded prechecks", async () => {
    const { runtime, repository } = await completedRuntime("batch9-amend");
    const before = await repository.read();
    const conceptId = questionIdOf(before.interview, "concept");
    const recordedIds = before.blueprint_prechecks.filter((item) => item.status === "recorded").map((item) => item.id);
    expect(recordedIds.length).toBeGreaterThan(0);
    const result = await runtime.amendInterviewAnswer({ question_id: conceptId, answer: "更克制的版本" }, { actor: "user", attachments: [] });
    expect(result.noop).toBe(false);
    expect(result.status).toBe("completed");
    expect(result.revision).toBe(before.revision + 1);
    expect(result.superseded_precheck_ids).toEqual(recordedIds);
    expect(result.history.at(-1)?.status).toBe("amendment");
    expect(result.history.some((entry) => entry.status === "superseded")).toBe(true);
    const after = await repository.read();
    expect(after.interview.answers).toHaveLength(SOURCE_ADAPTATION_VALUES.length + 1);
    for (const id of recordedIds) {
      expect(after.blueprint_prechecks.find((item) => item.id === id)?.status).toBe("superseded");
    }
    const event = after.audit.at(-1);
    expect(event?.event).toBe("interview.answer.amended");
    expect(event?.details).toMatchObject({
      question_id: conceptId,
      previous_answer: "我心中更克制、溫柔且重視界線的版本",
      amended_answer: "更克制的版本",
      resumed: false,
      superseded_precheck_ids: recordedIds,
    });
  });

  it("resumes an active interview when the amendment re-opens the flow", async () => {
    const repository = new MemoryProjectRepository("batch9-resume");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    await runtime.request("建立新專案", { actor: "user", attachments: [] });
    for (const value of SOURCE_ADAPTATION_VALUES.slice(0, 5)) {
      await runtime.answerInterview(value, { actor: "user", attachments: [] });
    }
    const before = await repository.read();
    const mediumId = before.interview.answers[4]!.question_id;
    expect(mediumId).toContain("source_medium");
    const result = await runtime.amendInterviewAnswer({ question_id: mediumId, answer: "遊戲" }, { actor: "user", attachments: [] });
    expect(result.status).toBe("needs_input");
    expect(result.question).toBeDefined();
    expect(result.revision).toBe(before.revision + 1);
    const after = await repository.read();
    expect(after.project_status).toBe("interviewing");
    const operation = after.operations.filter((item) => item.kind === "interview").at(-1);
    expect(operation?.status).toBe("needs_input");
    expect(operation?.result_summary).toContain("已修訂");
    expect(after.audit.at(-1)?.details).toMatchObject({ resumed: true });
  });

  it("returns a noop result without committing for identical answers", async () => {
    const { runtime, repository } = await completedRuntime("batch9-noop");
    const before = await repository.read();
    const conceptId = questionIdOf(before.interview, "concept");
    const current = before.interview.answers.find((item) => item.question_id === conceptId)?.answer ?? "";
    const result = await runtime.amendInterviewAnswer({ question_id: conceptId, answer: current }, { actor: "user", attachments: [] });
    expect(result.noop).toBe(true);
    expect(result.revision).toBe(before.revision);
    const after = await repository.read();
    expect(after.revision).toBe(before.revision);
    expect(after.audit).toHaveLength(before.audit.length);
  });

  it("rejects amendments for unknown question ids", async () => {
    const { runtime } = await completedRuntime("batch9-missing");
    await expect(runtime.amendInterviewAnswer({ question_id: "no-such-question", answer: "x" }, { actor: "user", attachments: [] }))
      .rejects.toMatchObject({ code: "INTERVIEW_ANSWER_NOT_FOUND", recoverable: true });
  });

  it("rejects amendments for legacy records that cannot be replayed", async () => {
    const repository = new MemoryProjectRepository("batch9-legacy");
    const state = completedState();
    const corrupted: InterviewState = { ...state, answers: state.answers.map((item, index) => index === 0 ? { ...item, answer: "非法選項" } : item) };
    await repository.commit(0, (current) => ({ ...current, project_status: "interviewing" as const, interview: corrupted }));
    const runtime = new WorkspaceRuntime(repository);
    await expect(runtime.amendInterviewAnswer({ question_id: corrupted.answers[1]!.question_id, answer: "x" }, { actor: "user", attachments: [] }))
      .rejects.toMatchObject({ code: "INTERVIEW_AMENDMENT_REPLAY_FAILED", recoverable: true });
  });
});

const now = "2026-08-17T00:00:00.000Z";

function exhaustedResearchState(): ProjectState {
  const state = createProjectState("batch9-recovery");
  return {
    ...state,
    coverage_requirement_sets: [{
      id: "requirement-set-1",
      revision: "requirement-set-rev-1",
      source: "default",
      blueprint_revision: "blueprint-rev-1",
      characters: [{ character_id: "alpha", requirement_ids: ["req.identity"] }],
      world_requirement_ids: [],
      created_by: "director",
      created_at: now,
    }],
    coverage_assessments: [{
      id: "assessment-1",
      revision: "assessment-rev-1",
      pass: "formal",
      requirement_set_id: "requirement-set-1",
      requirement_set_revision: "requirement-set-rev-1",
      input_snapshot: { source_revisions: [] },
      items: [{ character_id: "alpha", requirement_id: "req.identity", status: "missing", candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: ["task-1"], resolution_ids: [], reason: "missing" }],
      operation_id: "assessment-operation",
      created_by: "director",
      created_at: now,
    }],
    coverage_research_batches: [{
      id: "batch-1",
      assessment_id: "assessment-1",
      assessment_revision: "assessment-rev-1",
      requirement_set_id: "requirement-set-1",
      requirement_set_revision: "requirement-set-rev-1",
      status: "completed",
      task_ids: ["task-1"],
      created_by: "director",
      created_at: now,
    }],
    coverage_research_tasks: [{
      id: "task-1",
      batch_id: "batch-1",
      character_id: "alpha",
      requirement_ids: ["req.identity"],
      dimension_paths: ["identity"],
      query_seeds: ["alpha"],
      status: "exhausted",
      claim_generation: 1,
      attempt: 1,
      searched_queries: ["alpha"],
      source_families: ["web"],
      exhausted_reason: "No result",
      created_at: now,
      updated_at: now,
    }],
  };
}

describe("Audit 8 Batch 9 - URL lifecycle, lineage, metadata and compound evidence", () => {
  it("persists the complete success sequence and projects redirect metadata", async () => {
    const repository = new MemoryProjectRepository("batch9-success", createProjectState("batch9-success"));
    const initial = await repository.read();
    const lifecycle = await beginUrlIngestion(repository, initial, {
      operation_id: "operation-success",
      requested_url: "https://example.com/requested",
      route: "coverage_supplement",
    });
    const fetched = await fetchAndValidateUrlContent(async () => ({
      content: new TextEncoder().encode("<html><head><title>Fetched title</title><link rel=\"canonical\" href=\"https://example.com/canonical\"></head><body>Useful evidence</body></html>"),
      final_url: "https://example.com/final",
      media_type: "text/html; charset=utf-8",
    }), "https://example.com/requested", lifecycle);
    await lifecycle.transition("ingested", {
      requested_url: "https://example.com/requested",
      canonical_url: fetched.canonical_url,
      final_url: fetched.final_url,
      title: fetched.title,
      media_type: fetched.media_type,
      content_size: fetched.content_size,
      source_id: "source-success",
    });

    const after = await repository.read();
    const record = after.url_ingestions[0]!;
    expect(record.status).toBe("ingested");
    expect(record.requested_url).toBe("https://example.com/requested");
    expect(record.canonical_url).toBe("https://example.com/canonical");
    expect(record.final_url).toBe("https://example.com/final");
    expect(record.title).toBe("Fetched title");
    expect(record.media_type).toBe("text/html; charset=utf-8");
    expect(record.transitions?.map((item) => item.status)).toEqual(["url_received", "fetching", "content_validated", "ingested"]);
    const dashboard = queryDashboardUrlIngestions(after).items[0]!;
    expect(dashboard.transitions.map((item) => item.status)).toEqual(record.transitions?.map((item) => item.status));
  });

  it.each([
    ["empty", async () => ({ content: new Uint8Array(), final_url: "https://example.com/empty" }), "URL_CONTENT_EMPTY"],
    ["invalid UTF-8", async () => ({ content: new Uint8Array([0xff, 0xfe]), final_url: "https://example.com/invalid" }), "URL_CONTENT_INVALID"],
  ])("durably records %s validation failure", async (_label, fetcher, code) => {
    const repository = new MemoryProjectRepository("batch9-failure", createProjectState("batch9-failure"));
    const lifecycle = await beginUrlIngestion(repository, await repository.read(), {
      operation_id: "operation-failure",
      requested_url: "https://example.com/failure",
      route: "coverage_research_recover",
      task_id: "task-failure",
    });
    await expect(fetchAndValidateUrlContent(fetcher, "https://example.com/failure", lifecycle)).rejects.toMatchObject({ code });
    const record = (await repository.read()).url_ingestions[0]!;
    expect(record.status).toBe("fetch_failed");
    expect(record.next_actions).toEqual(["retry", "change_url"]);
    expect(record.transitions?.map((item) => item.status)).toEqual(["url_received", "fetching", "fetch_failed"]);
  });

  it("creates explicit successor lineage and rejects duplicate valid successors", async () => {
    const repository = new MemoryProjectRepository("batch9-lineage", createProjectState("batch9-lineage"));
    const first = await beginUrlIngestion(repository, await repository.read(), {
      operation_id: "operation-first",
      requested_url: "https://example.com/old",
      route: "coverage_research_recover",
      task_id: "task-lineage",
    });
    await expect(fetchAndValidateUrlContent(async () => { throw new Error("offline"); }, "https://example.com/old", first)).rejects.toThrow("offline");
    const failed = await repository.read();
    const second = await beginUrlIngestion(repository, failed, {
      operation_id: "operation-retry",
      requested_url: "https://example.com/new",
      retry_of: first.id,
      route: "coverage_research_recover",
      task_id: "task-lineage",
    });
    const linked = await repository.read();
    expect(linked.url_ingestions.find((item) => item.id === first.id)?.successor_of).toBe(second.id);
    expect(linked.url_ingestions.find((item) => item.id === second.id)?.retry_of).toBe(first.id);
    await expect(beginUrlIngestion(repository, linked, {
      operation_id: "operation-duplicate",
      requested_url: "https://example.com/another",
      retry_of: first.id,
      route: "coverage_research_recover",
      task_id: "task-lineage",
    })).rejects.toMatchObject({ code: "URL_INGESTION_SUCCESSOR_EXISTS" });
  });

  it("preserves all component identities for the five supported compound evidence shapes", async () => {
    const url = "https://example.com/evidence";
    const fetcher = async () => ({
      content: new TextEncoder().encode("URL evidence body"),
      final_url: "https://example.com/evidence-final",
      canonical_url: "https://example.com/evidence-canonical",
      title: "URL evidence title",
      media_type: "text/markdown",
    });
    const attachment = (name: string, text: string) => ({ name, content: new TextEncoder().encode(text), media_type: "text/plain" });
    const cases = [
      { name: "text+URL", text: "inline", url, attachments: [], types: ["text", "url"] },
      { name: "URL+attachment", url, attachments: [attachment("first.md", "first"), attachment("second.md", "second")], types: ["url", "attachment", "attachment"] },
      { name: "text+attachment", text: "inline", attachments: [attachment("note.md", "note")], types: ["text", "attachment"] },
      { name: "multiple attachment", attachments: [attachment("one.md", "one"), attachment("two.md", "two")], types: ["attachment", "attachment"] },
      { name: "text+URL+multiple attachments", text: "inline", url, attachments: [attachment("one.md", "one"), attachment("two.md", "two")], types: ["text", "url", "attachment", "attachment"] },
    ];
    for (const testCase of cases) {
      const result = await ingestUserSupplementEvidence(fetcher, createProjectState("batch9-compound"), "operation-compound", "director", {
        ...(testCase.text === undefined ? {} : { text: testCase.text }),
        ...(testCase.url === undefined ? {} : { url: testCase.url }),
        attachments: testCase.attachments,
      });
      const components = result.source.evidence_components ?? [];
      expect(components.map((component) => component.type), testCase.name).toEqual(testCase.types);
      expect(components.every((component) => component.id.length > 0 && component.content_hash.length === 64), testCase.name).toBe(true);
      if (testCase.types.length > 1) {
        expect(result.source.media_type, testCase.name).toBe("application/vnd.st-workspace.compound-evidence");
        expect(result.source.title, testCase.name).toBe(`Compound evidence (${testCase.types.length} components)`);
        expect(result.source.title).not.toBe("first.md");
      }
      const urlComponent = components.find((component) => component.type === "url");
      if (urlComponent) {
        expect(urlComponent.requested_url).toBe(url);
        expect(urlComponent.canonical_url).toBe("https://example.com/evidence-canonical");
        expect(urlComponent.final_url).toBe("https://example.com/evidence-final");
        expect(urlComponent.title).toBe("URL evidence title");
      }
      expect(JSON.stringify(result.state)).not.toContain("content_base64");
      expect(validateState(result.state).sources.at(-1)?.evidence_components?.length).toBe(testCase.types.length);
    }
  });

  it("keeps URL-only metadata in the source read model instead of a generic title", async () => {
    const result = await ingestUserSupplementEvidence(async () => ({
      content: new TextEncoder().encode("URL-only text"),
      final_url: "https://example.com/final",
      title: "Fetched URL title",
      media_type: "text/html",
    }), createProjectState("batch9-url-only"), "operation-url-only", "director", { url: "https://example.com/requested" });
    const source = queryDashboardSources(result.state).items[0]!;
    expect(source.title).toBe("Fetched URL title");
    expect(source.url).toBe("https://example.com/requested");
    expect(source.final_url).toBe("https://example.com/final");
    expect(source.media_type).toBe("text/html");
    expect(source.content_size).toBeGreaterThan(0);
  });

  it("projects persisted compound components through the URL ingestion read model", async () => {
    const repository = new MemoryProjectRepository("batch9-url-components", createProjectState("batch9-url-components"));
    const lifecycle = await beginUrlIngestion(repository, await repository.read(), {
      operation_id: "operation-url-components",
      requested_url: "https://example.com/compound",
      route: "coverage_supplement",
    });
    const result = await ingestUserSupplementEvidence(async () => ({
      content: new TextEncoder().encode("url component"),
      final_url: "https://example.com/compound-final",
      title: "Compound URL",
      media_type: "text/plain",
    }), lifecycle.state, "operation-url-components", "director", {
      text: "inline component",
      url: "https://example.com/compound",
      attachments: [{ name: "note.md", content: new TextEncoder().encode("attachment component"), media_type: "text/plain" }],
      urlLifecycle: lifecycle,
    });
    await repository.commit(result.state.revision, () => result.state);
    const view = queryDashboardUrlIngestions(await repository.read()).items[0]!;
    expect(view.evidence_components?.map((component) => component.type)).toEqual(["text", "url", "attachment"]);
    expect(view.evidence_components?.find((component) => component.type === "url")?.final_url).toBe("https://example.com/compound-final");
  });

  it("resolves relative canonical metadata against the final URL", async () => {
    const content = "<html><head><link rel=\"canonical\" href=\"/canonical\"></head><body>relative canonical</body></html>";
    const fetched = await fetchAndValidateUrlContent(async () => ({
      content: new TextEncoder().encode(content),
      final_url: "https://example.com/redirected/page",
    }), "https://example.com/requested");
    expect(fetched.canonical_url).toBe("https://example.com/canonical");
    expect(validateState((await ingestUserSupplementEvidence(async () => ({
      content: new TextEncoder().encode(content),
      final_url: "https://example.com/redirected/page",
    }), createProjectState("batch9-relative-canonical"), "operation-relative-canonical", "director", { url: "https://example.com/requested" })).state).sources.at(-1)?.canonical_url).toBe("https://example.com/canonical");
  });

  it("executes retry and change-url actions as explicit operation and URL successors", async () => {
    const repository = new MemoryProjectRepository("batch9-recovery", exhaustedResearchState());
    let successful = false;
    const runtime = new WorkspaceRuntime(repository, {
      fetcher: (async (url: string) => {
        if (!successful || !url.includes("new")) throw new Error("offline");
        return { content: new TextEncoder().encode("recovered evidence"), final_url: url + "/final", title: "Recovered source", media_type: "text/plain" };
      }) as never,
    });
    await expect(runtime.coverageResearchRecover("director", {
      task_id: "task-1",
      action: "manual_url",
      url: "https://example.com/old",
      operation_id: "operation-old",
    }, [])).rejects.toThrow("offline");
    let state = await repository.read();
    const first = state.url_ingestions[0]!;
    await expect(runtime.coverageResearchRecover("director", {
      task_id: "task-1",
      action: "retry_url",
      url_ingestion_id: first.id,
      operation_id: "operation-retry",
    }, [])).rejects.toThrow("offline");
    state = await repository.read();
    const second = state.url_ingestions.find((item) => item.retry_of === first.id)!;
    await expect(runtime.coverageResearchRecover("director", {
      task_id: "task-1",
      action: "retry_url",
      url_ingestion_id: first.id,
      operation_id: "operation-duplicate",
    }, [])).rejects.toMatchObject({ code: "URL_INGESTION_SUCCESSOR_EXISTS" });

    successful = true;
    const result = await runtime.coverageResearchRecover("director", {
      task_id: "task-1",
      action: "change_url",
      url_ingestion_id: second.id,
      url: "https://example.com/new",
      operation_id: "operation-change",
    }, []);
    expect(result.status).toBe("completed");
    state = await repository.read();
    const third = state.url_ingestions.find((item) => item.retry_of === second.id)!;
    expect(state.url_ingestions.find((item) => item.id === first.id)?.successor_of).toBe(second.id);
    expect(state.url_ingestions.find((item) => item.id === second.id)?.successor_of).toBe(third.id);
    expect(third.status).toBe("ingested");
    expect(third.requested_url).toBe("https://example.com/new");
    expect(state.operations.filter((item) => item.id.startsWith("operation-")).map((item) => item.id)).toEqual(expect.arrayContaining(["operation-old", "operation-retry", "operation-duplicate", "operation-change"]));
  });
});
