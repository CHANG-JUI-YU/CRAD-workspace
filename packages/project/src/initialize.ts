import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  blueprintSchema,
  blueprintRelationshipsSchema,
  characterDocumentSchema,
  conflictRegisterSchema,
  factRegisterSchema,
  greetingsDocumentSchema,
  paletteModuleSchema,
  projectManifestSchema,
  relationshipsDocumentSchema,
  sourceManifestSchema,
  workflowStateSchema,
  zhujiModuleSchema,
  type ProjectManifest,
  type Blueprint,
  type BlueprintRelationshipsInput,
  type CollaborationMode,
  type WorkflowEntryKind,
  type WorkflowDecision,
  type WorkflowState,
  type ProjectCharacter,
  type RelationshipsDocument,
} from "@card-workspace/schemas";

import { canonicalJson, canonicalYaml, computeRevision } from "./canonical.js";
import {
  paletteModuleFiles,
  sourcesFactsJournalFiles,
  sourcesFactsProjectionFiles,
  zhujiModuleFiles,
} from "./author-layout.js";
import { ProjectError } from "./errors.js";
import { resolveProjectDirectory } from "./path-security.js";
import { runFileTransaction } from "./transaction.js";
import { blueprintFile, workflowJournalFile, workflowProjectionFile } from "./workflow-layout.js";

export interface InitializeProjectInput {
  projectsRoot: string;
  manifest: ProjectManifest;
  entryKind?: WorkflowEntryKind;
  initialDecisions?: WorkflowDecision[];
  world?: Blueprint["world"];
  collaborationMode?: CollaborationMode;
  relationships?: BlueprintRelationshipsInput;
}

export function relationshipTeamCode(projectId: string, characterIds: readonly string[]): string {
  return createHash("sha256")
    .update(`${projectId}\u0000${[...characterIds].sort().join("\u0000")}`)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
}

export function createRelationshipsPlaceholder(
  projectId: string,
  characterIds: readonly string[],
  teamCode = relationshipTeamCode(projectId, characterIds),
): RelationshipsDocument {
  return relationshipsDocumentSchema.parse({
    schema_version: 1,
    team_code: teamCode,
    character_ids: characterIds,
    character_summaries: characterIds.map((characterId) => ({ character_id: characterId, summary: "[待填寫角色關係摘要]" })),
    perspectives: characterIds.flatMap((sourceCharacterId) => characterIds.map((targetCharacterId) => ({
      source_character_id: sourceCharacterId,
      target_character_id: targetCharacterId,
      summary: "[待填寫方向觀點]",
    }))),
    groups: [],
    summary: {
      network_character: "[待填寫整體關係網特徵]",
      inter_group_relations: "[待填寫群組間關係]",
      stability: "[待填寫關係網穩定性]",
      conflict_triggers: [],
      intimacy_opportunities: [],
    },
  });
}

export function createCharacterPlaceholderOperations(
  characters: readonly ProjectCharacter[],
  expectedAbsent = false,
) {
  return characters.flatMap((character) => {
    const root = `characters/${character.id}`;
    const characterDocument = characterDocumentSchema.parse({
      schema_version: 1,
      id: character.id,
      display_name: character.display_name,
      summary: "[待填寫角色摘要]",
    });
    const modules = character.mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
    return [
      { relativePath: `${root}/character.yaml`, content: canonicalYaml(characterDocument), ...(expectedAbsent ? { expectedAbsent: true } : {}) },
      ...modules.map((module) => {
        const document = {
          schema_version: 1,
          mode: character.mode,
          module: module.kind,
          title: module.title,
          content: "[待填寫]",
        };
        const parsed = character.mode === "zhuji"
          ? zhujiModuleSchema.parse(document)
          : paletteModuleSchema.parse(document);
        return {
          relativePath: `${root}/${character.mode}/${module.file}`,
          content: canonicalYaml(parsed),
          ...(expectedAbsent ? { expectedAbsent: true } : {}),
        };
      }),
    ];
  });
}

const workflowDefinitionIds: Record<WorkflowEntryKind, string> = {
  original: "original-v1",
  source_adaptation: "source-adaptation-v1",
  card_import: "card-import-v1",
  mode_conversion: "mode-conversion-v1",
};

