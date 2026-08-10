import {
  canonicalJson,
  contentHash,
  parseWardrobeMarkdown,
  pluginProposalValueSchema,
  type ArtifactRecord,
  type FactRecord,
  type ProjectState,
} from "@st-workspace/core";
import {
  characterCardV3Schema,
  emitCharacterCardV3,
  type Ccv3LoreEntry,
  type Ccv3Project,
  type CharacterCardV3,
  type PluginContribution,
} from "@st-workspace/adapters-ccv3";
import { writeCardToPng } from "@st-workspace/adapters-png";
import { generatePluginContributions } from "@st-workspace/plugins";

export interface NormalizedProject {
  project: Ccv3Project;
  latestArtifacts: ArtifactRecord[];
  diagnostics: CompilerDiagnostic[];
  mode_selection?: CardModeSelection;
}

export type CardModeSelection = "zhuji" | "palette" | "both";

export interface CompileOptions {
  mode_selection?: CardModeSelection;
}

export interface CompilerDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface AvailableCardModes {
  zhuji: boolean;
  palette: boolean;
}

export interface PluginBuildTrace {
  schema_version: 1;
  project_id: string;
  content_hash: string;
  plugins: Array<{ plugin_id: string; artifact_id: string; artifact_revision: string; contribution_revision: string }>;
}

export interface CompileResult {
  normalized: NormalizedProject;
  card: CharacterCardV3;
  json: string;
  png: Buffer;
  content_hash: string;
  diagnostics: CompilerDiagnostic[];
  plugin_contributions: PluginContribution[];
  plugin_trace: PluginBuildTrace;
}

export interface WorkspaceBundleCompileResult {
  card: CharacterCardV3;
  json: string;
  png: Buffer;
  content_hash: string;
}

interface ArtifactParts {
  description?: string;
  personality?: string;
  scenario?: string;
  wardrobe?: string;
  first_mes?: string;
  alternate: string[];
  group_only: string[];
  entries: Ccv3LoreEntry[];
}

interface ModeProjection {
  artifact: ArtifactRecord;
  characterId: string;
  mode: "zhuji" | "palette";
  module: string;
  title: string;
  text: string;
}

const ZHUJI_MODULE_NAMES: Record<string, string> = {
  appearance: "外觀",
  inner_nature: "內在本質",
  extension: "延伸設定",
  trait_refinement: "特質細化",
  trait_dialogue: "特質對話",
  scene_dialogue: "場景對話",
  self_introduction: "自我介紹",
};

const PALETTE_MODULE_NAMES: Record<string, string> = {
  basic_information: "基本資訊",
  personality_palette: "性格調色盤",
  tri_faceted: "三面性",
  secondary_interpretation: "二次詮釋",
};

function parseJson(content: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function yamlIndent(line: string): number {
  return line.match(/^\s*/u)?.[0].length ?? 0;
}

function yamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

interface YamlField {
  index: number;
  indent: number;
  value: string;
}

function yamlField(lines: readonly string[], start: number, end: number, key: string, parentIndent: number): YamlField | undefined {
  const escapedKey = key.split("").map((character) => "\\.^$|()[]{}*+?".includes(character) ? `\\${character}` : character).join("");
  const pattern = new RegExp(`^(\\s*)${escapedKey}\\s*:\\s*(.*)$`, "u");
  for (let index = start; index < end; index += 1) {
    const match = lines[index]?.match(pattern);
    if (match === null || match === undefined) continue;
    const indent = match[1]?.length ?? 0;
    if (indent <= parentIndent) continue;
    return { index, indent, value: match[2] ?? "" };
  }
  return undefined;
}

function yamlBlockEnd(lines: readonly string[], start: number, parentIndent: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().length === 0) continue;
    if (yamlIndent(lines[index] ?? "") <= parentIndent) return index;
  }
  return lines.length;
}

function dedentYamlBlock(lines: readonly string[], start: number, end: number, indent: number): string[] {
  return lines.slice(start, end).map((line) => line.trim().length === 0 ? "" : line.slice(Math.min(indent, line.length)).replace(/\s+$/u, ""));
}

function yamlModeProjection(artifact: ArtifactRecord): Omit<ModeProjection, "artifact"> | undefined {
  const lines = artifact.content.replaceAll("\r", "").split("\n");
  const valueField = lines.findIndex((line) => /^\s*value\s*:\s*$/u.test(line));
  if (valueField < 0) return undefined;
  const valueIndent = yamlIndent(lines[valueField] ?? "");
  const moduleField = yamlField(lines, valueField + 1, lines.length, "module", valueIndent);
  if (moduleField === undefined) return undefined;
  const moduleEnd = yamlBlockEnd(lines, moduleField.index + 1, moduleField.indent);
  const mode = yamlField(lines, moduleField.index + 1, moduleEnd, "mode", moduleField.indent);
  const module = yamlField(lines, moduleField.index + 1, moduleEnd, "module", moduleField.indent);
  const title = yamlField(lines, moduleField.index + 1, moduleEnd, "title", moduleField.indent);
  const characterField = yamlField(lines, valueField + 1, moduleField.index, "character_id", valueIndent);
  if (mode === undefined || module === undefined || title === undefined || characterField === undefined) return undefined;
  const modeName = yamlScalar(mode.value);
  const moduleName = yamlScalar(module.value);
  const characterId = yamlScalar(characterField.value);
  if ((modeName !== "zhuji" && modeName !== "palette") || modeName !== artifact.kind || moduleName.length === 0 || characterId.length === 0) return undefined;

  const data = yamlField(lines, moduleField.index + 1, moduleEnd, "data", moduleField.indent);
  let text: string;
  if (data !== undefined) {
    const dataEnd = yamlBlockEnd(lines, data.index + 1, data.indent);
    const dataValue = data.value.trim();
    const body = dataValue.length === 0
      ? dedentYamlBlock(lines, data.index, dataEnd, data.indent)
      : [`data: ${dataValue}`];
    text = [`title: ${yamlScalar(title.value)}`, ...body].join("\n").trim();
  } else {
    const content = yamlField(lines, moduleField.index + 1, moduleEnd, "content", moduleField.indent);
    if (content === undefined) return undefined;
    text = [`title: ${yamlScalar(title.value)}`, ...dedentYamlBlock(lines, content.index, moduleEnd, content.indent)].join("\n").trim();
  }
  return { characterId, mode: modeName, module: moduleName, title: yamlScalar(title.value), text };
}

