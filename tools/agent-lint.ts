import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AGENT_ALIASES, AGENT_DEFINITIONS, type AgentDefinition } from "../packages/runtime/src/agent-registry.js";
import { TEMPLATE_BINDINGS } from "../packages/core/src/templates.js";
import { parseJsoncFile, parseYamlFile, StructuredConfigError } from "./structured-config.js";

const DEFAULT_ROOT = process.cwd();
const FOUNDATION_PERSONALITIES = ["base-adult.yaml", "default-neutral.yaml"] as const;
const RUNTIME_INSTRUCTIONS = "runtime-instructions.md";

export interface RegistryAgent {
  readonly id: string;
  readonly role: string;
  readonly prompt: string;
  readonly personality: string;
  readonly skills: readonly string[];
  readonly intents: readonly string[];
  readonly shared_executor?: string;
  readonly read_only?: boolean;
}

export interface OpenCodeAgentConfig {
  readonly prompt: string;
  readonly mode: string;
  readonly permission?: Record<string, unknown>;
}

export interface OpenCodeConfig {
  readonly default_agent?: string;
  readonly agent: Readonly<Record<string, OpenCodeAgentConfig>>;
  readonly mcp: Readonly<Record<string, Record<string, unknown>>>;
}

export interface RuntimeRegistryContract {
  readonly definitions: readonly AgentDefinition[];
  readonly aliases: Readonly<Record<string, string>>;
}

export interface AgentLintDependencies {
  readonly runtime?: RuntimeRegistryContract;
  readonly templateBindings?: Readonly<Record<string, readonly unknown[]>>;
}

export interface AgentLintReport {
  readonly root: string;
  readonly registryAgents: number;
  readonly prompts: number;
  readonly personalities: number;
  readonly skills: number;
  readonly aliases: number;
  readonly status: "ok";
}

export class AgentLintError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(failures.join("\n"));
    this.name = "AgentLintError";
  }
}

class AgentShapeError extends Error {
  constructor(readonly filePath: string, location: string, message: string) {
    super(`${filePath}: invalid ${location}: ${message}`);
    this.name = "AgentShapeError";
  }
}

const defaultDependencies: Required<AgentLintDependencies> = {
  runtime: { definitions: AGENT_DEFINITIONS, aliases: AGENT_ALIASES },
  templateBindings: TEMPLATE_BINDINGS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, filePath: string, location: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AgentShapeError(filePath, location, "expected an object");
  return value;
}

function stringValue(value: unknown, filePath: string, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new AgentShapeError(filePath, location, "expected a non-empty string");
  return value.trim();
}

function optionalString(value: unknown, filePath: string, location: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, filePath, location);
}

function stringArray(value: unknown, filePath: string, location: string): string[] {
  if (!Array.isArray(value)) throw new AgentShapeError(filePath, location, "expected an array");
  return value.map((item, index) => stringValue(item, filePath, `${location}[${index}]`));
}

function optionalBoolean(value: unknown, filePath: string, location: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new AgentShapeError(filePath, location, "expected a boolean");
  return value;
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function parseRegistryDocument(value: unknown, filePath = ".agents/registry.yaml"): readonly RegistryAgent[] {
  const root = record(value, filePath, "root");
  if (root.schema_version !== undefined && (typeof root.schema_version !== "number" || !Number.isInteger(root.schema_version))) {
    throw new AgentShapeError(filePath, "schema_version", "expected an integer");
  }
  const agents = root.agents;
  if (!Array.isArray(agents)) throw new AgentShapeError(filePath, "agents", "expected an array");
  return agents.map((valueAtIndex, index) => {
    const location = `agents[${index}]`;
    const item = record(valueAtIndex, filePath, location);
    const readOnly = optionalBoolean(item.read_only, filePath, `${location}.read_only`);
    return {
      id: stringValue(item.id, filePath, `${location}.id`).toLocaleLowerCase(),
      role: stringValue(item.role, filePath, `${location}.role`),
      prompt: normalizedPath(stringValue(item.prompt, filePath, `${location}.prompt`)),
      personality: stringValue(item.personality, filePath, `${location}.personality`).toLocaleLowerCase(),
      skills: stringArray(item.skills, filePath, `${location}.skills`).map((skill) => skill.toLocaleLowerCase()),
      intents: stringArray(item.intents, filePath, `${location}.intents`),
      ...(item.shared_executor === undefined ? {} : { shared_executor: stringValue(item.shared_executor, filePath, `${location}.shared_executor`) }),
      ...(readOnly === undefined ? {} : { read_only: readOnly }),
    };
  });
}

export function parseAliasDocument(value: unknown, filePath = ".agents/aliases.yaml"): Readonly<Record<string, string>> {
  const root = record(value, filePath, "root");
  const aliasesValue = record(root.aliases, filePath, "aliases");
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(aliasesValue)) {
    const normalizedAlias = stringValue(alias, filePath, `aliases key`).toLocaleLowerCase();
    aliases[normalizedAlias] = stringValue(target, filePath, `aliases.${alias}`).toLocaleLowerCase();
  }
  return aliases;
}

