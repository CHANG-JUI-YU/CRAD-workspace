import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { diagnosticReportSchema, proposalSchema } from "@card-workspace/schemas";
import { parse as parseYaml } from "yaml";

import { lintAgentConfiguration } from "../src/agent-lint.js";
import { runAgentLintCli } from "../src/agent-lint-cli.js";
import { loadWorkflowConfig } from "../src/config-loader.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const temporaryRoots: string[] = [];

type Assets = { references?: string[]; fixtures?: string[] };

async function createFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "card-workspace-agent-lint-"));
  temporaryRoots.push(root);
  await cp(resolve(workspaceRoot, "workflow"), resolve(root, "workflow"), { recursive: true });
  await cp(resolve(workspaceRoot, "opencode.jsonc"), resolve(root, "opencode.jsonc"));
  const config = await loadWorkflowConfig(root);
  for (const agent of config.registry.agents) {
    const assets = agent.extensions as Assets;
    const files = [agent.agent_file, `.agents/skills/${agent.skill}/SKILL.md`, ...(assets.references ?? []), ...(assets.fixtures ?? [])];
    for (const file of files) {
      await mkdir(resolve(root, file, ".."), { recursive: true });
      await writeFile(resolve(root, file), "fixture\n", "utf8");
    }
  }
  return root;
}

