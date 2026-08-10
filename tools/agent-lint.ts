import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const agentsRoot = path.join(root, ".agents");
const promptsRoot = path.join(agentsRoot, "agents");
const personalitiesRoot = path.join(agentsRoot, "personalities");
const skillsRoot = path.join(agentsRoot, "skills");
const runtimeInstructionsPath = path.join(personalitiesRoot, "runtime-instructions.md");
const registryPath = path.join(agentsRoot, "registry.yaml");
const aliasesPath = path.join(agentsRoot, "aliases.yaml");
const openCodeConfigPath = path.join(root, "opencode.jsonc");
const templateSourcePath = path.join(root, "packages", "core", "src", "templates.ts");
const agentRegistrySourcePath = path.join(root, "packages", "runtime", "src", "agent-registry.ts");

const failures: string[] = [];

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function text(file: string): Promise<string> {
  return readFile(file, "utf8");
}

function lines(value: string): string[] {
  return value.split(/\r?\n/u);
}

function registryIds(value: string): string[] {
  return lines(value).flatMap((line) => {
    const match = line.match(/^\s+- id:\s*([a-z0-9-]+)\s*$/iu);
    return match === null ? [] : [match[1]!.toLocaleLowerCase()];
  });
}

function registryEntries(value: string): Array<{ id: string; prompt?: string; personality?: string; skills: string[]; readOnly: boolean }> {
  return value.split(/\n(?=\s+- id:)/u).flatMap((block) => {
    const id = block.match(/^\s+- id:\s*([a-z0-9-]+)\s*$/imu)?.[1]?.toLocaleLowerCase();
    if (id === undefined) return [];
    const prompt = block.match(/^\s+prompt:\s*(\S+)\s*$/imu)?.[1];
    const personality = block.match(/^\s+personality:\s*([a-z0-9-]+)\s*$/imu)?.[1];
    const skills = block.match(/^\s+skills:\s*\[([^\]]*)\]\s*$/imu)?.[1]?.split(",").map((item) => item.trim()).filter((item) => item.length > 0) ?? [];
    const readOnly = /^\s+read_only:\s*true\s*$/imu.test(block);
    return [{ id, prompt, personality, skills, readOnly }];
  });
}

function tsDefinitionBlocks(value: string): Array<{ id: string; readOnly: boolean }> {
  const start = value.indexOf("AGENT_DEFINITIONS");
  const end = value.indexOf("AGENT_ALIASES", start);
  if (start < 0 || end < 0) return [];
  return value.slice(start, end).split(/^\s*definition\("/um).slice(1).flatMap((chunk) => {
    const id = chunk.match(/^([a-z0-9-]+)/u)?.[1];
    return id === undefined ? [] : [{ id, readOnly: /read_only:\s*true/u.test(chunk) }];
  });
}

function tsAliasEntries(value: string): Array<[string, string]> {
  const start = value.indexOf("AGENT_ALIASES");
  const end = value.indexOf("};", start);
  if (start < 0 || end < 0) return [];
  const output: Array<[string, string]> = [];
  for (const match of value.slice(start, end).matchAll(/"?([a-z0-9-]+)"?\s*:\s*"([a-z0-9-]+)"/gu)) {
    output.push([match[1]!.toLocaleLowerCase(), match[2]!.toLocaleLowerCase()]);
  }
  return output;
}

function aliases(value: string): Array<[string, string]> {
  return lines(value).flatMap((line) => {
    const match = line.match(/^\s{2}([a-z0-9-]+):\s*([a-z0-9-]+)\s*$/iu);
    return match === null ? [] : [[match[1]!.toLocaleLowerCase(), match[2]!.toLocaleLowerCase()]];
  });
}

function field(value: string, name: string): string | undefined {
  return lines(value).find((line) => line.startsWith(name + ":"))?.slice(name.length + 1).trim();
}