function parseOpenCodeAgent(value: unknown, filePath: string, agentId: string): OpenCodeAgentConfig {
  const item = record(value, filePath, `agent.${agentId}`);
  const permissionValue = item.permission;
  const permission = permissionValue === undefined ? undefined : record(permissionValue, filePath, `agent.${agentId}.permission`);
  return {
    prompt: stringValue(item.prompt, filePath, `agent.${agentId}.prompt`),
    mode: stringValue(item.mode, filePath, `agent.${agentId}.mode`),
    ...(permission === undefined ? {} : { permission }),
  };
}

export function parseOpenCodeDocument(value: unknown, filePath = "opencode.jsonc"): OpenCodeConfig {
  const root = record(value, filePath, "root");
  const agentsValue = record(root.agent, filePath, "agent");
  const agents: Record<string, OpenCodeAgentConfig> = {};
  for (const [agentId, agentValue] of Object.entries(agentsValue)) agents[agentId.toLocaleLowerCase()] = parseOpenCodeAgent(agentValue, filePath, agentId);
  const mcpValue = record(root.mcp, filePath, "mcp");
  const mcp: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(mcpValue)) mcp[name] = record(config, filePath, `mcp.${name}`);
  if (root.default_agent !== undefined) stringValue(root.default_agent, filePath, "default_agent");
  return {
    ...(root.default_agent === undefined ? {} : { default_agent: stringValue(root.default_agent, filePath, "default_agent") }),
    agent: agents,
    mcp,
  };
}

function promptMounts(prompt: string): readonly string[] {
  return [...prompt.matchAll(/\{file:([^}]+)\}/gu)].map((match) => normalizedPath(match[1] ?? ""));
}

function promptBinding(prompt: string, label: "Personality" | "Skill"): string | undefined {
  if (label === "Personality") return prompt.match(/^Personality:\s*\.agents\/personalities\/([^\s]+\.yaml)\s*$/imu)?.[1];
  return prompt.match(/^Skill:\s*\.agents\/skills\/([^\s]+\/SKILL\.md)\s*$/imu)?.[1];
}

function relativeFiles(root: string, values: readonly string[]): Set<string> {
  return new Set(values.map((value) => normalizedPath(path.relative(root, value))));
}

function setDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort((a, b) => a.localeCompare(b));
}

