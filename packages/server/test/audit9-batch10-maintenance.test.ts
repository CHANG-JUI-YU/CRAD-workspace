import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseJsoncFile, parseJsoncText, parseYamlText } from "../../../tools/structured-config.js";
import {
  lintAgentWorkspace,
  parseAliasDocument,
  parseOpenCodeDocument,
  parseRegistryDocument,
} from "../../../tools/agent-lint.js";
import {
  DEFAULT_SCAN_DIRECTORY,
  runTruncationScanner,
  scanTruncationDirectory,
} from "../../../tools/audit-truncation-scan.js";
import { AGENT_ALIASES, AGENT_DEFINITIONS, type AgentDefinition } from "../../runtime/src/agent-registry.js";
import { TEMPLATE_BINDINGS } from "../../core/src/templates.js";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd());

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeState(root: string, contents: string): Promise<string> {
  const projectRoot = path.join(root, "project-a");
  await mkdir(projectRoot, { recursive: true });
  const stateFile = path.join(projectRoot, "state.json");
  await writeFile(stateFile, contents, "utf8");
  return stateFile;
}

async function copyAgentFixture(): Promise<string> {
  const fixture = await temporaryDirectory("st-audit9-agent-");
  await cp(path.join(repositoryRoot, ".agents"), path.join(fixture, ".agents"), { recursive: true });
  await cp(path.join(repositoryRoot, "opencode.jsonc"), path.join(fixture, "opencode.jsonc"));
  return fixture;
}

function captureIo(): { out: string[]; err: string[]; io: { out: (message: string) => void; err: (message: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (message) => out.push(message), err: (message) => err.push(message) } };
}

