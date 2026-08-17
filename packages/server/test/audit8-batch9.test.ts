import { afterAll, describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import type { Server } from "node:http";
import { DASHBOARD_CSS } from "../src/dashboard-css.js";
import { DASHBOARD_MARKUP } from "../src/dashboard-markup.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";

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

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
  await runtime.request("建立新專案", { actor: "batch9-test", attachments: [] });
  for (const value of SOURCE_ADAPTATION_VALUES) {
    await runtime.answerInterview(value, { actor: "batch9-test", attachments: [] });
  }
  const workspace = createWorkspaceServer({ runtime, actor: "batch9-test", autoStartWorker: false });
  servers.push(workspace);
  await new Promise<void>((resolve) => workspace.listen(0, "127.0.0.1", () => resolve()));
  const address = workspace.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected numeric address");
  }
  return { runtime, repository, url: `http://127.0.0.1:${address.port}` };
}

describe("#119 interview amendment endpoints (server)", () => {
  it("previews an amendment without committing", async () => {
    const { runtime, url } = await startServer("batch9-server-preview");
    const context = await runtime.interviewContext();
    const conceptId = context.answers.find((item) => item.question_id.includes("concept"))!.question_id;
    const response = await fetch(`${url}/workspace/interview/amend-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question_id: conceptId, answer: "更克制的預覽版本" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      noop: boolean;
      revision: number;
      question_id: string;
      status: string;
      history: Array<{ status: string }>;
      superseded_precheck_ids: string[];
    };
    expect(body.noop).toBe(false);
    expect(body.question_id).toBe(conceptId);
    expect(body.revision).toBe(context.revision);
    expect(body.status).toBe("complete");
    expect(body.history.at(-1)?.status).toBe("amendment");
    expect(body.superseded_precheck_ids.length).toBeGreaterThan(0);
  });

  it("previews an identical answer as a noop", async () => {
    const { runtime, url } = await startServer("batch9-server-preview-noop");
    const context = await runtime.interviewContext();
    const conceptId = context.answers.find((item) => item.question_id.includes("concept"))!.question_id;
    const current = context.answers.find((item) => item.question_id.includes("concept"))!.answer;
    const response = await fetch(`${url}/workspace/interview/amend-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question_id: conceptId, answer: current }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { noop: boolean; superseded_precheck_ids: string[] };
    expect(body.noop).toBe(true);
    expect(body.superseded_precheck_ids).toEqual([]);
  });

  it("rejects a preview without required fields", async () => {
    const { url } = await startServer("batch9-server-preview-missing");
    const response = await fetch(`${url}/workspace/interview/amend-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("INTERVIEW_AMEND_PREVIEW_REQUIRED");
  });

  it("commits an amendment and supersedes recorded prechecks", async () => {
    const { runtime, repository, url } = await startServer("batch9-server-amend");
    const before = await repository.read();
    const conceptId = before.interview.answers.find((item) => item.question_id.includes("concept"))!.question_id;
    const response = await fetch(`${url}/workspace/interview/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question_id: conceptId, answer: "更克制的版本" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      noop: boolean;
      revision: number;
      status: string;
      superseded_precheck_ids: string[];
      history: Array<{ status: string }>;
    };
    expect(body.noop).toBe(false);
    expect(body.revision).toBe(before.revision + 1);
    expect(body.status).toBe("completed");
    expect(body.superseded_precheck_ids.length).toBeGreaterThan(0);
    expect(body.history.some((entry) => entry.status === "superseded")).toBe(true);
    const after = await repository.read();
    expect(after.audit.at(-1)?.event).toBe("interview.answer.amended");
    for (const id of body.superseded_precheck_ids) {
      expect(after.blueprint_prechecks.find((item) => item.id === id)?.status).toBe("superseded");
    }
  });

  it("rejects an amendment for an unknown question", async () => {
    const { url } = await startServer("batch9-server-amend-missing");
    const response = await fetch(`${url}/workspace/interview/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question_id: "no-such-question", answer: "x" }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string; recoverable: boolean };
    expect(body.code).toBe("INTERVIEW_ANSWER_NOT_FOUND");
    expect(body.recoverable).toBe(true);
  });

  it("rejects an amendment without required fields", async () => {
    const { url } = await startServer("batch9-server-amend-empty");
    const response = await fetch(`${url}/workspace/interview/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question_id: "concept", answer: "   " }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("INTERVIEW_AMEND_REQUIRED");
  });

  it("serves the dashboard with interview history and amendment UI strings", async () => {
    const { url } = await startServer("batch9-server-html");
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("interview-history");
    expect(html).toContain("修訂此題");
    expect(html).toContain("amend-answer-input");
    expect(html).toContain("amend-preview");
    expect(html).toContain("amend-confirm");
    expect(html).toContain("external-change-notice");
    expect(html).toContain("/workspace/interview/amend-preview");
    expect(html).toContain("/workspace/interview/amend");
    expect(html).not.toContain("innerHTML");
  });
});

describe("Audit 8 Batch 9 - URL ingestion Dashboard read model surface", () => {
  it("exposes progressive URL lifecycle disclosure, paging and executable recovery controls", () => {
    expect(DASHBOARD_MARKUP).toContain('id="url-ingestion-monitor"');
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("function renderUrlIngestionMonitor(page)");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("/workspace/dashboard/url-ingestions");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("/workspace/coverage/url-ingestion/recover");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("retry_url");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("change_url");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("aria-busy");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("record.transitions");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("record.evidence_components");
    expect(DASHBOARD_PANELS_COVERAGE_JS).not.toContain("innerHTML");
  });

  it("uses semantic theme tokens for the lifecycle monitor and remains parseable", () => {
    expect(DASHBOARD_CSS).toContain(".url-ingestion-card");
    expect(DASHBOARD_CSS).toContain("var(--color-warning-bg)");
    expect(DASHBOARD_CSS).toContain("var(--color-error-border)");
    expect(DASHBOARD_CSS).toContain("@media (prefers-color-scheme: dark)");
    expect(() => new Function(DASHBOARD_PANELS_COVERAGE_JS)).not.toThrow();
  });
});