function checkSet(failures: string[], label: string, expected: ReadonlySet<string>, actual: ReadonlySet<string>): void {
  const missing = setDifference(expected, actual);
  const orphaned = setDifference(actual, expected);
  if (missing.length > 0) failures.push(`${label} missing: ${missing.join(", ")}`);
  if (orphaned.length > 0) failures.push(`${label} orphaned/unreferenced: ${orphaned.join(", ")}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryEntries(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

async function directoryNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

async function validatePersonalityFiles(root: string, files: readonly string[], failures: string[]): Promise<void> {
  const availableIds = new Set(files.map((file) => path.basename(file, ".yaml")));
  for (const file of files) {
    const filePath = path.join(root, ".agents", "personalities", file);
    let parsed: unknown;
    try {
      parsed = await parseYamlFile(filePath);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${filePath}: ${String(error)}`);
      continue;
    }
    const item = record(parsed, filePath, "root");
    try {
      if (stringValue(item.id, filePath, "id").toLocaleLowerCase() !== path.basename(file, ".yaml").toLocaleLowerCase()) failures.push(`${filePath}: id must match the filename`);
      stringValue(item.tone, filePath, "tone");
      stringArray(item.style, filePath, "style");
      stringArray(item.prohibited_behaviors, filePath, "prohibited_behaviors");
      const extensions = record(item.extensions, filePath, "extensions");
      if (extensions.inherits !== undefined) {
        const parent = stringValue(extensions.inherits, filePath, "extensions.inherits");
        if (!availableIds.has(parent)) failures.push(`${filePath}: extensions.inherits points to missing personality ${parent}`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${filePath}: ${String(error)}`);
    }
  }
}

async function validatePromptFiles(root: string, promptFiles: readonly string[], failures: string[]): Promise<void> {
  for (const file of promptFiles) {
    const filePath = path.join(root, file);
    const contents = await readFile(filePath, "utf8");
    const personality = promptBinding(contents, "Personality");
    const skill = promptBinding(contents, "Skill");
    if (personality === undefined) failures.push(`${file}: missing Personality binding`);
    if (skill === undefined) failures.push(`${file}: missing Skill binding`);
    if (personality !== undefined && !(await exists(path.join(root, ".agents", "personalities", personality)))) failures.push(`${file}: personality binding does not exist: ${personality}`);
    if (skill !== undefined && !(await exists(path.join(root, ".agents", "skills", skill)))) failures.push(`${file}: skill binding does not exist: ${skill}`);
  }
}

async function validateRuntimeInstructions(root: string, failures: string[]): Promise<void> {
  const filePath = path.join(root, ".agents", "personalities", RUNTIME_INSTRUCTIONS);
  const contents = await readFile(filePath, "utf8");
  for (const requiredInstruction of [
    "必須實際執行的行為指令",
    "每次對使用者輸出時",
    "不得於流程性輸出或提問時暫停、重置或退回中性口吻",
    "prohibited_behaviors",
  ]) {
    if (!contents.includes(requiredInstruction)) failures.push(`${filePath}: missing runtime instruction: ${requiredInstruction}`);
  }
}

async function validateActiveContracts(root: string, promptFiles: readonly string[], skillIds: ReadonlySet<string>, failures: string[]): Promise<void> {
  const banned = /\b(?:task_id|lease_id|batch_id|candidate_id|revision|capability|file_path|bytes_base64|source_research_approve|source_research_fetch_approved)\b/iu;
  const files = [
    ...promptFiles.map((file) => path.join(root, file)),
    ...[...skillIds].map((skill) => path.join(root, ".agents", "skills", skill, "SKILL.md")),
  ];
  for (const filePath of files) {
    const contents = await readFile(filePath, "utf8");
    if (banned.test(contents)) failures.push(`active contract contains low-level token: ${path.relative(root, filePath)}`);
  }
}

function validateOpenCodeMcp(config: OpenCodeConfig, failures: string[]): void {
  const mcp = config.mcp["st-workspace"];
  if (mcp === undefined) {
    failures.push("opencode.jsonc: missing mcp.st-workspace");
    return;
  }
  if (mcp.type !== "remote") failures.push("opencode.jsonc: mcp.st-workspace.type must be \"remote\"");
  if (typeof mcp.url !== "string" || mcp.url.length === 0) failures.push("opencode.jsonc: mcp.st-workspace.url must be a non-empty string");
  if (typeof mcp.enabled !== "boolean") failures.push("opencode.jsonc: mcp.st-workspace.enabled must be a boolean");
  if (typeof mcp.oauth !== "boolean") failures.push("opencode.jsonc: mcp.st-workspace.oauth must be a boolean");
}

function compareRuntimeRegistry(
  entries: readonly RegistryAgent[],
  aliases: Readonly<Record<string, string>>,
  runtime: RuntimeRegistryContract,
  failures: string[],
): void {
  const registryById = new Map(entries.map((entry) => [entry.id, entry]));
  const runtimeById = new Map(runtime.definitions.map((entry) => [entry.id.toLocaleLowerCase(), entry]));
  checkSet(failures, "runtime agent ids", new Set(registryById.keys()), new Set(runtimeById.keys()));
  for (const entry of entries) {
    const runtimeEntry = runtimeById.get(entry.id);
    if (runtimeEntry === undefined) continue;
    if (runtimeEntry.role !== entry.role) failures.push(`agent ${entry.id}: runtime role does not match registry`);
    if (normalizedPath(runtimeEntry.prompt) !== entry.prompt) failures.push(`agent ${entry.id}: runtime prompt does not match registry`);
    if (runtimeEntry.personality !== entry.personality) failures.push(`agent ${entry.id}: runtime personality does not match registry`);
    checkSet(failures, `agent ${entry.id} skills`, new Set(entry.skills), new Set(runtimeEntry.skills));
    const registryReadOnly = entry.read_only ?? false;
    const runtimeReadOnly = runtimeEntry.read_only ?? false;
    if (registryReadOnly !== runtimeReadOnly) failures.push(`agent ${entry.id}: runtime read_only does not match registry`);
  }
  const runtimeAliases = Object.fromEntries(Object.entries(runtime.aliases).map(([alias, target]) => [alias.toLocaleLowerCase(), target.toLocaleLowerCase()]));
  checkSet(failures, "agent aliases", new Set(Object.keys(aliases)), new Set(Object.keys(runtimeAliases)));
  for (const [alias, target] of Object.entries(aliases)) {
    if (target !== runtimeAliases[alias]) failures.push(`alias ${alias}: runtime target does not match registry (${target})`);
    if (!registryById.has(target)) failures.push(`alias ${alias} targets unknown agent ${target}`);
  }
  for (const [alias, target] of Object.entries(runtimeAliases)) {
    if (aliases[alias] === undefined) failures.push(`runtime alias ${alias} is missing from .agents/aliases.yaml`);
    if (!registryById.has(target)) failures.push(`runtime alias ${alias} targets unknown agent ${target}`);
  }
}

export async function lintAgentWorkspace(root = DEFAULT_ROOT, dependencies: AgentLintDependencies = {}): Promise<AgentLintReport> {
  const resolvedRoot = path.resolve(root);
  const runtime = dependencies.runtime ?? defaultDependencies.runtime;
  const templateBindings = dependencies.templateBindings ?? defaultDependencies.templateBindings;
  const registryPath = path.join(resolvedRoot, ".agents", "registry.yaml");
  const aliasesPath = path.join(resolvedRoot, ".agents", "aliases.yaml");
  const openCodeConfigPath = path.join(resolvedRoot, "opencode.jsonc");
  const promptsRoot = path.join(resolvedRoot, ".agents", "agents");
  const personalitiesRoot = path.join(resolvedRoot, ".agents", "personalities");
  const skillsRoot = path.join(resolvedRoot, ".agents", "skills");
  const failures: string[] = [];

  for (const required of [registryPath, aliasesPath, openCodeConfigPath, promptsRoot, personalitiesRoot, skillsRoot, path.join(personalitiesRoot, RUNTIME_INSTRUCTIONS)]) {
    if (!(await exists(required))) failures.push(`missing ${path.relative(resolvedRoot, required)}`);
  }
  if (failures.length > 0) throw new AgentLintError(failures);

  let entries: readonly RegistryAgent[];
  let aliases: Readonly<Record<string, string>>;
  let openCodeConfig: OpenCodeConfig;
  try {
    entries = parseRegistryDocument(await parseYamlFile(registryPath), registryPath);
    aliases = parseAliasDocument(await parseYamlFile(aliasesPath), aliasesPath);
    openCodeConfig = parseOpenCodeDocument(await parseJsoncFile(openCodeConfigPath), openCodeConfigPath);
  } catch (error) {
    if (error instanceof StructuredConfigError || error instanceof AgentShapeError) throw new AgentLintError([error.message]);
    throw error;
  }

  for (const entry of entries) {
    if (!(await exists(path.join(resolvedRoot, entry.prompt)))) failures.push(`registry entry ${entry.id} has invalid prompt: ${entry.prompt}`);
    if (!(await exists(path.join(personalitiesRoot, `${entry.personality}.yaml`)))) failures.push(`registry entry ${entry.id} has invalid personality: ${entry.personality}`);
    for (const skill of entry.skills) if (!(await exists(path.join(skillsRoot, skill, "SKILL.md")))) failures.push(`registry entry ${entry.id} has invalid skill: ${skill}`);
  }

  const registryIds = new Set(entries.map((entry) => entry.id));
  const promptPaths = new Set(entries.map((entry) => entry.prompt));
  const personalityFiles = new Set([...entries.map((entry) => `${entry.personality}.yaml`), ...FOUNDATION_PERSONALITIES]);
  const skillIds = new Set(entries.flatMap((entry) => entry.skills));
  const actualPromptFiles = relativeFiles(resolvedRoot, (await directoryEntries(promptsRoot)).filter((file) => file.endsWith(".md")).map((file) => path.join(promptsRoot, file)));
  const actualPersonalityFiles = new Set((await directoryEntries(personalitiesRoot)).filter((file) => file.endsWith(".yaml")));
  const actualSkillIds = new Set(await directoryNames(skillsRoot));
  checkSet(failures, "active prompt paths", promptPaths, actualPromptFiles);
  checkSet(failures, "personality files", personalityFiles, actualPersonalityFiles);
  checkSet(failures, "active skill ids", skillIds, actualSkillIds);
  checkSet(failures, "template skill bindings", skillIds, new Set(Object.keys(templateBindings)));
  await validatePersonalityFiles(resolvedRoot, [...actualPersonalityFiles], failures);
  await validatePromptFiles(resolvedRoot, [...actualPromptFiles], failures);
  await validateRuntimeInstructions(resolvedRoot, failures);
  await validateActiveContracts(resolvedRoot, [...actualPromptFiles], skillIds, failures);

  validateOpenCodeMcp(openCodeConfig, failures);
  const configAgentIds = new Set(Object.keys(openCodeConfig.agent));
  checkSet(failures, "OpenCode agent ids", registryIds, configAgentIds);
  if (openCodeConfig.default_agent !== "director") failures.push("opencode.jsonc: default_agent must be director");
  for (const entry of entries) {
    const agentConfig = openCodeConfig.agent[entry.id];
    if (agentConfig === undefined) continue;
    const mounts = new Set(promptMounts(agentConfig.prompt));
    const expectedMounts = new Set([
      entry.prompt,
      ".agents/personalities/runtime-instructions.md",
      ".agents/personalities/base-adult.yaml",
      `.agents/personalities/${entry.personality}.yaml`,
      ...entry.skills.map((skill) => `.agents/skills/${skill}/SKILL.md`),
    ]);
    checkSet(failures, `OpenCode ${entry.id} prompt mounts`, expectedMounts, mounts);
    if (entry.id === "director" && agentConfig.permission?.question !== "allow") failures.push("OpenCode Director question permission must be allow");
  }

  compareRuntimeRegistry(entries, aliases, runtime, failures);
  if (failures.length > 0) throw new AgentLintError(failures);
  return {
    root: resolvedRoot,
    registryAgents: registryIds.size,
    prompts: promptPaths.size,
    personalities: personalityFiles.size,
    skills: skillIds.size,
    aliases: Object.keys(aliases).length,
    status: "ok",
  };
}

export interface AgentLintIo {
  readonly out: (message: string) => void;
  readonly err: (message: string) => void;
}

export async function runAgentLint(root = process.argv[2] ?? DEFAULT_ROOT, io: AgentLintIo = { out: console.log, err: console.error }): Promise<number> {
  try {
    io.out(JSON.stringify(await lintAgentWorkspace(root), null, 2));
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = await runAgentLint();