interface BlueprintCharacterDescriptor {
  id: string;
  displayName?: string;
  label?: string;
}

interface BlueprintDescriptor {
  characters: BlueprintCharacterDescriptor[];
  primaryCharacterId?: string;
}

function blueprintCharacterDescriptor(value: unknown): BlueprintCharacterDescriptor | undefined {
  const character = recordValue(value);
  if (character === undefined) return undefined;
  const id = textValue(character.id) ?? textValue(character.character_id);
  if (id === undefined) return undefined;
  const displayName = textValue(character.display_name);
  const label = textValue(character.label);
  return {
    id,
    ...(displayName === undefined ? {} : { displayName }),
    ...(label === undefined ? {} : { label }),
  };
}

function jsonBlueprintDescriptor(content: string): BlueprintDescriptor | undefined {
  const parsed = parseJson(content);
  if (parsed === undefined) return undefined;
  const characters = Array.isArray(parsed.characters)
    ? parsed.characters.map(blueprintCharacterDescriptor).filter((item): item is BlueprintCharacterDescriptor => item !== undefined)
    : [];
  const primaryCharacterId = textValue(parsed.primary_character_id);
  if (characters.length === 0 && primaryCharacterId === undefined) return undefined;
  return { characters, ...(primaryCharacterId === undefined ? {} : { primaryCharacterId }) };
}

function yamlBlueprintDescriptor(content: string): BlueprintDescriptor | undefined {
  const lines = content.replaceAll("\r", "").split("\n");
  const characters: BlueprintCharacterDescriptor[] = [];
  const primaryField = lines.find((line) => /^\s*primary_character_id\s*:\s*(.+)$/u.test(line));
  const primaryCharacterId = primaryField?.match(/^\s*primary_character_id\s*:\s*(.+)$/u)?.[1];
  for (let index = 0; index < lines.length; index += 1) {
    const character = lines[index]?.match(/^(\s*)-\s+character_id\s*:\s*(.+)$/u);
    if (character === null || character === undefined) continue;
    const itemIndent = character[1]?.length ?? 0;
    const characterId = yamlScalar(character[2] ?? "");
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? "";
      if (line.trim().length > 0 && yamlIndent(line) <= itemIndent) break;
      const display = line.match(/^\s+display_name\s*:\s*(.+)$/u);
      if (display !== null && display !== undefined) {
        const displayName = yamlScalar(display[1] ?? "");
        if (characterId.length > 0) characters.push(displayName.length > 0 ? { id: characterId, displayName } : { id: characterId });
        break;
      }
    }
    if (!characters.some((item) => item.id === characterId)) characters.push({ id: characterId });
  }
  if (characters.length === 0 && primaryCharacterId === undefined) return undefined;
  return {
    characters,
    ...(primaryCharacterId === undefined ? {} : { primaryCharacterId: yamlScalar(primaryCharacterId) }),
  };
}

