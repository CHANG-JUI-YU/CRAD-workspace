import { contentHash, type ArtifactRecord, type ProjectState } from "@st-workspace/core";

/**
 * Shared descriptor of required module keys per card mode. This is the single
 * authoritative list consumed by authoring readiness, the publish gate, and
 * build mode selection — it is intentionally not duplicated inside the
 * compiler or runtime.
 */
export const ZHUJI_REQUIRED_MODULES = [
  "appearance",
  "inner_nature",
  "extension",
  "trait_refinement",
  "trait_dialogue",
  "scene_dialogue",
  "self_introduction",
] as const;

export const PALETTE_REQUIRED_MODULES = [
  "basic_information",
  "personality_palette",
  "tri_faceted",
  "secondary_interpretation",
] as const;

export type CardMode = "zhuji" | "palette";
export type ManifestCardModeSelection = CardMode | "both";

export interface ManifestCharacterRequirement {
  character_id: string;
  display_name: string;
  ordinal: number;
  mode?: CardMode;
  required_modules: readonly string[];
  present_modules: string[];
  missing_modules: string[];
  mode_complete: boolean;
  character_artifact_id?: string;
  character_artifact_revision?: string;
  display_name_present: boolean;
}

export interface ManifestFeatureRequirement {
  enabled: boolean;
  required: boolean;
  complete: boolean;
  artifact_ids: string[];
}

export interface ManifestDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * The required artifact manifest derived from the latest approved Blueprint.
 * Every authoring, review, build and publish flow consumes the same manifest,
 * so the publish gate only blocks on artifacts the Blueprint actually selected
 * (selected card mode modules, enabled world/relationships, primary greeting)
 * and never on stale artifacts of an unselected mode.
 */
export interface RequiredArtifactManifest {
  schema_version: 1;
  blueprint_precheck_id?: string;
  blueprint_precheck_revision?: string;
  blueprint_artifact_id?: string;
  blueprint_artifact_revision?: string;
  primary_character_id?: string;
  primary_character_display_name?: string;
  characters: ManifestCharacterRequirement[];
  world: ManifestFeatureRequirement;
  relationships: ManifestFeatureRequirement;
  greeting: ManifestFeatureRequirement;
  export_modes: ManifestCardModeSelection;
  in_scope_artifact_ids: string[];
  in_scope_artifact_keys: string[];
  diagnostics: ManifestDiagnostic[];
}

interface BlueprintWorldShape {
  enabled?: unknown;
  authoring_timing?: unknown;
}

interface BlueprintRelationshipsShape {
  enabled?: unknown;
}

interface BlueprintCharacterShape {
  id?: unknown;
  label?: unknown;
  ordinal?: unknown;
  mode?: unknown;
}

interface BlueprintShape {
  primary_character_id?: unknown;
  characters?: unknown;
  world?: unknown;
  relationships?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseJson(content: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return record(value);
  } catch {
    return undefined;
  }
}

function modeModuleKeys(artifact: ArtifactRecord): string[] {
  const parsed = parseJson(artifact.content);
  if (parsed === undefined) return [];
  const module = record(parsed.module);
  const moduleKey = text(module?.module);
  return moduleKey === undefined ? [] : [moduleKey];
}

/** True when the artifact is a zhuji/palette module of `mode` for `characterId`. */
function isModeModule(artifact: ArtifactRecord, mode: CardMode, characterId: string): boolean {
  if (artifact.kind !== mode) return false;
  const parsed = parseJson(artifact.content);
  if (parsed === undefined) return false;
  if (text(parsed.character_id) !== characterId) return false;
  return modeModuleKeys(artifact).length > 0;
}

function characterDocument(artifact: ArtifactRecord): { id?: string; display_name?: string } | undefined {
  const parsed = parseJson(artifact.content);
  if (parsed === undefined) return undefined;
  const document = record(parsed.document);
  if (document === undefined) return undefined;
  const id = text(document.id);
  const displayName = text(document.display_name);
  return {
    ...(id === undefined ? {} : { id }),
    ...(displayName === undefined ? {} : { display_name: displayName }),
  };
}

