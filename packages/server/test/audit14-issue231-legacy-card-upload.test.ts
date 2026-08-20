import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCardToPng } from "@st-workspace/adapters-png";
import { FileProjectRepository } from "@st-workspace/core";
import { dashboard } from "../src/dashboard.js";
import { startWorkspaceServer, type WorkspaceServer } from "../src/index.js";

const roots: string[] = [];
const MAX_LEGACY_CARD_BYTES = 5 * 1024 * 1024;

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function start(root: string): Promise<{ server: WorkspaceServer; base: string }> {
  const server = await startWorkspaceServer({ port: 0, projectRoot: root, actor: "user" }) as WorkspaceServer;
  await server.workspaceWorker.stop();
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function close(server: WorkspaceServer): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

async function upload(base: string, name: string, content: Uint8Array, mediaType?: string): Promise<Response> {
  return fetch(`${base}/workspace/legacy-card/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attachments: [{
        name,
        content_base64: Buffer.from(content).toString("base64"),
        ...(mediaType === undefined ? {} : { media_type: mediaType }),
      }],
    }),
  });
}

function ccv3Png(): Buffer {
  return writeCardToPng(undefined, {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "PNG Card",
      description: "Imported from browser bytes.",
      personality: "Calm.",
      scenario: "A room.",
      first_mes: "Hello.",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      group_only_greetings: [],
      character_book: { entries: [], extensions: {} },
      tags: [],
      creator: "audit14",
      character_version: "1.0",
      extensions: {},
    },
  });
}

describe("Audit 14 #231 legacy-card browser upload", () => {
  it("renders a direct file picker contract without exposing a filesystem-path step", () => {
    const html = dashboard();
    expect(html).toContain('input.type = "file"');
    expect(html).toContain('.png,.json,.yaml,.yml');
    expect(html).toContain('/workspace/legacy-card/import');
    expect(html).toContain('5 MiB');
    expect(html).toContain('已取消舊卡檔案選擇');
    expect(html).toContain('不會提交本機 filesystem path');
    expect(html).not.toContain('再於結構化訪談中選擇「舊卡審核」');
  });

  it("imports JSON, YAML, and PNG bytes directly on a fresh browser session without starting the legacy interview", { timeout: 60_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-a14-231-formats-"));
    roots.push(root);
    const { server, base } = await start(root);
    try {
      const before = await (await fetch(`${base}/workspace/interview/context`)).json() as { status: string; selected?: boolean };
      expect(before).toMatchObject({ status: "idle", selected: false });

      const jsonResponse = await upload(base, "browser-card.json", Buffer.from(JSON.stringify({ name: "JSON Card", description: "Remote browser JSON bytes" })), "application/json");
      expect(jsonResponse.status).toBe(200);
      expect(await jsonResponse.json()).toMatchObject({ status: "completed", project_id: "project-001" });

      const yamlResponse = await upload(base, "browser-card.yaml", Buffer.from("name: YAML Card\ndescription: Remote browser YAML bytes\n"), "text/yaml");
      expect(yamlResponse.status).toBe(200);
      expect(await yamlResponse.json()).toMatchObject({ status: "completed", project_id: "project-001" });

      const pngResponse = await upload(base, "browser-card.png", ccv3Png(), "image/png");
      expect(pngResponse.status).toBe(200);
      expect(await pngResponse.json()).toMatchObject({ status: "completed", project_id: "project-001" });

      const context = await (await fetch(`${base}/workspace/interview/context`)).json() as { status: string; flow: string; values: Record<string, string> };
      expect(context.status).toBe("idle");
      expect(context.flow).toBe("new_project");
      expect(context.values.import_path).toBeUndefined();

      const repository = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
      const state = await repository.read();
      expect(state.imports.map((item) => item.original_name)).toEqual(["browser-card.json", "browser-card.yaml", "browser-card.png"]);
      expect(state.imports.every((item) => item.status === "imported")).toBe(true);
      expect(state.artifacts.filter((item) => item.kind === "character").map((item) => item.name)).toEqual(expect.arrayContaining(["JSON Card", "YAML Card", "PNG Card"]));
    } finally {
      await close(server);
    }
  });

  it("returns understandable format, parse, and size failures", { timeout: 60_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-a14-231-errors-"));
    roots.push(root);
    const { server, base } = await start(root);
    try {
      const unsupported = await upload(base, "legacy.txt", Buffer.from("not supported"), "text/plain");
      expect(unsupported.status).toBe(400);
      expect(await unsupported.json()).toMatchObject({ code: "LEGACY_CARD_FORMAT_UNSUPPORTED", recoverable: true });

      const malformed = await upload(base, "legacy.json", Buffer.from("{not-json"), "application/json");
      expect(malformed.status).toBe(200);
      const malformedPayload = await malformed.json() as { status: string; summary: string };
      expect(malformedPayload.status).toBe("needs_input");
      expect(malformedPayload.summary).toMatch(/JSON|解析/u);

      const oversized = await upload(base, "legacy.json", Buffer.alloc(MAX_LEGACY_CARD_BYTES + 1, 0x20), "application/json");
      expect(oversized.status).toBe(400);
      expect(await oversized.json()).toMatchObject({ code: "LEGACY_CARD_TOO_LARGE", recoverable: true });
    } finally {
      await close(server);
    }
  });

  it("imports into the explicitly selected project using uploaded bytes rather than a server-side path", { timeout: 60_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-a14-231-switch-"));
    roots.push(root);
    const alpha = new FileProjectRepository(root, "alpha-folder", { layout: "project", materialize: true });
    const beta = new FileProjectRepository(root, "beta-folder", { layout: "project", materialize: true });
    await alpha.commit((await alpha.read()).revision, (state) => ({ ...state, project_name: "Alpha", project_status: "ready" as const }));
    await beta.commit((await beta.read()).revision, (state) => ({ ...state, project_name: "Beta", project_status: "ready" as const }));

    const { server, base } = await start(root);
    try {
      const selected = await fetch(`${base}/workspace/project/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: "beta-folder" }),
      });
      expect(selected.status).toBe(200);
      expect(await selected.json()).toMatchObject({ project_id: "beta-folder", project_name: "Beta" });

      const response = await upload(base, "remote-browser-card.json", Buffer.from(JSON.stringify({ name: "Remote Card", description: "No server-side file exists for this upload." })), "application/json");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "completed", project_id: "beta-folder", project_name: "Beta" });

      expect((await alpha.read()).imports).toHaveLength(0);
      const betaState = await beta.read();
      expect(betaState.imports).toHaveLength(1);
      expect(betaState.imports[0]?.original_name).toBe("remote-browser-card.json");
      expect(betaState.interview.values.import_path).toBeUndefined();
    } finally {
      await close(server);
    }
  });
});
