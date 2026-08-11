import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { MemoryProjectRepository } from "@st-workspace/core";
import { encodePngChunk, pngSignature } from "@st-workspace/adapters-png";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import { dashboard } from "../src/dashboard.js";

describe("local Dashboard", () => {
  it("serves the main local workflow console and existing REST paths", async () => {
    const server = createWorkspaceServer({
      runtime: new WorkspaceRuntime(new MemoryProjectRepository("dashboard-test")),
      actor: "dashboard-test",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    try {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("ST Workspace 本機工作台");
      expect(html).toContain("專案選擇");
      expect(html).toContain("目前專案 / 工作流狀態");
      expect(html).toContain("自然語言操作");
      expect(html).toContain("結構化訪談");
      expect(html).toContain("最近回應 / 診斷");
      for (const endpoint of [
        "/workspace/projects",
        "/workspace/project/select",
        "/workspace/status",
        "/workspace/agents",
        "/workspace/request",
        "/workspace/interview/context",
        "/workspace/interview/answer",
      ]) {
        expect(html).toContain(endpoint);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("uses DOM text APIs for untrusted API display values", () => {
    const html = dashboard();

    expect(html).toContain("textContent");
    expect(html).toContain("createElement");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("insertAdjacentHTML");
    expect(html).toContain("canonical value");
  });

  it("includes the UX-03~12 panels and their REST endpoints", () => {
    const html = dashboard();
    for (const label of [
      "Blueprint 預檢矩陣",
      "Publish 就緒檢查",
      "Artifact 工作台",
      "品質門檻",
      "來源與事實",
      "打包選擇預覽",
      "Operation 管理",
      "專案修復",
      "Tavern 相容性",
      "逐項 issue 操作",
      "逐 code 覆寫",
      "確認沿用",
      "角色圖像",
      "計畫 hash",
      "孤兒備份",
      "已歸檔",
      "（primary）",
      "裁切輸出約",
      "請重新打包",
    ]) {
      expect(html).toContain(label);
    }
    for (const endpoint of [
      "/workspace/dashboard/data",
      "/workspace/publish/preview",
      "/workspace/tavern/compat",
      "/workspace/build/preview",
      "/workspace/quality/profile",
      "/workspace/operation/",
      "/workspace/repair/preview",
      "/workspace/repair/run",
    ]) {
      expect(html).toContain(endpoint);
    }
  });

  it("exposes the dashboard data, readiness, build, repair and quality endpoints", async () => {
    const server = createWorkspaceServer({
      runtime: new WorkspaceRuntime(new MemoryProjectRepository("dashboard-endpoints")),
      actor: "dashboard-test",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const data = await (await fetch(`${base}/workspace/dashboard/data`)).json();
      expect(data.project).toMatchObject({ project_id: "dashboard-endpoints" });
      expect(Array.isArray(data.artifacts)).toBe(true);
      expect(Array.isArray(data.operations)).toBe(true);
      expect(Array.isArray(data.reviews)).toBe(true);
      expect(Array.isArray(data.issues)).toBe(true);
      expect(data.repair).toMatchObject({ plan_hash: expect.any(String), items: [] });
      const readiness = await (await fetch(`${base}/workspace/publish/preview`)).json();
      expect(typeof readiness.ok).toBe("boolean");
      expect(Array.isArray(readiness.diagnostics)).toBe(true);
      const build = await (await fetch(`${base}/workspace/build/preview`)).json();
      expect(isRecordWith(build, "entries")).toBe(true);
      const tavern = await (await fetch(`${base}/workspace/tavern/compat`)).json();
      expect(tavern.available).toBe(false);
      const repair = await (await fetch(`${base}/workspace/repair/preview`)).json();
      expect(Array.isArray(repair.items)).toBe(true);
      expect(typeof repair.plan_hash).toBe("string");
      const quality = await (await fetch(`${base}/workspace/quality/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "strict" }),
      })).json();
      expect(quality.status).toBe("completed");
      const dataAfter = await (await fetch(`${base}/workspace/dashboard/data`)).json();
      expect(dataAfter.quality?.level).toBe("strict");
      const missing = await fetch(`${base}/workspace/operation/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation_id: "missing-operation" }),
      });
      expect(missing.status).toBe(400);
      expect((await missing.json()).error).toBe("OPERATION_NOT_FOUND");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("cancels only active operations through the console fail endpoint", async () => {
    const repository = new MemoryProjectRepository("dashboard-cancel");
    const now = new Date().toISOString();
    await repository.commit(0, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        { id: "op-running", kind: "authoring", request: "Draft note: Create character: Cancel. Personality: calm.", actor: "dashboard-test", status: "running", created_at: now, updated_at: now, progress: [] },
        { id: "op-done", kind: "authoring", request: "Draft note: Create character: Done.", actor: "dashboard-test", status: "completed", created_at: now, updated_at: now, progress: [] },
      ],
    }));
    const server = createWorkspaceServer({
      runtime: new WorkspaceRuntime(repository),
      actor: "dashboard-test",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const cancelled = await (await fetch(`${base}/workspace/operation/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation_id: "op-running" }),
      })).json();
      expect(cancelled).toMatchObject({ operation_id: "op-running", status: "cancelled" });
      const state = await repository.read();
      const after = state.operations.find((item) => item.id === "op-running");
      expect(after?.status).toBe("failed");
      expect(state.audit.some((entry) => entry.operation_id === "op-running" && entry.event === "operation.failed" && entry.details.code === "OPERATION_CANCELLED")).toBe(true);
      const terminal = await fetch(`${base}/workspace/operation/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation_id: "op-done" }),
      });
      expect(terminal.status).toBe(400);
      expect((await terminal.json()).error).toBe("OPERATION_NOT_CANCELLABLE");
      const stateAfter = await repository.read();
      expect(stateAfter.operations.find((item) => item.id === "op-done")?.status).toBe("completed");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("uploads, serves and removes project cover images", async () => {
    const server = createWorkspaceServer({
      runtime: new WorkspaceRuntime(new MemoryProjectRepository("dashboard-images")),
      actor: "dashboard-test",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const png = makeTestPng(8, 4);
      const uploaded = await (await fetch(`${base}/workspace/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attachments: [{ name: "cover.png", content_base64: Buffer.from(png).toString("base64"), media_type: "image/png" }],
          aspect_ratio: "1:1",
          source: "繪師授權",
        }),
      })).json();
      expect(uploaded).toMatchObject({ image_id: expect.any(String) });
      expect(uploaded.width).toBe(4);
      expect(uploaded.height).toBe(4);
      const served = await fetch(`${base}/workspace/images/${uploaded.image_id}`);
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toBe("image/png");
      const body = new Uint8Array(await served.arrayBuffer());
      expect(Array.from(body.slice(0, 8))).toEqual(Array.from(pngSignature));
      const removed = await (await fetch(`${base}/workspace/images/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_id: uploaded.image_id }),
      })).json();
      expect(removed.status).toBe("removed");
      const missing = await fetch(`${base}/workspace/images/${uploaded.image_id}`);
      expect(missing.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});

function isRecordWith(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && key in value;
}

function makeTestPng(width: number, height: number): Buffer {
  const channels = 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * channels;
      const left = x < Math.floor(width / 2);
      raw[pixelOffset] = left ? 255 : 0;
      raw[pixelOffset + 1] = 0;
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