describe("#149 audit truncation scanner", () => {
  it("fails when the requested directory does not exist", async () => {
    const root = await temporaryDirectory("st-audit9-scan-");
    try {
      const capture = captureIo();
      const exitCode = await runTruncationScanner([path.join(root, "missing")], capture.io);
      expect(exitCode).toBe(1);
      expect(capture.err.join("\n")).toContain("TRUNCATION_SCAN_INPUT_MISSING");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the requested path is not a directory", async () => {
    const root = await temporaryDirectory("st-audit9-scan-");
    const file = path.join(root, "state.json");
    await writeFile(file, "{}", "utf8");
    try {
      const capture = captureIo();
      const exitCode = await runTruncationScanner([file], capture.io);
      expect(exitCode).toBe(1);
      expect(capture.err.join("\n")).toContain("TRUNCATION_SCAN_INPUT_NOT_DIRECTORY");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires explicit allow-empty for an empty directory", async () => {
    const root = await temporaryDirectory("st-audit9-scan-");
    try {
      const defaultRun = captureIo();
      expect(await runTruncationScanner([root], defaultRun.io)).toBe(1);
      expect(defaultRun.err.join("\n")).toContain("EMPTY_SCAN");

      const allowedRun = captureIo();
      expect(await runTruncationScanner([root, "--allow-empty"], allowedRun.io)).toBe(0);
      expect(allowedRun.out.join("\n")).toContain("Scanned 0 state files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recognizes clean, truncated, and invalid JSON states", async () => {
    const root = await temporaryDirectory("st-audit9-scan-");
    try {
      const clean = await writeState(root, JSON.stringify({ project_name: "clean", audit: [] }));
      const truncated = path.join(root, "project-b", "state.json");
      await mkdir(path.dirname(truncated), { recursive: true });
      await writeFile(truncated, JSON.stringify({ project_name: "truncated", audit: [{ event: "blueprint.precheck.confirmed" }] }), "utf8");
      const invalid = path.join(root, "project-c", "state.json");
      await mkdir(path.dirname(invalid), { recursive: true });
      await writeFile(invalid, "{not-json", "utf8");

      const summary = await scanTruncationDirectory(root);
      expect(summary.stateFiles).toEqual([clean, truncated, invalid].sort((left, right) => left.localeCompare(right)));
      expect(summary.clean).toBe(1);
      expect(summary.truncated).toBe(1);
      expect(summary.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(["truncated", "invalid_json"]));
      expect((await runTruncationScanner([root], captureIo().io))).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("documents the default directory in CLI help", async () => {
    const capture = captureIo();
    expect(await runTruncationScanner(["--help"], capture.io)).toBe(0);
    expect(capture.out.join("\n")).toContain(DEFAULT_SCAN_DIRECTORY);
    expect(capture.out.join("\n")).toContain("--allow-empty");
    expect(capture.out.join("\n")).toContain("Exit codes");
  });
});

describe("#149 structured agent lint", () => {
  it("keeps standalone build commands and one-build check composition explicit", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts.typecheck).toContain("pnpm -r build");
    expect(packageJson.scripts.test).toContain("pnpm build");
    expect(packageJson.scripts["test:coverage"]).toContain("pnpm build");
    expect(packageJson.scripts.check).toBe("pnpm build && pnpm typecheck:only && pnpm test:only");
    expect(packageJson.scripts.check.match(/pnpm build/gu)?.length).toBe(1);
    expect(packageJson.scripts.check).not.toContain("pnpm typecheck &&");
    expect(packageJson.scripts.check).not.toContain("pnpm test &&");
  });

  it("parses the checked-in JSONC, registry YAML, and alias YAML", async () => {
    const config = parseOpenCodeDocument(await parseJsoncFile(path.join(repositoryRoot, "opencode.jsonc")), "opencode.jsonc");
    const entries = parseRegistryDocument(await parseYamlText(await readFile(path.join(repositoryRoot, ".agents", "registry.yaml"), "utf8"), ".agents/registry.yaml"));
    const aliases = parseAliasDocument(await parseYamlText(await readFile(path.join(repositoryRoot, ".agents", "aliases.yaml"), "utf8"), ".agents/aliases.yaml"));
    expect(config.mcp["st-workspace"]).toMatchObject({ type: "remote", url: "http://127.0.0.1:8787/mcp" });
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
  });

  it("accepts comments and trailing commas in JSONC", () => {
    const parsed = parseJsoncText<{ agent: { director: { prompt: string } } }>(`{
      // JSONC comment
      "agent": { "director": { "prompt": "ok", }, },
    }`, "fixture/opencode.jsonc");
    expect(parsed.agent.director.prompt).toBe("ok");
  });

  it("reports malformed JSONC and YAML with their filenames", () => {
    expect(() => parseJsoncText("{", "fixture/opencode.jsonc")).toThrow(/fixture\/opencode\.jsonc: invalid JSONC/i);
    expect(() => parseYamlText("agents: [", "fixture/registry.yaml")).toThrow(/fixture\/registry\.yaml: invalid YAML/i);
    expect(() => parseYamlText("aliases:\n  foo: [", "fixture/aliases.yaml")).toThrow(/fixture\/aliases\.yaml: invalid YAML/i);
  });

  it("validates the real resource sets and preserves shared bindings", async () => {
    const report = await lintAgentWorkspace(repositoryRoot);
    expect(report.status).toBe("ok");
    const entries = parseRegistryDocument(await parseYamlText(await readFile(path.join(repositoryRoot, ".agents", "registry.yaml"), "utf8")));
    const factReviewers = entries.filter((entry) => entry.id.startsWith("fact-reviewer-"));
    expect(new Set(factReviewers.map((entry) => entry.prompt)).size).toBe(1);
    expect(new Set(factReviewers.map((entry) => entry.personality)).size).toBe(1);
    expect(new Set(factReviewers.flatMap((entry) => entry.skills)).size).toBe(1);
  });

  it("accepts a newly bound agent without a hard-coded count", async () => {
    const fixture = await copyAgentFixture();
    try {
      const registryPath = path.join(fixture, ".agents", "registry.yaml");
      await writeFile(registryPath, `${await readFile(registryPath, "utf8")}\n  - id: fixture-agent\n    role: creator\n    prompt: .agents/agents/fixture-agent.md\n    personality: fixture-agent\n    skills: [fixture-skill]\n    intents: [fixture]\n`, "utf8");
      const aliasesPath = path.join(fixture, ".agents", "aliases.yaml");
      await writeFile(aliasesPath, `${await readFile(aliasesPath, "utf8")}\n  fixture: fixture-agent\n`, "utf8");
      await writeFile(path.join(fixture, ".agents", "agents", "fixture-agent.md"), "# Fixture Agent\n\nPersonality: .agents/personalities/fixture-agent.yaml\nSkill: .agents/skills/fixture-skill/SKILL.md\n", "utf8");
      await writeFile(path.join(fixture, ".agents", "personalities", "fixture-agent.yaml"), "schema_version: 1\nid: fixture-agent\ntone: fixture\nstyle: [concise]\nprohibited_behaviors: [inventing authority]\nextensions: { inherits: base-adult }\n", "utf8");
      await mkdir(path.join(fixture, ".agents", "skills", "fixture-skill"), { recursive: true });
      await writeFile(path.join(fixture, ".agents", "skills", "fixture-skill", "SKILL.md"), "# Fixture Skill\n\nFixture-only skill contract.\n", "utf8");
      const configPath = path.join(fixture, "opencode.jsonc");
      const config = JSON.parse(await readFile(configPath, "utf8")) as { agent: Record<string, unknown> };
      config.agent["fixture-agent"] = {
        description: "Fixture agent",
        mode: "primary",
        prompt: [
          "{file:./.agents/agents/fixture-agent.md}",
          "{file:./.agents/personalities/runtime-instructions.md}",
          "{file:./.agents/personalities/base-adult.yaml}",
          "{file:./.agents/personalities/fixture-agent.yaml}",
          "{file:./.agents/skills/fixture-skill/SKILL.md}",
        ].join("\\n\\n"),
      };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      const fixtureDefinition: AgentDefinition = {
        id: "fixture-agent",
        role: "creator",
        prompt: ".agents/agents/fixture-agent.md",
        personality: "fixture-agent",
        skills: ["fixture-skill"],
        intents: ["fixture"],
      };
      const report = await lintAgentWorkspace(fixture, {
        runtime: { definitions: [...AGENT_DEFINITIONS, fixtureDefinition], aliases: { ...AGENT_ALIASES, fixture: "fixture-agent" } },
        templateBindings: { ...TEMPLATE_BINDINGS, "fixture-skill": ["director_routing"] },
      });
      expect(report.status).toBe("ok");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("fails for missing bindings, unknown aliases, and orphan active resources", async () => {
    const missingBindingFixture = await copyAgentFixture();
    const unknownAliasFixture = await copyAgentFixture();
    const orphanFixture = await copyAgentFixture();
    try {
      const configPath = path.join(missingBindingFixture, "opencode.jsonc");
      const config = JSON.parse(await readFile(configPath, "utf8")) as { agent: Record<string, { prompt: string }> };
      config.agent.director!.prompt = config.agent.director!.prompt.replace("{file:./.agents/skills/director-orchestration/SKILL.md}", "");
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      await expect(lintAgentWorkspace(missingBindingFixture)).rejects.toThrow(/OpenCode director prompt mounts missing/);

      const aliasesPath = path.join(unknownAliasFixture, ".agents", "aliases.yaml");
      await writeFile(aliasesPath, `${await readFile(aliasesPath, "utf8")}\n  unknown: missing-agent\n`, "utf8");
      await expect(lintAgentWorkspace(unknownAliasFixture)).rejects.toThrow(/unknown agent missing-agent/);

      await writeFile(path.join(orphanFixture, ".agents", "agents", "orphan.md"), "# Orphan\n\nPersonality: .agents/personalities/director.yaml\nSkill: .agents/skills/director-orchestration/SKILL.md\n", "utf8");
      await expect(lintAgentWorkspace(orphanFixture)).rejects.toThrow(/active prompt paths orphaned\/unreferenced/);
    } finally {
      await Promise.all([
        rm(missingBindingFixture, { recursive: true, force: true }),
        rm(unknownAliasFixture, { recursive: true, force: true }),
        rm(orphanFixture, { recursive: true, force: true }),
      ]);
    }
  });
});