async function main(): Promise<void> {
  for (const required of [registryPath, aliasesPath, promptsRoot, personalitiesRoot, skillsRoot, runtimeInstructionsPath, openCodeConfigPath, templateSourcePath, agentRegistrySourcePath]) {
    if (!(await exists(required))) failures.push("missing " + path.relative(root, required));
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));

  const registry = await text(registryPath);
  const aliasText = await text(aliasesPath);
  const openCodeConfig = await text(openCodeConfigPath);
  const templateSource = await text(templateSourcePath);
  const runtimeInstructions = await text(runtimeInstructionsPath);
  const registrySource = await text(agentRegistrySourcePath);
  const directorStart = openCodeConfig.indexOf('"director": {');
  const nextAgentStart = directorStart >= 0 ? openCodeConfig.indexOf('"source-researcher": {', directorStart) : -1;
  const directorConfig = directorStart >= 0 && nextAgentStart > directorStart ? openCodeConfig.slice(directorStart, nextAgentStart) : "";
  if (!directorConfig.includes("{file:./.agents/personalities/runtime-instructions.md}")) failures.push("OpenCode Director prompt is missing personality runtime instructions");
  for (const requiredInstruction of [
    "必須實際執行的行為指令",
    "每次對使用者輸出時",
    "不得於流程性輸出或提問時暫停、重置或退回中性口吻",
    "prohibited_behaviors",
  ]) {
    if (!runtimeInstructions.includes(requiredInstruction)) failures.push("personality runtime instructions missing rule: " + requiredInstruction);
  }
  for (const source of [
    ".agents/agents/director.md",
    ".agents/personalities/base-adult.yaml",
    ".agents/personalities/director.yaml",
    ".agents/skills/director-orchestration/SKILL.md",
  ]) {
    if (!openCodeConfig.includes(`{file:./${source}}`)) failures.push("OpenCode Director prompt is missing file binding: " + source);
  }
  const ids = registryIds(registry);
  const entries = registryEntries(registry);
  if (ids.length !== 23) failures.push("expected 23 registry agents, found " + ids.length);
  if (new Set(ids).size !== ids.length) failures.push("registry contains duplicate agent ids");
  for (const entry of entries) {
    if (entry.prompt === undefined || !(await exists(path.join(root, entry.prompt)))) failures.push("registry entry " + entry.id + " has invalid prompt");
    if (entry.personality === undefined || !(await exists(path.join(personalitiesRoot, entry.personality + ".yaml")))) failures.push("registry entry " + entry.id + " has invalid personality");
    for (const skill of entry.skills) {
      if (!(await exists(path.join(skillsRoot, skill, "SKILL.md")))) failures.push("registry entry " + entry.id + " has invalid skill " + skill);
    }
    if (entry.prompt !== undefined && !openCodeConfig.includes(`{file:./${entry.prompt}}`)) failures.push("OpenCode agent " + entry.id + " is missing prompt mount");
    if (!openCodeConfig.includes("{file:./.agents/personalities/base-adult.yaml}")) failures.push("OpenCode agent " + entry.id + " is missing base personality mount");
    if (entry.personality !== undefined && !openCodeConfig.includes(`{file:./.agents/personalities/${entry.personality}.yaml}`)) failures.push("OpenCode agent " + entry.id + " is missing personality mount");
    for (const skill of entry.skills) if (!openCodeConfig.includes(`{file:./.agents/skills/${skill}/SKILL.md}`)) failures.push("OpenCode agent " + entry.id + " is missing skill mount " + skill);
  }

  const aliasEntries = aliases(aliasText);
  for (const [alias, target] of aliasEntries) {
    if (!ids.includes(target)) failures.push("alias " + alias + " targets unknown agent " + target);
  }

  const tsDefinitions = tsDefinitionBlocks(registrySource);
  const tsIds = tsDefinitions.map((item) => item.id);
  for (const id of ids) {
    if (!tsIds.includes(id)) failures.push("registry agent " + id + " is missing from the TypeScript agent registry");
  }
  for (const item of tsDefinitions) {
    if (!ids.includes(item.id)) failures.push("TypeScript agent " + item.id + " is missing from .agents/registry.yaml");
  }
  const tsReadOnly = new Map(tsDefinitions.map((item) => [item.id, item.readOnly]));
  for (const entry of entries) {
    const tsFlag = tsReadOnly.get(entry.id);
    if (tsFlag !== undefined && tsFlag !== entry.readOnly) failures.push("agent " + entry.id + " has inconsistent read_only between registry.yaml and the TypeScript registry");
  }
  const tsAliases = tsAliasEntries(registrySource);
  const tsAliasPairs = new Set(tsAliases.map(([alias, target]) => alias + " -> " + target));
  const yamlAliasPairs = new Set(aliasEntries.map(([alias, target]) => alias + " -> " + target));
  for (const [alias, target] of aliasEntries) {
    if (!tsAliasPairs.has(alias + " -> " + target)) failures.push("alias " + alias + " -> " + target + " is missing from the TypeScript alias map");
  }
  for (const [alias, target] of tsAliases) {
    if (!yamlAliasPairs.has(alias + " -> " + target)) failures.push("TypeScript alias " + alias + " -> " + target + " is missing from .agents/aliases.yaml");
  }

  const promptFiles = (await readdir(promptsRoot)).filter((file) => file.endsWith(".md")).sort();
  const personalityFiles = (await readdir(personalitiesRoot)).filter((file) => file.endsWith(".yaml")).sort();
  const skillDirs = (await readdir(skillsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (promptFiles.length !== 21) failures.push("expected 21 active prompts, found " + promptFiles.length);
  if (personalityFiles.length !== 23) failures.push("expected 23 personality YAML files, found " + personalityFiles.length);
  if (skillDirs.length !== 21) failures.push("expected 21 active skills, found " + skillDirs.length);
  for (const skill of skillDirs) {
    if (!templateSource.includes(`\"${skill}\": [`)) failures.push("template registry is missing skill binding: " + skill);
  }

  const activeContent: Array<{ file: string; value: string }> = [];
  for (const file of promptFiles) activeContent.push({ file: path.join("agents", file), value: await text(path.join(promptsRoot, file)) });
  for (const skill of skillDirs) {
    const file = path.join(skillsRoot, skill, "SKILL.md");
    if (!(await exists(file))) {
      failures.push("skill " + skill + " is missing SKILL.md");
      continue;
    }
    activeContent.push({ file: path.join("skills", skill, "SKILL.md"), value: await text(file) });
  }

  const banned = /\b(?:task_id|lease_id|batch_id|candidate_id|revision|capability|file_path|bytes_base64|source_research_approve|source_research_fetch_approved)\b/iu;
  for (const item of activeContent) {
    if (banned.test(item.value)) failures.push("active contract contains low-level token: " + item.file);
  }

  for (const file of promptFiles) {
    const value = await text(path.join(promptsRoot, file));
    const personality = value.match(/^Personality:\s*\.agents\/personalities\/([a-z0-9-]+)\.yaml\s*$/imu)?.[1];
    const skill = value.match(/^Skill:\s*\.agents\/skills\/([a-z0-9-]+)\/SKILL\.md\s*$/imu)?.[1];
    if (personality === undefined || !(await exists(path.join(personalitiesRoot, personality + ".yaml")))) failures.push("prompt " + file + " has invalid personality binding");
    if (skill === undefined || !(await exists(path.join(skillsRoot, skill, "SKILL.md")))) failures.push("prompt " + file + " has invalid skill binding");
  }

  for (const file of personalityFiles) {
    const value = await text(path.join(personalitiesRoot, file));
    const id = field(value, "id");
    if (id === undefined) failures.push("personality " + file + " has no id");
    const parent = field(value, "inherits");
    if (parent !== undefined && !(await exists(path.join(personalitiesRoot, parent + ".yaml")))) failures.push("personality " + file + " inherits missing " + parent + ".yaml");
  }

  const registryLines = lines(registry);
  for (let index = 0; index < registryLines.length; index += 1) {
    const role = registryLines[index]?.match(/^\s+role:\s*([a-z-]+)\s*$/iu)?.[1];
    if (role !== "critic" && role !== "reviewer") continue;
    const next = registryLines.slice(index, index + 8).join("\n");
    if (!/read_only:\s*true/iu.test(next)) failures.push("critic/reviewer entry missing read_only near line " + (index + 1));
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log(JSON.stringify({ root, registry_agents: ids.length, prompts: promptFiles.length, personalities: personalityFiles.length, skills: skillDirs.length, aliases: aliasEntries.length, status: "ok" }, null, 2));
}

await main();