function blueprintDescriptor(artifacts: readonly ArtifactRecord[]): BlueprintDescriptor | undefined {
  const blueprintArtifacts = artifacts.filter((artifact) => artifact.kind === "blueprint");
  for (const artifact of [...blueprintArtifacts].reverse()) {
    const descriptor = jsonBlueprintDescriptor(artifact.content) ?? yamlBlueprintDescriptor(artifact.content);
    if (descriptor !== undefined) return descriptor;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function latestArtifacts(artifacts: readonly ArtifactRecord[]): ArtifactRecord[] {
  const latestByKey = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) latestByKey.set(artifact.key, artifact);
  return [...latestByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function latestArtifactsInSourceOrder(artifacts: readonly ArtifactRecord[]): ArtifactRecord[] {
  const latestByKey = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) latestByKey.set(artifact.key, artifact);
  return [...latestByKey.values()];
}

export function availableCardModes(artifacts: readonly ArtifactRecord[]): AvailableCardModes {
  const latest = latestArtifacts(artifacts);
  return {
    zhuji: latest.some((artifact) => artifact.kind === "zhuji" && modeProjection(artifact) !== undefined),
    palette: latest.some((artifact) => artifact.kind === "palette" && modeProjection(artifact) !== undefined),
  };
}

function selectedMode(mode: "zhuji" | "palette", selection: CardModeSelection | undefined): boolean {
  return selection === "both" || selection === mode;
}

function resolvedModeSelection(available: AvailableCardModes, requested: CardModeSelection | undefined): CardModeSelection | undefined {
  if (requested === undefined) {
    if (available.zhuji && available.palette) return "both";
    if (available.zhuji) return "zhuji";
    if (available.palette) return "palette";
    return undefined;
  }
  if (requested === "both") return available.zhuji && available.palette ? "both" : undefined;
  if (requested === "zhuji") return available.zhuji ? "zhuji" : undefined;
  return available.palette ? "palette" : undefined;
}

function localizedModeName(mode: "zhuji" | "palette", module: string): string {
  return (mode === "zhuji" ? ZHUJI_MODULE_NAMES : PALETTE_MODULE_NAMES)[module] ?? module;
}

function characterDisplayNames(artifacts: readonly ArtifactRecord[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const artifact of artifacts) {
    if (artifact.kind === "character") {
      const document = recordValue(parseJson(artifact.content)?.document);
      const id = textValue(document?.id);
      const displayName = textValue(document?.display_name);
      if (id !== undefined && displayName !== undefined) names.set(id, displayName);
    }
  }
  const blueprint = blueprintDescriptor(artifacts);
  for (const character of blueprint?.characters ?? []) {
    const blueprintName = character.displayName ?? character.label;
    if (blueprintName !== undefined && !names.has(character.id)) names.set(character.id, blueprintName);
  }
  return names;
}

function joinText(values: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized === undefined || normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.length === 0 ? undefined : result.join("\n\n");
}

function markdownHeading(level: number, label: string): string {
  return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${label.replaceAll(/[\r\n]+/gu, " ").trim()}`;
}

function markdownScalar(value: unknown): string {
  if (typeof value === "string") return value.trim().length === 0 ? "\"\"" : value.trim();
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function appendSemanticMarkdown(lines: string[], value: unknown, label: string | undefined, level: number): void {
  if (value === null || typeof value !== "object") {
    if (label === undefined) {
      lines.push(markdownScalar(value));
    } else {
      lines.push(markdownHeading(level, label), markdownScalar(value));
    }
    return;
  }

  if (Array.isArray(value)) {
    if (label !== undefined) lines.push(markdownHeading(level, label));
    value.forEach((item, index) => {
      if (item === null || typeof item !== "object") {
        lines.push(`${index + 1}. ${markdownScalar(item)}`);
        return;
      }
      lines.push(`${index + 1}.`);
      appendSemanticMarkdown(lines, item, undefined, level + 1);
    });
    return;
  }

  if (label !== undefined) lines.push(markdownHeading(level, label));
  for (const [key, child] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
    appendSemanticMarkdown(lines, child, key, level + 1);
  }
}

function semanticModeMarkdown(title: string, data: unknown, content: string | undefined, sections: unknown): string {
  const lines = [markdownHeading(1, title)];
  if (content !== undefined) appendSemanticMarkdown(lines, content, "content", 2);
  if (sections !== undefined) appendSemanticMarkdown(lines, sections, "sections", 2);
  if (data !== undefined) appendSemanticMarkdown(lines, data, "data", 2);
  return lines.join("\n\n").trim();
}

function entry(id: string, name: string, content: string, keys: string[] = [], insertionOrder = 10): Ccv3LoreEntry {
  return { id, name, comment: name, keys, content, extensions: { "card-workspace": { source: "v3-artifact" } }, enabled: true, insertion_order: insertionOrder, use_regex: false, position: "after_char" };
}

function modeProjection(artifact: ArtifactRecord): ModeProjection | undefined {
  if (artifact.kind !== "zhuji" && artifact.kind !== "palette") return undefined;
  const parsed = parseJson(artifact.content);
  if (parsed === undefined) {
    const yaml = yamlModeProjection(artifact);
    return yaml === undefined ? undefined : { artifact, ...yaml };
  }
  const module = recordValue(parsed?.module);
  const characterId = textValue(parsed?.character_id);
  const mode = textValue(module?.mode);
  const moduleName = textValue(module?.module);
  if (module === undefined || characterId === undefined || moduleName === undefined || mode !== artifact.kind) return undefined;
  const title = textValue(module.title) ?? `${mode}/${moduleName}`;
  const text = semanticModeMarkdown(
    title,
    artifact.kind === "zhuji" ? module.data : undefined,
    artifact.kind === "palette" ? textValue(module.content) : undefined,
    artifact.kind === "palette" ? module.sections : undefined,
  );
  return { artifact, characterId, mode, module: moduleName, title, text };
}

function relationshipEntry(artifact: ArtifactRecord, parsed: Record<string, unknown>, names: ReadonlyMap<string, string>): Ccv3LoreEntry[] {
  const document = recordValue(parsed.document);
  if (document === undefined) return [];
  const characterIds = Array.isArray(document.character_ids)
    ? document.character_ids.filter((value): value is string => typeof value === "string")
    : [];
  const displayName = (id: string): string => names.get(id) ?? id;
  const summaries = Array.isArray(document.character_summaries) ? document.character_summaries : [];
  const perspectives = Array.isArray(document.perspectives) ? document.perspectives : [];
  const groups = Array.isArray(document.groups) ? document.groups : [];
  const summary = recordValue(document.summary);
  const network = joinText([
    textValue(summary?.network_character),
    textValue(summary?.inter_group_relations),
    textValue(summary?.stability),
  ]);
  const lines: string[] = [];
  const teamCode = textValue(document.team_code);
  if (teamCode !== undefined) lines.push(`Team: ${teamCode}`);
  if (characterIds.length > 0) lines.push(`Participants: ${characterIds.map(displayName).join(", ")}`);
  if (network !== undefined) lines.push(`Network: ${network}`);
  if (summaries.length > 0) {
    lines.push(`Character summaries:\n${summaries.map((item) => {
      const value = recordValue(item);
      const id = textValue(value?.character_id);
      return value === undefined ? undefined : `- ${id === undefined ? "unknown" : displayName(id)}: ${textValue(value.summary) ?? ""}`;
    }).filter((item): item is string => item !== undefined).join("\n")}`);
  }
  if (perspectives.length > 0) {
    lines.push(`Perspectives:\n${perspectives.map((item) => {
      const value = recordValue(item);
      const source = textValue(value?.source_character_id);
      const target = textValue(value?.target_character_id);
      return value === undefined ? undefined : `- ${source === undefined ? "unknown" : displayName(source)} -> ${target === undefined ? "unknown" : displayName(target)}: ${textValue(value.summary) ?? ""}`;
    }).filter((item): item is string => item !== undefined).join("\n")}`);
  }
  if (groups.length > 0) {
    lines.push(`Groups:\n${groups.map((item) => {
      const value = recordValue(item);
      if (value === undefined) return undefined;
      const members = stringValues(value.member_ids).map(displayName).join(", ");
      const details = joinText([
        textValue(value.formation_cause),
        textValue(value.operating_pattern),
        textValue(value.exclusivity),
        stringValues(value.latent_conflicts).length === 0 ? undefined : `Latent conflicts: ${stringValues(value.latent_conflicts).join("; ")}`,
        textValue(value.joining_conditions),
      ]);
      return `- ${textValue(value.name) ?? textValue(value.id) ?? "group"}${members.length === 0 ? "" : ` (${members})`}${details === undefined ? "" : `: ${details}`}`;
    }).filter((item): item is string => item !== undefined).join("\n")}`);
  }
  const conflictTriggers = Array.isArray(summary?.conflict_triggers) ? summary.conflict_triggers : [];
  if (conflictTriggers.length > 0) {
    lines.push(`Conflict triggers:\n${conflictTriggers.map((item) => {
      const value = recordValue(item);
      return value === undefined ? undefined : `- ${textValue(value.trigger) ?? "unknown"} (${textValue(value.severity) ?? "unknown"})`;
    }).filter((item): item is string => item !== undefined).join("\n")}`);
  }
  const intimacy = stringValues(summary?.intimacy_opportunities);
  if (intimacy.length > 0) lines.push(`Intimacy opportunities:\n${intimacy.map((item) => `- ${item}`).join("\n")}`);
  return lines.length === 0 ? [] : [entry(`artifact.${artifact.id}.relationships`, "關係", lines.join("\n"), [...characterIds.map(displayName), ...characterIds], 300)];
}

function legacyArtifactEntries(artifact: ArtifactRecord, primaryCharacterId?: string): ArtifactParts {
  const parsed = parseJson(artifact.content);
  if (artifact.kind === "character" && parsed?.document !== undefined && parsed.document !== null && typeof parsed.document === "object") {
    const document = parsed.document as Record<string, unknown>;
    const characterId = textValue(document.id) ?? artifact.name;
    const primary = primaryCharacterId === undefined || primaryCharacterId === characterId;
    const summary = textValue(document.summary);
    const sections = Array.isArray(document.sections) ? document.sections : [];
    const personality: string[] = [];
    const scenario: string[] = [];
    const entries = sections.flatMap((section, index) => {
      if (section === null || typeof section !== "object" || Array.isArray(section)) return [];
      const value = section as Record<string, unknown>;
      const title = textValue(value.title) ?? `Section ${index + 1}`;
      const content = textValue(value.content);
      if (content === undefined) return [];
      if (/personality|trait|性格|特質/iu.test(title)) personality.push(content);
      if (/scenario|background|背景/iu.test(title)) scenario.push(content);
      return [entry(`artifact.${artifact.id}.section.${index}`, title, content, [textValue(document.display_name) ?? artifact.name], index + 1)];
    });
    const primaryFields: Pick<ArtifactParts, "description" | "personality" | "scenario"> = {};
    if (primary) {
      if (summary !== undefined) primaryFields.description = summary;
      const personalityText = joinText(personality);
      if (personalityText !== undefined) primaryFields.personality = personalityText;
      const scenarioText = joinText(scenario);
      if (scenarioText !== undefined) primaryFields.scenario = scenarioText;
    }
    return {
      ...primaryFields,
      alternate: [],
      group_only: [],
      entries,
    };
  }
  if (artifact.kind === "greeting" && parsed?.document !== undefined && parsed.document !== null && typeof parsed.document === "object") {
    const greetings = (parsed.document as Record<string, unknown>).greetings;
    if (Array.isArray(greetings)) {
      const primary = greetings.find((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>).kind === "primary");
      const alternate = greetings.filter((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>).kind === "alternate").map((item) => textValue((item as Record<string, unknown>).content) ?? "");
      const groupOnly = greetings.filter((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>).kind === "group_only").map((item) => textValue((item as Record<string, unknown>).content) ?? "");
      const firstMes = primary !== undefined && typeof primary === "object" ? textValue((primary as Record<string, unknown>).content) : undefined;
      return { ...(firstMes === undefined ? {} : { first_mes: firstMes }), alternate, group_only: groupOnly, entries: [] };
    }
  }
  if (artifact.kind === "world_lore" && parsed?.entries !== undefined && Array.isArray(parsed.entries)) {
    return { alternate: [], group_only: [], entries: parsed.entries.flatMap((item, index) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      const id = textValue(value.id) ?? `${artifact.id}-${index}`;
      const title = textValue(value.title) ?? id;
      const content = textValue(value.content);
      return content === undefined ? [] : [entry(`artifact.${artifact.id}.${id}`, title, content, [], index + 1)];
    }) };
  }
  if (artifact.kind === "relationship" && parsed !== undefined) {
    return { alternate: [], group_only: [], entries: relationshipEntry(artifact, parsed, new Map()) };
  }
  const mode = modeProjection(artifact);
  if (artifact.kind === "wardrobe") {
    const characterId = artifact.name.split("/")[0]?.trim();
    const primary = primaryCharacterId === undefined || characterId === primaryCharacterId;
    const parsed = parseWardrobeMarkdown(artifact.content);
    if (!parsed.ok) return { alternate: [], group_only: [], entries: [] };
    const title = parsed.document.title || `${characterId ?? artifact.name} 的衣櫃`;
    return {
      ...(primary ? { wardrobe: artifact.content } : {}),
      alternate: [],
      group_only: [],
      entries: [entry(`artifact.${artifact.id}.wardrobe`, title, artifact.content, characterId === undefined ? [] : [characterId], 200)],
    };
  }
  if (mode !== undefined) {
    const primary = primaryCharacterId === undefined || mode.characterId === primaryCharacterId;
    let mainFields: Pick<ArtifactParts, "description" | "personality" | "scenario"> = {};
    if (primary && artifact.kind === "palette" && mode.module === "basic_information") mainFields = { description: mode.text };
    if (primary && artifact.kind === "palette" && mode.module === "personality_palette") mainFields = { personality: mode.text };
    if (primary && artifact.kind === "zhuji" && ["appearance", "self_introduction"].includes(mode.module)) mainFields = { description: mode.text };
    if (primary && artifact.kind === "zhuji" && ["inner_nature", "trait_refinement", "trait_dialogue"].includes(mode.module)) mainFields = { personality: mode.text };
    if (primary && artifact.kind === "zhuji" && ["extension", "scene_dialogue"].includes(mode.module)) mainFields = { scenario: mode.text };
    return {
      ...mainFields,
      alternate: [],
      group_only: [],
      entries: [entry(`artifact.${artifact.id}.mode`, `${mode.mode}/${mode.module}: ${mode.title}`, mode.text, [mode.characterId, mode.module], 100)],
    };
  }
  if (["conversion", "plugin", "review", "source_research", "fact_curation", "fact_review", "import_analysis", "director_routing"].includes(artifact.kind)) {
    return { alternate: [], group_only: [], entries: [] };
  }
  const fallback = artifact.content.trim();
  return { ...(fallback.length > 0 ? { description: fallback } : {}), alternate: [], group_only: [], entries: fallback.length > 0 ? [entry(`artifact.${artifact.id}`, artifact.name, fallback)] : [] };
}

function artifactEntries(artifact: ArtifactRecord, names: ReadonlyMap<string, string>, modeSelection: CardModeSelection | undefined): ArtifactParts {
  const parsed = parseJson(artifact.content);
  if (artifact.kind === "greeting" && parsed?.document !== undefined && parsed.document !== null && typeof parsed.document === "object") {
    const greetings = (parsed.document as Record<string, unknown>).greetings;
    if (Array.isArray(greetings)) {
      const primary = greetings.find((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>).kind === "primary");
      const alternate = greetings.filter((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>).kind === "alternate").map((item) => textValue((item as Record<string, unknown>).content) ?? "");
      const groupOnly = greetings.filter((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>).kind === "group_only").map((item) => textValue((item as Record<string, unknown>).content) ?? "");
      const firstMes = primary !== undefined && typeof primary === "object" ? textValue((primary as Record<string, unknown>).content) : undefined;
      return { ...(firstMes === undefined ? {} : { first_mes: firstMes }), alternate, group_only: groupOnly, entries: [] };
    }
  }
  if (artifact.kind === "world_lore" && parsed?.entries !== undefined && Array.isArray(parsed.entries)) {
    return { alternate: [], group_only: [], entries: parsed.entries.flatMap((item, index) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      const id = textValue(value.id) ?? `${artifact.id}-${index}`;
      const title = textValue(value.title) ?? id;
      const content = textValue(value.content);
      const keys = [...new Set([title, ...stringValues(value.aliases), ...stringValues(value.keys)])];
      return content === undefined ? [] : [entry(`artifact.${artifact.id}.${id}`, title, content, keys, index + 1)];
    }) };
  }
  if (artifact.kind === "relationship" && parsed !== undefined) {
    return { alternate: [], group_only: [], entries: relationshipEntry(artifact, parsed, names) };
  }
  if (artifact.kind === "wardrobe") {
    const [rawCharacterId, rawDisplayName] = artifact.name.split("/").map((value) => value.trim());
    const characterId = rawCharacterId === undefined || rawCharacterId.length === 0 ? undefined : rawCharacterId;
    const displayName = characterId === undefined ? rawDisplayName || artifact.name : names.get(characterId) ?? (rawDisplayName !== undefined && rawDisplayName !== "wardrobe" ? rawDisplayName : characterId);
    return {
      alternate: [],
      group_only: [],
      entries: [entry(`artifact.${artifact.id}.wardrobe`, `${displayName}_衣櫃`, artifact.content, characterId === undefined ? [displayName] : [displayName, characterId], 200)],
    };
  }
  const mode = modeProjection(artifact);
  if (mode !== undefined) {
    if (!selectedMode(mode.mode, modeSelection)) return { alternate: [], group_only: [], entries: [] };
    const displayName = names.get(mode.characterId) ?? mode.characterId;
    const localizedName = localizedModeName(mode.mode, mode.module);
    return {
      alternate: [],
      group_only: [],
      entries: [entry(`artifact.${artifact.id}.mode`, `${displayName}_${localizedName}`, mode.text, [displayName, mode.characterId, localizedName, mode.module], 100)],
    };
  }
  return { alternate: [], group_only: [], entries: [] };
}

function characterIdsForArtifact(artifact: ArtifactRecord): string[] {
  if (artifact.kind === "wardrobe") {
    const id = artifact.name.split("/")[0]?.trim();
    return id === undefined || id.length === 0 ? [] : [id];
  }
  const mode = modeProjection(artifact);
  if (mode !== undefined) return [mode.characterId];
  const parsed = parseJson(artifact.content);
  if (parsed === undefined) return [];
  if (artifact.kind === "character") {
    const document = recordValue(parsed.document);
    const id = textValue(document?.id);
    return id === undefined ? [] : [id];
  }
  if (artifact.kind === "relationship") {
    const document = recordValue(parsed.document);
    return Array.isArray(document?.character_ids) ? document.character_ids.filter((value): value is string => typeof value === "string") : [];
  }
  if (artifact.kind === "greeting") {
    const document = recordValue(parsed.document);
    const greetings = Array.isArray(document?.greetings) ? document.greetings : [];
    return [...new Set(greetings.flatMap((item) => {
      const greeting = recordValue(item);
      return Array.isArray(greeting?.character_ids) ? greeting.character_ids.filter((value): value is string => typeof value === "string") : [];
    }))];
  }
  return [];
}

function primaryCharacterIdFor(
  artifacts: readonly ArtifactRecord[],
  sourceOrderedArtifacts: readonly ArtifactRecord[] = artifacts,
): { id: string | undefined; diagnostics: CompilerDiagnostic[] } {
  const blueprint = blueprintDescriptor(artifacts);
  const rosterIds = [...new Set((blueprint?.characters ?? []).map((character) => character.id))];
  const sourceCharacterIds = [...new Set(sourceOrderedArtifacts.flatMap(characterIdsForArtifact))];
  const knownCharacterIds = new Set([...rosterIds, ...sourceCharacterIds]);
  const fallback = rosterIds[0] ?? sourceCharacterIds[0];
  const explicitPrimary = blueprint?.primaryCharacterId;
  if (explicitPrimary !== undefined) {
    if (knownCharacterIds.has(explicitPrimary)) return { id: explicitPrimary, diagnostics: [] };
    return {
      id: fallback,
      diagnostics: [{
        code: "PRIMARY_CHARACTER_ID_INVALID",
        severity: "warning",
        message: `Blueprint primary_character_id "${explicitPrimary}" is not a known character; using ${fallback === undefined ? "no primary character" : `deterministic fallback ${fallback}`}.`,
      }],
    };
  }

  if (fallback !== undefined && rosterIds[0] !== undefined) {
    return {
      id: fallback,
      diagnostics: [{
        code: "PRIMARY_CHARACTER_ID_FALLBACK",
        severity: "warning",
        message: `Blueprint has no explicit primary_character_id; using roster order (${fallback}) for the primary character.`,
      }],
    };
  }

  return {
    id: fallback,
    diagnostics: fallback === undefined ? [] : [{
      code: "PRIMARY_CHARACTER_ID_FALLBACK",
      severity: "warning",
      message: `No explicit primary_character_id or Blueprint roster was found; using source artifact order (${fallback}) for the primary character.`,
    }],
  };
}

function factEntry(fact: FactRecord, index: number): Ccv3LoreEntry {
  const statement = fact.statement.trim();
  const keys = [fact.subject, fact.value].filter((value): value is string => value !== undefined && value.length > 0);
  return entry(`fact.${fact.id}`, `${fact.classification ?? "fact"} ${index + 1}`, statement, keys, 500 + index);
}

function projectMetadata(latestArtifacts: readonly ArtifactRecord[], primaryCharacterId: string | undefined, modeSelection?: CardModeSelection): Record<string, unknown> {
  const blueprint = blueprintDescriptor(latestArtifacts);
  const artifactIds = new Set(latestArtifacts.flatMap(characterIdsForArtifact));
  const rosterIds = (blueprint?.characters ?? []).map((character) => character.id);
  const ids = [
    ...rosterIds,
    ...[...artifactIds].filter((id) => !rosterIds.includes(id)).sort((left, right) => left.localeCompare(right)),
  ];
  const names = characterDisplayNames(latestArtifacts);
  const modeArtifacts = latestArtifacts.flatMap((artifact) => {
    const mode = modeProjection(artifact);
    return mode === undefined ? [] : [{ artifact_id: artifact.id, revision: artifact.revision, character_id: mode.characterId, mode: mode.mode, module: mode.module }];
  });
  const relationships = latestArtifacts.flatMap((artifact) => {
    if (artifact.kind !== "relationship") return [];
    const parsed = parseJson(artifact.content);
    const document = parsed === undefined ? undefined : recordValue(parsed.document);
     return document === undefined ? [] : [{ artifact_id: artifact.id, revision: artifact.revision, character_ids: stringValues(document.character_ids) }];
  });
  const wardrobes = latestArtifacts.flatMap((artifact) => {
    if (artifact.kind !== "wardrobe") return [];
    const characterId = artifact.name.split("/")[0]?.trim();
     return [{ artifact_id: artifact.id, revision: artifact.revision, character_id: characterId }];
  });
  return {
    schema_version: 1,
    primary_character_id: primaryCharacterId,
    characters: ids.map((id) => ({
      id,
      display_name: names.get(id) ?? id,
      modes: [...new Set(modeArtifacts.filter((item) => item.character_id === id).map((item) => item.mode))].sort(),
      artifact_ids: latestArtifacts.filter((artifact) => characterIdsForArtifact(artifact).includes(id)).map((artifact) => artifact.id),
    })),
    mode_artifacts: modeArtifacts,
    relationships,
    wardrobes,
    ...(modeSelection === undefined ? {} : { export_mode: modeSelection }),
  };
}

const NON_CARD_ARTIFACT_KINDS: ReadonlySet<ArtifactRecord["kind"]> = new Set([
  "review",
  "source_research",
  "fact_curation",
  "fact_review",
  "conversion",
  "import_analysis",
  "director_routing",
  "unknown",
]);

function isIncludedArtifact(artifact: ArtifactRecord, modeSelection: CardModeSelection | undefined): boolean {
  const projection = modeProjection(artifact);
  if (projection !== undefined) return selectedMode(projection.mode, modeSelection);
  return !NON_CARD_ARTIFACT_KINDS.has(artifact.kind);
}

function unavailableModeMessage(requested: CardModeSelection, available: AvailableCardModes): string {
  const availableText = available.zhuji && available.palette
    ? "zhuji、palette"
    : available.zhuji
    ? "zhuji"
    : available.palette
    ? "palette"
    : "無";
  return `無法建置所選模式「${requested}」：本次可用模式為 ${availableText}。`;
}

export function normalizeProject(state: ProjectState, options: CompileOptions = {}): NormalizedProject {
  const latest = latestArtifacts(state.artifacts);
  const sourceOrdered = latestArtifactsInSourceOrder(state.artifacts);
  const available = availableCardModes(latest);
  const requested = options.mode_selection;
  const modeSelection = resolvedModeSelection(available, requested);
  const selected = latest.filter((artifact) => isIncludedArtifact(artifact, modeSelection));
  const selectedIds = new Set(selected.map((artifact) => artifact.id));
  const selectedSourceOrdered = sourceOrdered.filter((artifact) => selectedIds.has(artifact.id));
  const primarySelection = primaryCharacterIdFor(selected, selectedSourceOrdered);
  const primaryCharacterId = primarySelection.id;
  const names = characterDisplayNames(selected);
  const title = textValue(state.project_name) ?? state.project_id;
  const parts = selected.map((artifact) => artifactEntries(artifact, names, modeSelection));
  const artifactIds = selected.map((artifact) => artifact.id);
  const artifactRevisions = Object.fromEntries(selected.map((artifact) => [artifact.key, artifact.revision]));
  const projectMetadataValue = projectMetadata(selected, primaryCharacterId, modeSelection);
  const diagnostics = requested !== undefined && modeSelection === undefined
    ? [...primarySelection.diagnostics, { code: "MODE_SELECTION_UNAVAILABLE", severity: "error" as const, message: unavailableModeMessage(requested, available) }]
    : primarySelection.diagnostics;
  const project: Ccv3Project = {
    project_id: state.project_id,
    title,
    name: title,
     character_book_name: `${title}_世界書`,
    character_book_description: "",
    description: "",
    personality: "",
    scenario: "",
    first_mes: joinText(parts.map((part) => part.first_mes)) ?? "",
    alternate_greetings: parts.flatMap((part) => part.alternate),
    group_only_greetings: parts.flatMap((part) => part.group_only),
    lore_entries: parts.flatMap((part) => part.entries),
    extensions: {
      source_counts: { artifacts: selected.length, sources: state.sources.length },
      "card-workspace": { project: projectMetadataValue },
      "card-workspace-project": projectMetadataValue,
    },
    artifact_ids: artifactIds,
    artifact_revisions: artifactRevisions,
  };
  return {
    project,
    latestArtifacts: selected,
    diagnostics,
    ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }),
  };
}

function pluginArtifacts(normalized: NormalizedProject): Array<{ artifact: ArtifactRecord; proposal: Extract<TemplateProposalValue, { kind: "plugin" }> }> {
  return normalized.latestArtifacts.flatMap((artifact) => {
    if (artifact.kind !== "plugin") return [];
    const value = parseJson(artifact.content);
    const parsed = pluginProposalValueSchema.safeParse(value);
    if (!parsed.success) throw new Error(`PLUGIN_COMPILE_INVALID: ${parsed.error.message}`);
    return [{ artifact, proposal: parsed.data }];
  });
}

type TemplateProposalValue = import("@st-workspace/core").TemplateProposalValue;

export function compileProject(state: ProjectState, options: CompileOptions = {}): CompileResult {
  const normalized = normalizeProject(state, options);
  const plugins = pluginArtifacts(normalized);
  const contributions = plugins.map(({ proposal }) => generatePluginContributions(proposal));
  const card = characterCardV3Schema.parse(emitCharacterCardV3(normalized.project, { pluginContributions: contributions }));
  const json = canonicalJson(card);
  const content_hash = contentHash(json);
  const png = writeCardToPng(undefined, card, { includeV2Backfill: true });
  const pluginTrace: PluginBuildTrace = {
    schema_version: 1,
    project_id: state.project_id,
    content_hash,
    plugins: plugins.map(({ artifact }, index) => ({
      plugin_id: contributions[index]!.plugin_id,
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      contribution_revision: contributions[index]!.artifact_revision,
    })),
  };
  return { normalized, card, json, png, content_hash, diagnostics: normalized.diagnostics, plugin_contributions: contributions, plugin_trace: pluginTrace };
}

/**
 * Convert the pre-CCv3 workspace bundle shape into a real Tavern card.
 *
 * The bundle is a workspace transport format: its Blueprint and mode modules
 * are YAML strings under separate top-level keys. Tavern does not understand
 * that envelope, so this boundary projects the preserved source text into
 * ordinary CCv3 fields and lore entries.
 */
export function compileWorkspaceBundle(bundleValue: unknown, options: CompileOptions = {}): WorkspaceBundleCompileResult {
  const bundle = recordValue(bundleValue);
  const metadata = recordValue(bundle?.card);
  if (bundle === undefined || metadata === undefined) throw new Error("WORKSPACE_BUNDLE_INVALID: card metadata is required");
  const projectId = textValue(metadata.project_id) ?? "workspace-project";
  const projectName = textValue(metadata.project_name) ?? textValue(metadata.display_name) ?? projectId;
  const displayName = textValue(metadata.display_name) ?? projectName;
  const bundleModules = (value: unknown): Array<[string, string]> => Object.entries(recordValue(value) ?? {})
    .filter((item): item is [string, string] => typeof item[1] === "string" && item[1].trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  const zhujiModules = bundleModules(bundle.zhuji_modules);
  const paletteModules = bundleModules(bundle.palette_modules);
  const available: AvailableCardModes = { zhuji: zhujiModules.length > 0, palette: paletteModules.length > 0 };
  const modeSelection = resolvedModeSelection(available, options.mode_selection);
  const selectedModules = [
    ...(selectedMode("zhuji", modeSelection) ? zhujiModules.map(([module, content]) => ["zhuji", module, content] as const) : []),
    ...(selectedMode("palette", modeSelection) ? paletteModules.map(([module, content]) => ["palette", module, content] as const) : []),
  ].sort(([leftMode, leftModule], [rightMode, rightModule]) => `${leftMode}:${leftModule}`.localeCompare(`${rightMode}:${rightModule}`));
  const wardrobeContent = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.trim().length > 0) return value;
    const record = recordValue(value);
    const content = record?.content;
    return typeof content === "string" && content.trim().length > 0 ? content : undefined;
  };
  const rawWardrobes = bundle.wardrobes ?? bundle.wardrobe ?? bundle.wardrobe_markdown;
  const bundleWardrobes: Array<{ displayName: string; content: string }> = [];
  const directWardrobe = wardrobeContent(rawWardrobes);
  if (directWardrobe !== undefined) {
    const record = recordValue(rawWardrobes);
    bundleWardrobes.push({ displayName: textValue(record?.display_name) ?? displayName, content: directWardrobe });
  } else {
    for (const [characterName, value] of Object.entries(recordValue(rawWardrobes) ?? {})) {
      const content = wardrobeContent(value);
      if (content !== undefined) bundleWardrobes.push({ displayName: characterName, content });
    }
  }
  const artifactVersions = recordValue(metadata.artifact_versions);
  const artifactRevisions = artifactVersions === undefined
    ? {}
    : Object.fromEntries(Object.entries(artifactVersions).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const loreEntries: Ccv3LoreEntry[] = selectedModules.map(([mode, module, content], index) => {
    const localizedName = localizedModeName(mode, module);
    return entry(`legacy.${mode}.${module}`, `${displayName}_${localizedName}`, content, [displayName, localizedName, module], 100 + index);
  });
  loreEntries.push(...bundleWardrobes.map((wardrobeValue, index) => entry(`legacy.wardrobe.${index}`, `${wardrobeValue.displayName}_衣櫃`, wardrobeValue.content, [wardrobeValue.displayName], 200 + index)));
  const project: Ccv3Project = {
    project_id: projectId,
    title: projectName,
    name: projectName,
     character_book_name: `${projectName}_世界書`,
    character_book_description: "",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    alternate_greetings: [],
    group_only_greetings: [],
    lore_entries: loreEntries,
    extensions: {
      "card-workspace": {
        source_format: "workspace-bundle",
        source_schema_version: bundle.schema_version,
        source_card: metadata,
        source_module_count: selectedModules.length,
        source_wardrobe_count: bundleWardrobes.length,
        export_mode: modeSelection ?? "none",
      },
    },
    artifact_revisions: artifactRevisions,
  };
  const card = characterCardV3Schema.parse(emitCharacterCardV3(project));
  const json = canonicalJson(card);
  return { card, json, png: writeCardToPng(undefined, card, { includeV2Backfill: true }), content_hash: contentHash(json) };
}

export const buildProject = compileProject;
export const normalizeAuthorProject = normalizeProject;
