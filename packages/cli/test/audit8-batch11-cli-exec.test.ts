import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliIo } from "../src/cli.js";

function ioCollector(): { io: CliIo; out(): string; err(): string } {
  let out = "";
  let err = "";
  return {
    io: { out: (text) => (out += text), err: (text) => (err += text) },
    out: () => out,
    err: () => err,
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cli-exec-"));
}

describe("Audit 8 Batch 11: CLI execution paths (#112 coverage)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("status without a selected project reports through the project manager", async () => {
    const directory = await tempDir();
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    const collector = ioCollector();
    const exit = await runCli(["status"], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const body = JSON.parse(collector.out()) as { status: string; project_id: string };
    expect(body.status).toBeDefined();
    expect(body.project_id).toBeDefined();
    await rm(directory, { recursive: true, force: true });
  });

  it("agents with a selected project builds a direct runtime", async () => {
    const directory = await tempDir();
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    vi.stubEnv("ST_WORKSPACE_PROJECT", "direct-project");
    const collector = ioCollector();
    const exit = await runCli(["agents"], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const body = JSON.parse(collector.out()) as { default_agent: string; agents: unknown[] };
    expect(body.default_agent).toBe("director");
    expect(Array.isArray(body.agents)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("status with a selected project reports the direct runtime status", async () => {
    const directory = await tempDir();
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    vi.stubEnv("ST_WORKSPACE_PROJECT", "direct-project");
    const collector = ioCollector();
    const exit = await runCli(["status"], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const body = JSON.parse(collector.out()) as { status: string };
    expect(body.status).toBe("completed");
    await rm(directory, { recursive: true, force: true });
  });

  it("import-legacy inspects a legacy folder and reports candidates and warnings", async () => {
    const directory = await tempDir();
    await writeFile(join(directory, "character.json"), JSON.stringify({ kind: "character", name: "Legacy Card", description: "d" }));
    await writeFile(join(directory, "notes.md"), "# Notes");
    await writeFile(join(directory, "broken.json"), "not-json{");
    await writeFile(join(directory, "image.png"), Buffer.from([1, 2, 3]));
    const collector = ioCollector();
    const exit = await runCli(["import-legacy", directory], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const body = JSON.parse(collector.out()) as {
      files: Array<{ relative_path: string; media_type: string }>;
      candidates: Array<{ kind: string; name: string }>;
      unsupported: string[];
      warnings: string[];
    };
    expect(body.files).toHaveLength(4);
    expect(body.candidates.some((candidate) => candidate.kind === "artifact" && candidate.name === "Legacy Card")).toBe(true);
    expect(body.candidates.some((candidate) => candidate.kind === "source" && candidate.name === "notes.md")).toBe(true);
    expect(body.unsupported).toEqual(["image.png"]);
    expect(body.warnings.some((warning) => warning.includes("broken.json"))).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("import-legacy on a missing folder is an unexpected fatal error", async () => {
    const collector = ioCollector();
    const exit = await runCli(["import-legacy", join(tmpdir(), "does-not-exist-anything")], collector.io);
    expect(exit).toBe(70);
    expect(collector.err()).toContain("Unexpected error:");
    expect(collector.out()).toBe("");
  });

  it("request with attachments starts the interview through the project manager", async () => {
    const directory = await tempDir();
    await writeFile(join(directory, "reference.txt"), "reference text");
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    const collector = ioCollector();
    const exit = await runCli(["request", "--attach", join(directory, "reference.txt"), "建立新專案"], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const body = JSON.parse(collector.out()) as { status: string; question: string | undefined };
    expect(body.status).toBe("needs_input");
    expect(typeof body.question).toBe("string");
    expect(body.question!.length).toBeGreaterThan(0);
    await rm(directory, { recursive: true, force: true });
  });

  it("request with a selected project attaches files through the direct runtime", async () => {
    const directory = await tempDir();
    await writeFile(join(directory, "attachment.txt"), "payload");
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    vi.stubEnv("ST_WORKSPACE_PROJECT", "request-project");
    const collector = ioCollector();
    const exit = await runCli(["request", "--attach", join(directory, "attachment.txt"), "建立新專案"], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const body = JSON.parse(collector.out()) as { status: string; question: string | undefined };
    expect(body.status).toBe("needs_input");
    expect(typeof body.question).toBe("string");
    expect(body.question!.length).toBeGreaterThan(0);
    await rm(directory, { recursive: true, force: true });
  });
});
