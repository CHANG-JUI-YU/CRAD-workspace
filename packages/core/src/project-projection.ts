import type {
  ArtifactRecord,
  BlueprintPrecheckRecord,
  FactRecord,
  ProjectState,
} from "./project-state.js";
import { artifactBinding } from "./artifact-binding.js";

export interface ProjectIntentCharacter {
  id: string;
  label: string;
  is_primary: boolean;
  aliases: string[];
}

export interface ProjectIntentProjection {
  is_source_adaptation: boolean;
  primary_character_id?: string;
  roster: ProjectIntentCharacter[];
}

export type CardModeSelection = "zhuji" | "palette" | "both";

export interface BuildPlanEntry {
  key: string;
  artifact_id: string;
  kind: ArtifactRecord["kind"];
  revision: string;
}

export interface PublishPlan {
  mode_selection?: CardModeSelection;
  world_enabled: boolean;
  relationships_enabled: boolean;
  entries: readonly BuildPlanEntry[];
}

export type BuildPlan = PublishPlan;

export interface ProjectBlueprintCharacter {
  id: string;
  label: string;
  ordinal: number;
  mode?: "zhuji" | "palette";
  aliases: string[];
}

export interface ProjectBlueprintProjection {
  artifact_id?: string;
  artifact_revision?: string;
  precheck_id?: string;
  precheck_revision?: string;
  characters: ProjectBlueprintCharacter[];
  primary_character_id?: string;
  primary_character_id_explicit: boolean;
  world_enabled: boolean;
  world_authoring_timing?: string;
  relationships_enabled: boolean;
  source_adaptation: boolean;
  artifact_value?: Record<string, unknown>;
  precheck_value?: Record<string, unknown>;
}

/** The one read-only projection used by gates, compiler and runtime plans. */
export interface ProjectProjection {
  currentArtifacts: readonly ArtifactRecord[];
  blueprint?: ProjectBlueprintProjection;
  intent: ProjectIntentProjection;
  roster: readonly ProjectIntentCharacter[];
  factRegister: readonly FactRecord[];
  publishPlan: (modeSelection?: CardModeSelection, options?: { inferMode?: boolean }) => PublishPlan;
}

const NON_PLAN_ARTIFACT_KINDS: ReadonlySet<ArtifactRecord["kind"]> = new Set([
  "review", "source_research", "fact_curation", "fact_review", "conversion", "import_analysis", "director_routing", "unknown", "draft_note",
]);

type MaterializedArtifactValue = {
  character_id?: unknown;
  document?: { id?: unknown; display_name?: unknown };
  module?: { module?: unknown };
  plugin_id?: unknown;
};

export function parseArtifactValue(artifact: ArtifactRecord): MaterializedArtifactValue {
  try {
    const parsed = JSON.parse(artifact.content) as unknown;
    if (parsed !== null && typeof parsed === "object") return parsed as MaterializedArtifactValue;
  } catch {
    // Free-text artifacts do not have structured routing metadata.
  }
  return {};
}

function planRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function getArtifactCharacterId(artifact: ArtifactRecord, rosterIds?: ReadonlySet<string>): string | undefined {
  const binding = artifactBinding(artifact);
  if (binding.global || binding.characterIds.length === 0) return undefined;
  if (rosterIds !== undefined) return binding.characterIds.find((characterId) => rosterIds.has(characterId)) ?? binding.characterIds[0];
  return binding.characterIds[0];
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function parseBlueprintYaml(content: string): Record<string, unknown> | undefined {
  const lines = content.replaceAll("\r", "").split("\n");
  const scalar = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
    return trimmed;
  };
  const indent = (line: string): number => line.match(/^\s*/u)?.[0].length ?? 0;
  const topLevel = (key: string): string | undefined => {
    const match = lines.find((line) => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*:\\s*(.*)$`, "u").test(line));
    return match?.replace(new RegExp(`^${key}\\s*:\\s*`, "u"), "");
  };
  const charactersField = lines.findIndex((line) => /^\s*characters\s*:\s*$/u.test(line));
  const characters: Array<Record<string, unknown>> = [];
  if (charactersField >= 0) {
    const charactersIndent = indent(lines[charactersField] ?? "");
    for (let index = charactersField + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim().length > 0 && indent(line) <= charactersIndent) break;
      const item = line.match(/^(\s*)-\s+(?:id|character_id)\s*:\s*(.+)$/u);
      if (item === null) continue;
      const itemIndent = item[1]?.length ?? charactersIndent + 2;
      const character: Record<string, unknown> = { id: scalar(item[2] ?? "") };
      for (let next = index + 1; next < lines.length; next += 1) {
        const child = lines[next] ?? "";
        if (child.trim().length > 0 && indent(child) <= itemIndent) break;
        const field = child.match(/^\s+(label|display_name|mode|subject_name)\s*:\s*(.+)$/u);
        if (field === null) continue;
        const fieldName = field[1];
        if (fieldName === undefined) continue;
        const key = fieldName === "display_name" ? "label" : fieldName === "subject_name" ? "aliases" : fieldName;
        const value = scalar(field[2] ?? "");
        if (key === "aliases") character.aliases = [value]; else character[key] = value;
      }
      if (typeof character.id === "string" && character.id.length > 0) {
        character.ordinal = characters.length + 1;
        characters.push(character);
      }
    }
  }
  const primary = topLevel("primary_character_id");
  const flow = topLevel("flow");
  if (characters.length === 0 && primary === undefined && flow === undefined) return undefined;
  return {
    ...(characters.length === 0 ? {} : { characters }),
    ...(primary === undefined ? {} : { primary_character_id: scalar(primary) }),
    ...(flow === undefined ? {} : { flow: scalar(flow) }),
  };
}

function parseBlueprintArtifact(artifact: ArtifactRecord): Record<string, unknown> | undefined {
  const parsed = planRecord(parseArtifactValue(artifact));
  return parsed !== undefined && Object.keys(parsed).length > 0 ? parsed : parseBlueprintYaml(artifact.content);
}

function hasBlueprintRoster(value: Record<string, unknown> | undefined): boolean {
  return Array.isArray(value?.characters) && value.characters.some((item) => {
    const entry = planRecord(item);
    return textValue(entry?.id) !== undefined || textValue(entry?.character_id) !== undefined;
  });
}

function parseBlueprintProjection(value: Record<string, unknown> | undefined, refs: { artifact?: ArtifactRecord; precheck?: BlueprintPrecheckRecord } = {}): ProjectBlueprintProjection | undefined {
  if (value === undefined) return undefined;
  const rawCharacters = Array.isArray(value.characters) ? value.characters : [];
  const characters: ProjectBlueprintCharacter[] = [];
  const seen = new Set<string>();
  const sourceAdaptation = planRecord(value.source_adaptation);
  const subjectAliases = new Map<string, string[]>();
  for (const item of Array.isArray(sourceAdaptation?.subjects) ? sourceAdaptation.subjects : []) {
    const subject = planRecord(item);
    const characterId = textValue(subject?.character_id);
    const subjectName = textValue(subject?.subject_name) ?? textValue(subject?.name);
    if (characterId !== undefined && subjectName !== undefined) subjectAliases.set(characterId, [...(subjectAliases.get(characterId) ?? []), subjectName]);
  }
  rawCharacters.forEach((item, index) => {
    const entry = planRecord(item);
    const id = textValue(entry?.id) ?? textValue(entry?.character_id);
    if (id === undefined || seen.has(id)) return;
    seen.add(id);
    const aliases = [...new Set([...stringValues(entry?.aliases), ...(subjectAliases.get(id) ?? [])])];
    characters.push({ id, label: textValue(entry?.label) ?? textValue(entry?.display_name) ?? id, ordinal: typeof entry?.ordinal === "number" && Number.isFinite(entry.ordinal) ? entry.ordinal : index + 1, ...(entry?.mode === "zhuji" || entry?.mode === "palette" ? { mode: entry.mode } : {}), aliases });
  });
  const world = planRecord(value.world);
  const relationships = planRecord(value.relationships);
  const artifact = refs.artifact;
  const precheck = refs.precheck;
  const primary = textValue(value.primary_character_id);
  const timing = textValue(world?.authoring_timing);
  const artifactRaw = artifact === undefined ? undefined : parseBlueprintArtifact(artifact);
  const precheckRaw = precheck?.candidate_blueprint;
  return {
    ...(artifact === undefined ? {} : { artifact_id: artifact.id, artifact_revision: artifact.revision }),
    ...(precheck === undefined ? {} : { precheck_id: precheck.id, precheck_revision: precheck.candidate_blueprint_revision }),
    characters,
    ...(primary === undefined ? {} : { primary_character_id: primary }),
    primary_character_id_explicit: primary !== undefined,
    world_enabled: world === undefined ? precheck !== undefined ? false : true : world.enabled === true,
    ...(timing === undefined ? {} : { world_authoring_timing: timing }),
    relationships_enabled: relationships === undefined ? precheck !== undefined ? false : true : relationships.enabled === true,
    source_adaptation: value.flow === "source_adaptation" || value.intent === "source_adaptation" || value.intent_kind === "source_adaptation" || value.source_adaptation !== undefined,
    ...(artifactRaw === undefined ? {} : { artifact_value: artifactRaw }),
    ...(precheckRaw === undefined ? {} : { precheck_value: precheckRaw }),
  };
}

function parseLatestBlueprint(state: ProjectState, current: readonly ArtifactRecord[]): ProjectBlueprintProjection | undefined {
  const artifact = [...current].reverse().find((item) => item.kind === "blueprint");
  const precheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
  const precheckValue = precheck === undefined ? undefined : planRecord(precheck.candidate_blueprint);
  const artifactValue = artifact === undefined ? undefined : parseBlueprintArtifact(artifact);
  const selectedValue = hasBlueprintRoster(precheckValue) ? precheckValue : artifactValue ?? precheckValue;
  return parseBlueprintProjection(selectedValue, { ...(artifact === undefined ? {} : { artifact }), ...(precheck === undefined ? {} : { precheck }) });
}

function buildIntentProjection(state: ProjectState, blueprint: ProjectBlueprintProjection | undefined): ProjectIntentProjection {
  const sourceAdaptation = state.interview.flow === "source_adaptation" || blueprint?.source_adaptation === true;
  const primaryCharacterId = blueprint?.primary_character_id ?? blueprint?.characters[0]?.id;
  return {
    is_source_adaptation: sourceAdaptation,
    ...(primaryCharacterId === undefined ? {} : { primary_character_id: primaryCharacterId }),
    roster: (blueprint?.characters ?? []).map((character) => ({ id: character.id, label: character.label, is_primary: primaryCharacterId !== undefined && character.id === primaryCharacterId, aliases: character.aliases })),
  };
}

function publishPlanFromProjection(projection: ProjectProjection, modeSelection?: CardModeSelection, options: { inferMode?: boolean } = {}): PublishPlan {
  const latest = projection.currentArtifacts;
  const blueprint = projection.blueprint;
  const worldEnabled = blueprint?.world_enabled ?? true;
  const relationshipsEnabled = blueprint?.relationships_enabled ?? true;
  const rosterIds = blueprint === undefined || blueprint.characters.length === 0 ? undefined : new Set(blueprint.characters.map((character) => character.id));
  const characterModes = blueprint === undefined || blueprint.characters.length === 0 ? undefined : new Map(blueprint.characters.flatMap((character) => character.mode === undefined ? [] : [[character.id, character.mode] as const]));
  let effectiveMode = modeSelection;
  if (effectiveMode === undefined && options.inferMode === true) {
    const hasZhuji = latest.some((artifact) => artifact.kind === "zhuji");
    const hasPalette = latest.some((artifact) => artifact.kind === "palette");
    if (hasZhuji !== hasPalette) effectiveMode = hasZhuji ? "zhuji" : "palette";
  }
  const entries: BuildPlanEntry[] = [];
  for (const artifact of latest) {
    if (NON_PLAN_ARTIFACT_KINDS.has(artifact.kind)) continue;
    if (artifact.kind === "world_lore" && !worldEnabled) continue;
    if (artifact.kind === "relationship" && !relationshipsEnabled) continue;
    const boundCid = getArtifactCharacterId(artifact, rosterIds);
    if (boundCid !== undefined && rosterIds !== undefined && !rosterIds.has(boundCid)) continue;
    if (boundCid !== undefined && effectiveMode !== undefined && effectiveMode !== "both" && characterModes !== undefined) {
      const declaredMode = characterModes.get(boundCid);
      if (declaredMode !== undefined && declaredMode !== effectiveMode) continue;
    }
    if (artifact.kind === "zhuji" || artifact.kind === "palette") {
      if (effectiveMode === undefined) continue;
      if (effectiveMode !== "both" && effectiveMode !== artifact.kind) continue;
    }
    entries.push({ key: artifact.key, artifact_id: artifact.id, kind: artifact.kind, revision: artifact.revision });
  }
  return Object.freeze({ ...(effectiveMode === undefined ? {} : { mode_selection: effectiveMode }), world_enabled: worldEnabled, relationships_enabled: relationshipsEnabled, entries: Object.freeze(entries) });
}

export function currentArtifactsFromRecords(artifacts: readonly ArtifactRecord[]): ArtifactRecord[] {
  const latest = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) latest.set(artifact.key, artifact);
  return [...latest.values()];
}

export function currentArtifacts(state: ProjectState): ArtifactRecord[] {
  return currentArtifactsFromRecords(state.artifacts);
}

export function computeProjectProjection(state: ProjectState): ProjectProjection {
  const current = Object.freeze(currentArtifacts(state));
  const blueprint = parseLatestBlueprint(state, current);
  const intent = buildIntentProjection(state, blueprint);
  const projection = {
    currentArtifacts: current,
    ...(blueprint === undefined ? {} : { blueprint }),
    intent,
    roster: Object.freeze(intent.roster),
    factRegister: Object.freeze([...state.facts]),
    publishPlan: (selection?: CardModeSelection, options: { inferMode?: boolean } = {}) => publishPlanFromProjection(projection as ProjectProjection, selection, options),
  } as ProjectProjection;
  return Object.freeze(projection);
}

export function computePublishPlan(state: ProjectState, modeSelection?: CardModeSelection, options: { inferMode?: boolean } = {}): PublishPlan {
  return computeProjectProjection(state).publishPlan(modeSelection, options);
}

export function computeBuildPlan(state: ProjectState, modeSelection?: CardModeSelection, options: { inferMode?: boolean } = {}): BuildPlan {
  return computePublishPlan(state, modeSelection, options);
}

/** Compatibility wrapper retained for callers that only need the intent slice. */
export function computeProjectIntentProjection(state: ProjectState): ProjectIntentProjection {
  return computeProjectProjection(state).intent;
}
