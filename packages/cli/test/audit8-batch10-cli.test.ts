import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  return mkdtemp(join(tmpdir(), "cli-run-"));
}

const validBundle = {
  schema_version: 1,
  card: { project_id: "proj", project_name: "測試", display_name: "測試", mode: "zhuji", artifact_versions: { appearance: "rev-1" } },
  blueprint: "characters:\n  - display_name: Momoka",
  zhuji_modules: { appearance: "appearance content" },
};

describe("runCli", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows global help with exit code 0 and no error output", async () => {
    const collector = ioCollector();
    const exit = await runCli(["--help"], collector.io);
    expect(exit).toBe(0);
    expect(collector.out()).toContain("Usage:");
    expect(collector.out()).toContain("repair-export");
    expect(collector.err()).toBe("");
  });

  it("shows per-command help with exit code 0", async () => {
    const collector = ioCollector();
    const exit = await runCli(["repair-export", "--help"], collector.io);
    expect(exit).toBe(0);
    expect(collector.out()).toContain("repair-export");
    expect(collector.err()).toBe("");
  });

  it("does not initialize a runtime or create files when showing help", async () => {
    const directory = await tempDir();
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    const collector = ioCollector();
    const exit = await runCli(["help", "status"], collector.io);
    expect(exit).toBe(0);
    expect(collector.out()).toContain("status");
    expect(existsSync(join(directory, "projects"))).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });

  it("reports a mistyped command as a usage error with exit code 2 and a suggestion", async () => {
    const collector = ioCollector();
    const exit = await runCli(["statsu"], collector.io);
    expect(exit).toBe(2);
    expect(collector.out()).toBe("");
    expect(collector.err()).toContain('Did you mean "status"?');
    expect(collector.err()).toContain("st-workspace help");
  });

  it("reports a missing --attach value as a usage error with exit code 2", async () => {
    const collector = ioCollector();
    const exit = await runCli(["request", "--attach"], collector.io);
    expect(exit).toBe(2);
    expect(collector.err()).toContain("Missing value for --attach");
  });

  it("rejects a nonexistent attachment before any mutation with exit code 2", async () => {
    const directory = await tempDir();
    const missing = join(directory, "no-such.txt");
    const collector = ioCollector();
    const exit = await runCli(["request", "--attach", missing, "建立角色卡"], collector.io);
    expect(exit).toBe(2);
    expect(collector.err()).toContain("Cannot read attachment");
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects a directory attachment with exit code 2", async () => {
    const directory = await tempDir();
    const collector = ioCollector();
    const exit = await runCli(["request", "--attach", directory, "建立角色卡"], collector.io);
    expect(exit).toBe(2);
    expect(collector.err()).toContain("not a regular file");
    await rm(directory, { recursive: true, force: true });
  });

  it("reports a missing repair-export path as a usage error with exit code 2", async () => {
    const collector = ioCollector();
    const exit = await runCli(["repair-export"], collector.io);
    expect(exit).toBe(2);
    expect(collector.err()).toContain("requires a bundle JSON path");
  });

  it("reports a nonexistent bundle as a usage error with exit code 2", async () => {
    const collector = ioCollector();
    const exit = await runCli(["repair-export", join(tmpdir(), "definitely-not-there.json")], collector.io);
    expect(exit).toBe(2);
    expect(collector.err()).toContain("Cannot read bundle JSON");
  });

  it("reports invalid bundle JSON as a domain error with exit code 1", async () => {
    const directory = await tempDir();
    const input = join(directory, "bad.json");
    await writeFile(input, "not json at all", "utf8");
    const collector = ioCollector();
    const exit = await runCli(["repair-export", input], collector.io);
    expect(exit).toBe(1);
    expect(collector.err()).toContain("Cannot parse bundle JSON");
    expect(collector.out()).toBe("");
    await rm(directory, { recursive: true, force: true });
  });

  it("runs repair-export end to end with exit code 0 and prints both paths", async () => {
    const directory = await tempDir();
    const input = join(directory, "bundle.json");
    await writeFile(input, JSON.stringify(validBundle), "utf8");
    const output = join(directory, "card.json");
    const collector = ioCollector();
    const exit = await runCli(["repair-export", input, output], collector.io);
    expect(exit).toBe(0);
    expect(collector.err()).toBe("");
    const report = JSON.parse(collector.out()) as { json_path: string; png_path: string; content_hash: string };
    expect(report.json_path).toBe(output);
    expect(report.png_path).toBe(join(directory, "card.png"));
    expect(report.content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(await readFile(join(directory, "card.png"))).toBeDefined();
    await rm(directory, { recursive: true, force: true });
  });

  it("runs repair-export in place with exit code 0 and a backup", async () => {
    const directory = await tempDir();
    const input = join(directory, "bundle.json");
    await writeFile(input, JSON.stringify(validBundle), "utf8");
    const collector = ioCollector();
    const exit = await runCli(["repair-export", input], collector.io);
    expect(exit).toBe(0);
    const report = JSON.parse(collector.out()) as { backup_path: string };
    expect(report.backup_path).toBe(`${input}.bundle-backup.json`);
    expect(await readFile(`${input}.bundle-backup.json`, "utf8")).toBe(JSON.stringify(validBundle));
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects an extensionless output path with exit code 2 before writing", async () => {
    const directory = await tempDir();
    const input = join(directory, "bundle.json");
    await writeFile(input, JSON.stringify(validBundle), "utf8");
    const output = join(directory, "card.bundle");
    const collector = ioCollector();
    const exit = await runCli(["repair-export", input, output], collector.io);
    expect(exit).toBe(2);
    expect(collector.err()).toContain(".json");
    expect(existsSync(output)).toBe(false);
    expect(await readFile(input, "utf8")).toBe(JSON.stringify(validBundle));
    await rm(directory, { recursive: true, force: true });
  });

  it("runs the agents command with exit code 0 under a temporary project root", async () => {
    const directory = await tempDir();
    vi.stubEnv("ST_WORKSPACE_PROJECT_ROOT", directory);
    const collector = ioCollector();
    const exit = await runCli(["agents"], collector.io);
    expect(exit).toBe(0);
    const report = JSON.parse(collector.out()) as { default_agent: string; agents: unknown[] };
    expect(report.default_agent).toBe("director");
    expect(Array.isArray(report.agents)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
});
