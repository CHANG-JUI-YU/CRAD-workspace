import { describe, expect, it } from "vitest";
import {
  amendInterviewAnswer,
  beginInterview,
  createInterviewState,
  MemoryProjectRepository,
  replayInterviewState,
  workflow_answer_interview,
  type InterviewState,
  type RequestResult,
} from "@st-workspace/core";
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
    const state = before.interview;
    const conceptId = questionIdOf(state, "concept");
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