async function replace(root: string, file: string, oldValue: string, newValue: string): Promise<void> {
  const path = resolve(root, file);
  const source = await readFile(path, "utf8");
  expect(source).toContain(oldValue);
  await writeFile(path, source.replace(oldValue, newValue), "utf8");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent-lint", () => {
  it("Zhuji Creator fixture 符合現行單模組 proposal 契約", async () => {
    const source = await readFile(resolve(workspaceRoot, ".agents/skills/zhuji-creation/fixtures/proposal.yaml"), "utf8");
    expect(proposalSchema.safeParse(parseYaml(source)).success).toBe(true);
  });

  it("cross-reference plugin agents、skills、schema、capability 與 tool", async () => {
    const root = await createFixture();
    const config = await loadWorkflowConfig(root);
    expect(config.registry.agents).toHaveLength(22);
    expect(new Set(config.registry.agents.map((agent) => agent.skill))).toHaveLength(20);
    expect(config.personalities).toHaveLength(22);
    expect(config.personalities.some((profile) => profile.id === "base-adult")).toBe(true);
    for (const agent of config.registry.agents) {
      expect(config.personalities.some((profile) => profile.id === agent.personality)).toBe(true);
    }
    await expect(lintAgentConfiguration({ root })).resolves.toEqual({ ok: true, diagnostics: [] });
  });

  it.each([
    ["SCHEMA_UNREGISTERED", "workflow/agent-registry.yaml", "output_contracts: [workflow-state@2, proposal@1]", "output_contracts: [missing@1, proposal@1]"],
    ["CAPABILITY_UNREGISTERED", "workflow/agent-registry.yaml", "capabilities: [workflow.read, task.execute, source.process, facts.propose, facts.read]", "capabilities: [missing.capability]"],
    ["TOOL_UNREGISTERED", "workflow/tool-policy.yaml", "tools: [workflow_status]", "tools: [missing_tool]"],
  ])("未註冊引用回 stable diagnostic %s", async (code, file, oldValue, newValue) => {
    const root = await createFixture();
    await replace(root, file, oldValue, newValue);
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain(code);
  });

  it("阻止 YAML 擴張 TypeScript tool invariant", async () => {
    const root = await createFixture();
    await replace(root, "workflow/tool-policy.yaml", "tools: [project_publish]\n    stages: [publish_review, published]\n    mutation: true", "tools: [project_publish]\n    stages: [publish_review, published]\n    mutation: false");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("TOOL_INVARIANT_EXPANDED");
  });

  it("隔離 Creator generation reference 與 Critic negative reference", async () => {
    const root = await createFixture();
    await replace(root, "workflow/agent-registry.yaml", ".agents/skills/zhuji-creation/references/generation-guide.md", ".agents/skills/zhuji-creation/references/negative-rules.md");
    await mkdir(resolve(root, ".agents/skills/zhuji-creation/references"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/zhuji-creation/references/negative-rules.md"), "fixture\n");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("CREATOR_CRITIC_REFERENCE_FORBIDDEN");
  });

  it("偵測 delegation cycle 與孤兒 Agent/Skill/reference/fixture", async () => {
    const root = await createFixture();
    await replace(root, "workflow/agent-registry.yaml", "extensions: { references: [.agents/skills/fact-curation/references/extraction.md]", "extensions: { delegates: [director], skill_dependencies: [zhuji-creation], references: [.agents/skills/fact-curation/references/extraction.md]");
    await replace(root, "workflow/agent-registry.yaml", "    extensions:\n      references:\n        - .agents/skills/zhuji-creation/references/generation-guide.md", "    extensions:\n      skill_dependencies: [fact-curation]\n      references:\n        - .agents/skills/zhuji-creation/references/generation-guide.md");
    await mkdir(resolve(root, ".opencode/prompts"), { recursive: true });
    await writeFile(resolve(root, ".opencode/prompts/orphan.md"), "orphan\n");
    await mkdir(resolve(root, ".agents/skills/orphan/references"), { recursive: true });
    await mkdir(resolve(root, ".agents/skills/orphan/fixtures"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/orphan/SKILL.md"), "orphan\n");
    await writeFile(resolve(root, ".agents/skills/orphan/references/rule.md"), "orphan\n");
    await writeFile(resolve(root, ".agents/skills/orphan/fixtures/example.yaml"), "orphan\n");
    const codes = (await lintAgentConfiguration({ root })).diagnostics.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["AGENT_DELEGATION_CYCLE", "SKILL_REFERENCE_CYCLE", "AGENT_ORPHAN", "SKILL_ORPHAN", "REFERENCE_ORPHAN", "FIXTURE_ORPHAN"]));
  });

  it("personality schema 拒絕權限欄位", async () => {
    const root = await createFixture();
    await replace(root, "workflow/personalities/default-neutral.yaml", "extensions: {}", "permissions: [project_publish]\nextensions: {}");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("CONFIG_SCHEMA_INVALID");
  });

  it("偵測 Agent personality 未強制繼承共用基底", async () => {
    const root = await createFixture();
    await replace(root, "workflow/personalities/director.yaml", "extensions: { inherits: base-adult, inheritance_required: true }", "extensions: {}");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("PERSONALITY_BASE_BINDING_INVALID");
  });

  it("偵測 registry personality 未綁入 OpenCode prompt", async () => {
    const root = await createFixture();
    await replace(root, "opencode.jsonc", "{file:./workflow/personalities/director.yaml}", "{file:./workflow/personalities/fact-curator.yaml}");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("AGENT_PROMPT_BINDING_INVALID");
  });

  it("偵測共用 personality 基底未綁入 OpenCode prompt", async () => {
    const root = await createFixture();
    await replace(root, "opencode.jsonc", "{file:./workflow/personalities/base-adult.yaml}", "{file:./workflow/personalities/default-neutral.yaml}");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("AGENT_PROMPT_BINDING_INVALID");
  });

  it("偵測 personality runtime 指令未綁入 OpenCode prompt", async () => {
    const root = await createFixture();
    await replace(root, "opencode.jsonc", "{file:./workflow/personalities/runtime-instructions.md}", "runtime instructions missing");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("AGENT_PROMPT_BINDING_INVALID");
  });

  it("偵測 Skill reference 未綁入 OpenCode prompt", async () => {
    const root = await createFixture();
    await replace(root, "opencode.jsonc", "{file:./.agents/skills/director-orchestration/references/workflow-routing.md}", "workflow routing missing");
    const report = await lintAgentConfiguration({ root });
    expect(report.diagnostics.map((item) => item.code)).toContain("AGENT_PROMPT_BINDING_INVALID");
  });

  it("CLI 輸出 machine JSON 且失敗為 nonzero", async () => {
    const root = await createFixture();
    await replace(root, "workflow/tool-policy.yaml", "tools: [workflow_status]", "tools: [missing_tool]");
    let stdout = "";
    let stderr = "";
    const exitCode = await runAgentLintCli([root], {
      stdout: { write: (value) => { stdout += String(value); return true; } },
      stderr: { write: (value) => { stderr += String(value); return true; } },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    const parsed = diagnosticReportSchema.parse(JSON.parse(stdout) as unknown);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBeTypeOf("string");
  });
  it("covers config load failures, missing assets, and isolation diagnostics", async () => {
    const missing = await createFixture();
    await rm(resolve(missing, "workflow/tool-policy.yaml"));
    expect((await lintAgentConfiguration({ root: missing })).diagnostics.map((item) => item.code)).toContain("CONFIG_READ_FAILED");

    const invalidYaml = await createFixture();
    await writeFile(resolve(invalidYaml, "workflow/tool-policy.yaml"), "[invalid", "utf8");
    expect((await lintAgentConfiguration({ root: invalidYaml })).diagnostics.map((item) => item.code)).toContain("CONFIG_YAML_INVALID");

    const invalidSchema = await createFixture();
    await writeFile(resolve(invalidSchema, "workflow/tool-policy.yaml"), "schema_version: 1\nrules: nope\n", "utf8");
    expect((await lintAgentConfiguration({ root: invalidSchema })).diagnostics.map((item) => item.code)).toContain("CONFIG_SCHEMA_INVALID");

    const missingAsset = await createFixture();
    await rm(resolve(missingAsset, ".opencode/prompts/director.md"));
    expect((await lintAgentConfiguration({ root: missingAsset })).diagnostics.map((item) => item.code)).toContain("AGENT_FILE_NOT_FOUND");

    const unregistered = await createFixture();
    await replace(unregistered, "workflow/agent-registry.yaml", ".agents/skills/fact-curation/references/extraction.md", ".agents/skills/not-a-skill/references/missing.md");
    const unregisteredCodes = (await lintAgentConfiguration({ root: unregistered })).diagnostics.map((item) => item.code);
    expect(unregisteredCodes).toEqual(expect.arrayContaining(["REFERENCE_NOT_FOUND", "REFERENCE_UNREGISTERED"]));

    const criticMutation = await createFixture();
    await replace(criticMutation, "workflow/agent-registry.yaml", "capabilities: [workflow.read, plugin.read, task.execute, facts.read, review.submit]", "capabilities: [workflow.read, plugin.read, task.execute, facts.read, review.submit, plugin.mvu.propose]");
    expect((await lintAgentConfiguration({ root: criticMutation })).diagnostics.map((item) => item.code)).toContain("CRITIC_MUTATION_CAPABILITY_FORBIDDEN");

    const creatorReview = await createFixture();
    await replace(creatorReview, "workflow/agent-registry.yaml", "capabilities: [workflow.read, plugin.read, task.execute, task.clarify, plugin.mvu.propose]", "capabilities: [workflow.read, plugin.read, task.execute, task.clarify, plugin.mvu.propose, review.submit]");
    expect((await lintAgentConfiguration({ root: creatorReview })).diagnostics.map((item) => item.code)).toContain("CREATOR_REVIEW_CAPABILITY_FORBIDDEN");
  });

  it("covers missing OpenCode config, fixture assets, and unregistered references", async () => {
    const noOpenCode = await createFixture();
    await rm(resolve(noOpenCode, "opencode.jsonc"));
    expect((await lintAgentConfiguration({ root: noOpenCode })).diagnostics.map((item) => item.code))
      .toContain("OPENCODE_CONFIG_READ_FAILED");

    const missingFixture = await createFixture();
    const fixtureConfig = await loadWorkflowConfig(missingFixture);
    const fixturePath = (fixtureConfig.registry.agents.find((agent) => (agent.extensions as Assets).fixtures?.length)?.extensions as Assets).fixtures?.[0];
    if (!fixturePath) throw new Error("fixture path missing");
    await rm(resolve(missingFixture, fixturePath));
    expect((await lintAgentConfiguration({ root: missingFixture })).diagnostics.map((item) => item.code))
      .toContain("FIXTURE_NOT_FOUND");

    const unknownPersonality = await createFixture();
    await replace(unknownPersonality, "workflow/agent-registry.yaml", "personality: director", "personality: missing-personality");
    expect((await lintAgentConfiguration({ root: unknownPersonality })).diagnostics.map((item) => item.code))
      .toContain("PERSONALITY_UNREGISTERED");

    const unknownDelegate = await createFixture();
    await replace(unknownDelegate, "workflow/agent-registry.yaml", "extensions: { references: [.agents/skills/fact-curation/references/extraction.md]", "extensions: { delegates: [missing-agent], references: [.agents/skills/fact-curation/references/extraction.md]");
    expect((await lintAgentConfiguration({ root: unknownDelegate })).diagnostics.map((item) => item.code))
      .toContain("AGENT_UNREGISTERED");
  });
});