export async function initializeProject(input: InitializeProjectInput): Promise<string> {
  const manifest = projectManifestSchema.parse(input.manifest);
  const relationships = blueprintRelationshipsSchema.parse(input.relationships ?? {
    enabled: false,
  });
  if (relationships.enabled && manifest.kind !== "character_card") {
    throw new ProjectError("RELATIONSHIPS_PROJECT_KIND_INVALID", "只有角色卡專案可啟用角色關係");
  }
  const entryKind = input.entryKind ?? "original";
  if (manifest.kind === "worldbook" && entryKind !== "original") {
    throw new ProjectError("WORLD_BOOK_ENTRY_KIND_INVALID", "世界書專案只支援 original 入口");
  }
  const projectRoot = await resolveProjectDirectory(input.projectsRoot, manifest.id);
  if (path.dirname(projectRoot) !== path.resolve(input.projectsRoot)) {
    throw new ProjectError("PROJECT_PATH_INVALID", "專案目錄必須直接位於 projects 根目錄");
  }
  try {
    await stat(projectRoot);
    throw new ProjectError("PROJECT_EXISTS", `專案已存在：${manifest.id}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const workflow: WorkflowState = workflowStateSchema.parse({
    schema_version: 2,
    project_id: manifest.id,
    workflow_definition_id: workflowDefinitionIds[entryKind],
    entry_kind: entryKind,
    stage: "intake",
    revision: 0,
    artifacts: [],
    gates: [],
    tasks: [],
    decisions: input.initialDecisions ?? [],
    extensions: {},
  });
  const requestedWorld: Blueprint["world"] = input.world ?? {
    enabled: manifest.kind === "worldbook",
    categories: [],
    fact_refs: [],
  };
  const world = requestedWorld.enabled
    ? {
        ...requestedWorld,
        authoring_timing: requestedWorld.authoring_timing
          ?? (manifest.kind === "worldbook" ? "before_characters" as const : "after_characters" as const),
      }
    : requestedWorld;
  const blueprint: Blueprint = blueprintSchema.parse({
    schema_version: 1,
    project_id: manifest.id,
    entry_kind: entryKind,
    collaboration_mode: input.collaborationMode ?? "free",
    purpose: "[待確認專案目的]",
    characters: manifest.characters.map((character) => ({
      id: character.id,
      display_name: character.display_name,
      mode: character.mode,
      core_concept: "[待確認角色核心概念]",
    })),
    world,
    greetings: {
      enabled: manifest.kind === "character_card",
      character_ids: manifest.characters.map((character) => character.id),
    },
    relationships,
  });
  const authorOperations = createCharacterPlaceholderOperations(manifest.characters);
  const greetings = manifest.kind === "character_card"
    ? greetingsDocumentSchema.parse({
        schema_version: 1,
        greetings: [{
          id: "primary",
          kind: "primary",
          content: "[待填寫開場白]",
          character_ids: (manifest.characters.some((character) => character.role === "primary")
            ? manifest.characters.filter((character) => character.role === "primary")
            : manifest.characters).map((character) => character.id),
        }],
      })
    : undefined;
  const relationshipDocument = blueprint.relationships.enabled
    ? createRelationshipsPlaceholder(manifest.id, blueprint.relationships.character_ids)
    : undefined;
  const sourceState = { schema_version: 1 as const, sources: [], extensions: {} };
  const factState = { schema_version: 1 as const, facts: [], extensions: {} };
  const conflictState = { schema_version: 1 as const, conflicts: [], extensions: {} };
  const sourceManifest = sourceManifestSchema.parse({
    ...sourceState,
    revision: computeRevision(sourceState),
  });
  const factRegister = factRegisterSchema.parse({
    ...factState,
    revision: computeRevision(factState),
  });
  const conflictRegister = conflictRegisterSchema.parse({
    ...conflictState,
    revision: computeRevision(conflictState),
  });
  await runFileTransaction({
    root: projectRoot,
    operations: [
      { relativePath: "project.yaml", content: canonicalYaml(manifest) },
      { relativePath: workflowProjectionFile, content: canonicalJson(workflow) },
      { relativePath: blueprintFile, content: canonicalYaml(blueprint) },
      { relativePath: workflowJournalFile, content: "" },
      ...(manifest.kind === "character_card"
        ? [{ relativePath: "greetings.yaml", content: canonicalYaml(greetings!) }]
        : []),
      ...(relationshipDocument
        ? [{ relativePath: "relationships.yaml", content: canonicalYaml(relationshipDocument) }]
        : []),
      {
        relativePath: sourcesFactsProjectionFiles.sourceManifest,
        content: canonicalYaml(sourceManifest),
      },
      {
        relativePath: sourcesFactsProjectionFiles.factRegister,
        content: canonicalYaml(factRegister),
      },
      {
        relativePath: sourcesFactsProjectionFiles.conflictRegister,
        content: canonicalYaml(conflictRegister),
      },
      ...sourcesFactsJournalFiles.map((relativePath) => ({ relativePath, content: "" })),
      ...authorOperations,
    ],
  });
  return projectRoot;
}
