import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { contentHash, MemoryProjectRepository, type ArtifactRecord } from "@st-workspace/core";
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
      "建立 Review Run",
      "送出裁決",
      "Director 解析",
      "事實裁決需要原因",
      "目前版本",
      "與前一版差異",
      "送審",
      "下載",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("後續提供");
    for (const endpoint of [
      "/workspace/dashboard/data",
      "/workspace/publish/preview",
      "/workspace/tavern/compat",
      "/workspace/build/preview",
      "/workspace/quality/profile",
      "/workspace/operation/",
      "/workspace/repair/preview",
      "/workspace/repair/run",
      "/workspace/fact/review/run",
      "/workspace/fact/review/batch",
      "/workspace/fact/review/conflict",
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
      expect(data.counts).toMatchObject({ artifacts: 0, facts: 0, operations: 0, audit_events: 0 });
      expect(data.repair).toMatchObject({ plan_hash: expect.any(String), item_count: 0 });
      expect(data.artifacts).toBeUndefined();
      expect(data.facts).toBeUndefined();
      for (const endpoint of [
        "/workspace/dashboard/artifacts?limit=2",
        "/workspace/dashboard/facts?limit=2",
        "/workspace/dashboard/sources?limit=2",
        "/workspace/dashboard/candidates?limit=2",
        "/workspace/dashboard/operations?limit=2",
        "/workspace/dashboard/audit?limit=2",
        "/workspace/dashboard/issues?limit=2",
        "/workspace/dashboard/reviews?limit=2",
        "/workspace/dashboard/fact-review/runs?limit=2",
        "/workspace/dashboard/publishes?limit=2",
        "/workspace/dashboard/builds?limit=2",
      ]) {
        const page = await (await fetch(`${base}${endpoint}`)).json();
        expect(Array.isArray(page.items)).toBe(true);
        expect(typeof page.total).toBe("number");
        expect(typeof page.limit).toBe("number");
      }
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
      expect((await missing.json()).code).toBe("OPERATION_NOT_FOUND");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("pages dashboard resources and keeps artifact content behind detail/history", async () => {
    const repository = new MemoryProjectRepository("dashboard-read-model");
    const timestamp = new Date().toISOString();
    const content = "private artifact content";
    const record: ArtifactRecord = {
      id: "artifact-read-model",
      key: "character:alpha",
      kind: "character",
      name: "Alpha",
      content,
      media_type: "text/plain",
      content_hash: contentHash(content),
      revision: contentHash("revision"),
      status: "draft",
      created_at: timestamp,
      updated_at: timestamp,
      created_by: "test",
      operation_id: "seed",
    };
    await repository.commit(0, (state) => ({ ...state, artifacts: [record] }));
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(repository), actor: "dashboard-test", autoStartWorker: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const list = await (await fetch(`${base}/workspace/dashboard/artifacts?limit=1`)).json();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).not.toHaveProperty("content");
      const detail = await (await fetch(`${base}/workspace/dashboard/artifacts/${record.id}`)).json();
      expect(detail).toMatchObject({ id: record.id, content });
      const history = await (await fetch(`${base}/workspace/dashboard/artifacts/${encodeURIComponent(record.key)}/history?limit=1`)).json();
      expect(history.items).toHaveLength(1);
      expect(history.items[0]).not.toHaveProperty("content");
      const filtered = await (await fetch(`${base}/workspace/dashboard/artifacts?limit=1&filter=${encodeURIComponent(JSON.stringify({ kind: "character" }))}`)).json();
      expect(filtered.items).toHaveLength(1);
      const invalid = await fetch(`${base}/workspace/dashboard/artifacts?limit=0`);
      expect(invalid.status).toBe(400);
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
        body: JSON.stringify({ operation_id: "op-done" }),
      })).json();
      expect(cancelled.code).toBe("OPERATION_NOT_CANCELLABLE");
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