/**
 * The current projection of a project's artifacts: only the latest revision
 * per artifact key. Manifest completeness must never be judged against stale
 * revisions, so every manifest helper consumes this projection.
 */
export function currentArtifacts(state: ProjectState): ArtifactRecord[] {
  const latest = new Map<string, ArtifactRecord>();
  for (const artifact of state.artifacts) latest.set(artifact.key, artifact);
  return [...latest.values()];
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function latestCharacterFor(artifacts: readonly ArtifactRecord[], characterId: string, label: string | undefined): { artifact: ArtifactRecord; document: { id?: string; display_name?: string } } | undefined {
  const candidates = artifacts.filter((artifact) => artifact.kind === "character");
  let best: { artifact: ArtifactRecord; document: { id?: string; display_name?: string } } | undefined;
  let bestScore = 0;
  for (const artifact of candidates) {
    const document = characterDocument(artifact);
    let score = 0;
    if (document?.id === characterId) score += 2;
    if (document?.display_name === label) score += 1;
    if (artifact.name === characterId) score += 1;
    if (artifact.key === `character:${characterId}`) score += 1;
    if (bestScore === 0 ? score > 0 : score >= bestScore) {
      bestScore = score;
      best = { artifact, document: document ?? {} };
    }
  }
  return bestScore === 0 ? undefined : best;
}

function greetingCoversPrimary(artifacts: readonly ArtifactRecord[], primaryCharacterId: string): { artifactIds: string[]; complete: boolean } {
  let complete = false;
  const artifactIds: string[] = [];
  const target = normalized(primaryCharacterId);
  for (const artifact of artifacts) {
    if (artifact.kind !== "greeting") continue;
    artifactIds.push(artifact.id);
    const parsed = parseJson(artifact.content);
    if (parsed === undefined) continue;
    const document = record(parsed.document);
    const greetings = Array.isArray(document?.greetings) ? document.greetings : [];
    const covers = greetings.some((entry) => {
      const item = record(entry);
      const characterIds = Array.isArray(item?.character_ids) ? item.character_ids : [];
      return characterIds.some((id) => typeof id === "string" && normalized(id) === target);
    });
    if (covers) complete = true;
  }
  return { artifactIds, complete };
}

function worldArtifactIds(artifacts: readonly ArtifactRecord[]): string[] {
  return artifacts.filter((artifact) => artifact.kind === "world_lore").map((artifact) => artifact.id);
}

function relationshipArtifactIds(artifacts: readonly ArtifactRecord[]): string[] {
  return artifacts.filter((artifact) => artifact.kind === "relationship").map((artifact) => artifact.id);
}

/**
 * Build the required artifact manifest from the latest approved (recorded)
 * Blueprint precheck. Returns undefined for legacy projects without a usable
 * Blueprint roster, in which case callers must fall back to the full-artifact
 * gate behaviour.
 */
export function buildRequiredArtifactManifest(
  state: ProjectState,
  exportMode?: CardMode,
): RequiredArtifactManifest | undefined {
  const recorded = [...state.blueprint_prechecks].reverse().find((precheck) => precheck.status === "recorded");
  if (recorded === undefined) return undefined;
  const blueprint = record(recorded.candidate_blueprint);
  if (blueprint === undefined) return undefined;

  const roster = Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const characters: BlueprintCharacterShape[] = [];
  const rosterSeen = new Set<string>();
  for (const entry of roster) {
    const item = record(entry);
    if (item === undefined) continue;
    const characterId = text(item.id);
    if (characterId === undefined || rosterSeen.has(characterId)) continue;
    rosterSeen.add(characterId);
    characters.push(item);
  }
  if (characters.length === 0) return undefined;

  const diagnostics: ManifestDiagnostic[] = [];
  const inScope = new Set<string>();
  const inScopeKeys = new Set<string>();
  const current = currentArtifacts(state);

  const addScope = (artifactIds: readonly string[]): void => {
    for (const artifactId of artifactIds) {
      const artifact = current.find((candidate) => candidate.id === artifactId);
      if (artifact === undefined) continue;
      inScope.add(artifactId);
      inScopeKeys.add(artifact.key);
    }
  };

  const explicitPrimary = text(blueprint.primary_character_id);
  const rosterOrdered = [...characters]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftOrdinal = typeof left.item.ordinal === "number" ? left.item.ordinal : left.index + 1;
      const rightOrdinal = typeof right.item.ordinal === "number" ? right.item.ordinal : right.index + 1;
      return leftOrdinal - rightOrdinal;
    });
  const fallbackPrimary = text(rosterOrdered[0]?.item.id);
  const primaryCharacterId = explicitPrimary ?? fallbackPrimary;
  if (explicitPrimary === undefined && fallbackPrimary !== undefined) {
    diagnostics.push({
      code: "BLUEPRINT_PRIMARY_CHARACTER_FALLBACK",
      severity: "warning",
      message: `Blueprint has no explicit primary_character_id; using roster order (${fallbackPrimary}) for the primary character.`,
    });
  }

  const characterRequirements: ManifestCharacterRequirement[] = [];
  for (const { item } of rosterOrdered) {
    const characterId = text(item.id)!;
    const label = text(item.label);
    const rawMode = text(item.mode);
    const mode: CardMode | undefined = rawMode === "zhuji" || rawMode === "palette" ? rawMode : undefined;
    if (mode === undefined) {
      diagnostics.push({
        code: "BLUEPRINT_CHARACTER_MODE_INVALID",
        severity: "error",
        message: `Blueprint character ${characterId} must declare a valid mode: zhuji or palette. 請在 Blueprint 中為該角色補充 mode（zhuji 或 palette）後重新產生 Blueprint，再繼續打包與發布。`,
      });
    }
    const includedInExport = exportMode === undefined || exportMode === mode;
    const matched = latestCharacterFor(current, characterId, label);
    const displayName = matched?.document.display_name ?? label ?? characterId;
    const requiredModules = mode === "palette" ? PALETTE_REQUIRED_MODULES : ZHUJI_REQUIRED_MODULES;
    const presentModules = includedInExport && mode !== undefined
      ? current.filter((artifact) => isModeModule(artifact, mode, characterId)).flatMap(modeModuleKeys)
      : [];
    const missingModules = includedInExport ? requiredModules.filter((module) => !presentModules.includes(module)) : [];
    if (matched !== undefined) addScope([matched.artifact.id]);
    if (matched === undefined) {
      diagnostics.push({
        code: "CHARACTER_ARTIFACT_MISSING",
        severity: "error",
        message: `Blueprint roster character ${characterId} has no character artifact.`,
      });
    } else if (!matched.document.display_name) {
      diagnostics.push({
        code: "CHARACTER_DISPLAY_NAME_MISSING",
        severity: "error",
        message: `Character artifact ${matched.artifact.id} has no formal display_name.`,
      });
    }
    if (mode !== undefined && includedInExport && missingModules.length > 0) {
      diagnostics.push({
        code: "MODE_MODULES_INCOMPLETE",
        severity: "error",
        message: `Character ${characterId} is missing ${mode} modules: ${missingModules.join(", ")}.`,
      });
    }
    characterRequirements.push({
      character_id: characterId,
      display_name: displayName,
      ordinal: typeof item.ordinal === "number" ? item.ordinal : 1,
      ...(mode === undefined ? {} : { mode }),
      required_modules: requiredModules,
      present_modules: [...new Set(presentModules)],
      missing_modules: missingModules,
      mode_complete: mode === undefined ? false : missingModules.length === 0,
      ...(matched === undefined ? {} : { character_artifact_id: matched.artifact.id, character_artifact_revision: matched.artifact.revision }),
      display_name_present: matched?.document.display_name !== undefined,
    });
  }

  const world = record(blueprint.world) as BlueprintWorldShape | undefined;
  const worldEnabled = world?.enabled === true;
  const worldArtifacts = worldArtifactIds(current);
  const worldTiming = text(world?.authoring_timing);
  if (worldEnabled) addScope(worldArtifacts);
  if (worldEnabled && worldArtifacts.length === 0) {
    diagnostics.push({
      code: "REQUIRED_WORLD_ARTIFACT_MISSING",
      severity: "error",
      message: "Blueprint enables world authoring but no world_lore artifact exists.",
    });
  }

  const relationships = record(blueprint.relationships) as BlueprintRelationshipsShape | undefined;
  const relationshipsEnabled = relationships?.enabled === true;
  const relationshipArtifacts = relationshipArtifactIds(current);
  if (relationshipsEnabled) addScope(relationshipArtifacts);
  if (relationshipsEnabled && relationshipArtifacts.length === 0) {
    diagnostics.push({
      code: "REQUIRED_RELATIONSHIPS_ARTIFACT_MISSING",
      severity: "error",
      message: "Blueprint enables relationships but no relationship artifact exists.",
    });
  }

  const greeting = greetingCoversPrimary(current, primaryCharacterId ?? "");
  const greetingRequired = characters.length > 0;
  addScope(greeting.artifactIds);
  if (greetingRequired && primaryCharacterId !== undefined && !greeting.complete) {
    diagnostics.push({
      code: "REQUIRED_GREETING_MISSING",
      severity: "error",
      message: `Primary character ${primaryCharacterId} has no covering greeting artifact.`,
    });
  }

  const selectedModes = new Set(characterRequirements.flatMap((character) => character.mode === undefined ? [] : [character.mode]));
  const exportModes: ManifestCardModeSelection = exportMode ?? (selectedModes.size === 1 ? [...selectedModes][0]! : "both");
  for (const character of characterRequirements) {
    if (character.mode === undefined) continue;
    const includedInExport = exportMode === undefined || exportMode === character.mode;
    if (!includedInExport) continue;
    for (const artifact of current) {
      if (isModeModule(artifact, character.mode, character.character_id)) addScope([artifact.id]);
    }
  }
  addScope(current.filter((artifact) => artifact.kind === "wardrobe").map((artifact) => artifact.id));

  const primaryCharacter = characterRequirements.find((character) => character.character_id === primaryCharacterId);
  return {
    schema_version: 1,
    ...(recorded.id === undefined ? {} : { blueprint_precheck_id: recorded.id }),
    ...(recorded.candidate_blueprint_revision === undefined ? {} : { blueprint_precheck_revision: recorded.candidate_blueprint_revision }),
    ...(primaryCharacter === undefined ? {} : {
      primary_character_id: primaryCharacter.character_id,
      primary_character_display_name: primaryCharacter.display_name,
    }),
    characters: characterRequirements,
    world: { enabled: worldEnabled, ...(worldTiming === undefined ? {} : { authoring_timing: worldTiming }), required: worldEnabled, complete: worldEnabled ? worldArtifacts.length > 0 : true, artifact_ids: worldArtifacts },
    relationships: { enabled: relationshipsEnabled, required: relationshipsEnabled, complete: relationshipsEnabled ? relationshipArtifacts.length > 0 : true, artifact_ids: relationshipArtifacts },
    greeting: { enabled: greetingRequired, required: greetingRequired, complete: !greetingRequired || primaryCharacterId === undefined || greeting.complete, artifact_ids: greeting.artifactIds },
    export_modes: exportModes,
    in_scope_artifact_ids: [...inScope],
    in_scope_artifact_keys: [...inScopeKeys],
    diagnostics,
  };
}

/** Deterministic fingerprint of the manifest binding, for audit/details. */
export function manifestBindingHash(manifest: RequiredArtifactManifest): string {
  return contentHash(`${manifest.blueprint_precheck_id ?? "legacy"}\0${manifest.blueprint_precheck_revision ?? ""}`);
}
