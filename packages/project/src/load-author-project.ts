import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  characterDocumentSchema,
  conflictRegisterSchema,
  factRegisterSchema,
  greetingsDocumentSchema,
  paletteModuleSchema,
  relationshipsDocumentSchema,
  sourceManifestSchema,
  validateSchema,
  worldCategorySchema,
  worldEntrySchema,
  zhujiModuleSchema,
  type CharacterDocument,
  type Blueprint,
  type Diagnostic,
  type GreetingsDocument,
  type FactRegister,
  type PaletteModule,
  type ProjectManifest,
  type PluginSource,
  type RelationshipsDocument,
  type Revision,
  type SourceManifest,
  type WorkflowState,
  type WorldEntry,
  type ZhujiModule,
  officialPluginIdSchema,
  pluginArtifactSchema,
  pluginSelectionProjectionSchema,
  type PluginArtifact,
  type PluginSelectionProjection,
} from "@card-workspace/schemas";
import type { z } from "zod";

import {
  legacyZhujiModuleFiles,
  paletteModuleFiles,
  sourcesFactsJournalFiles,
  sourcesFactsProjectionFiles,
  zhujiModuleFiles,
} from "./author-layout.js";
import { canonicalJson, computeTextRevision } from "./canonical.js";
import { parseStructuredFile, scanStructuredFiles } from "./parser.js";
import { listPluginArtifacts, listPluginSourceDirectories, pluginArtifactRoot, readPluginSelection, readPluginSource } from "./plugin-storage.js";
import { resolveWithin } from "./path-security.js";
import { validateProject } from "./validate.js";

export interface LoadedAuthorCharacter {
  manifest: ProjectManifest["characters"][number];
  document: CharacterDocument;
  modules: Array<ZhujiModule | PaletteModule>;
}

export type LoadedConflictRegister = z.output<typeof conflictRegisterSchema>;

export interface LoadedAuthorProject {
  ok: boolean;
  projectRoot: string;
  manifest?: ProjectManifest;
  workflow?: WorkflowState;
  blueprint?: Blueprint;
  characters: LoadedAuthorCharacter[];
  greetings?: GreetingsDocument;
  relationships?: RelationshipsDocument;
  world: WorldEntry[];
  sourceManifest?: SourceManifest;
  factRegister?: FactRegister;
  conflictRegister?: LoadedConflictRegister;
  sourceRevisions: Record<string, Revision>;
  pluginSources?: PluginSource[];
  pluginSelection?: PluginSelectionProjection;
  pluginSelectionRevision?: Revision;
  pluginArtifacts?: PluginArtifact[];
  diagnostics: Diagnostic[];
}

function diagnostic(code: string, message: string, file: string, pathSegments?: Array<string | number>): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    location: { file, ...(pathSegments ? { path: pathSegments } : {}) },
    evidence: [],
    fixability: "manual",
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function parseAuthorFile<T>(
  projectRoot: string,
  relativePath: string,
  schema: z.ZodType<T>,
  code: string,
  diagnostics: Diagnostic[],
  sourceRevisions: Record<string, Revision>,
): Promise<T | undefined> {
  const filePath = await resolveWithin(projectRoot, relativePath);
  if (!(await pathExists(filePath))) {
    diagnostics.push(diagnostic("AUTHOR_FILE_MISSING", `缺少作者文件：${relativePath}`, relativePath));
    return undefined;
  }
  const parsed = await parseStructuredFile(filePath, { displayPath: relativePath });
  diagnostics.push(...parsed.diagnostics);
  if (parsed.data === undefined) return undefined;
  sourceRevisions[relativePath] = computeTextRevision(parsed.raw);
  const validated = validateSchema(schema, parsed.data, { file: relativePath, code });
  diagnostics.push(...validated.diagnostics);
  return validated.ok ? validated.data : undefined;
}

async function requiredFileStatus(
  projectRoot: string,
  relativePath: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  const filePath = await resolveWithin(projectRoot, relativePath);
  try {
    let currentPath = projectRoot;
    let file;
    for (const segment of relativePath.split("/")) {
      currentPath = path.join(currentPath, segment);
      file = await lstat(currentPath);
      if (file.isSymbolicLink()) {
        diagnostics.push(diagnostic("AUTHOR_PATH_LINK_DENIED", `必要檔案不得使用 symlink 或 junction：${relativePath}`, relativePath));
        return undefined;
      }
    }
    if (!file?.isFile()) {
      diagnostics.push(diagnostic("AUTHOR_FILE_TYPE_INVALID", `必要路徑不是一般檔案：${relativePath}`, relativePath));
      return undefined;
    }
    return filePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    diagnostics.push(
      diagnostic(
        "PROJECT_SCHEMA_MIGRATION_REQUIRED",
        `舊專案缺少 Sources/Facts 必要檔案，請執行 schema migration：${relativePath}`,
        relativePath,
      ),
    );
    return undefined;
  }
}

async function parseProjection<T>(
  projectRoot: string,
  relativePath: string,
  schema: z.ZodType<T>,
  code: string,
  diagnostics: Diagnostic[],
  sourceRevisions: Record<string, Revision>,
): Promise<T | undefined> {
  const filePath = await requiredFileStatus(projectRoot, relativePath, diagnostics);
  if (!filePath) return undefined;
  const parsed = await parseStructuredFile(filePath, { displayPath: relativePath });
  diagnostics.push(...parsed.diagnostics);
  if (parsed.data === undefined) return undefined;
  sourceRevisions[relativePath] = computeTextRevision(parsed.raw);
  const validated = validateSchema(schema, parsed.data, { file: relativePath, code });
  diagnostics.push(...validated.diagnostics);
  return validated.ok ? validated.data : undefined;
}

async function validateJournal(projectRoot: string, relativePath: string, diagnostics: Diagnostic[]): Promise<void> {
  const filePath = await requiredFileStatus(projectRoot, relativePath, diagnostics);
  if (!filePath) return;
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filePath));
  } catch {
    diagnostics.push(diagnostic("JOURNAL_ENCODING_INVALID", "Journal 必須是有效 UTF-8", relativePath));
    return;
  }
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (line.length === 0) continue;
    try {
      JSON.parse(line);
    } catch {
      diagnostics.push(diagnostic("JOURNAL_JSONL_INVALID", "Journal 每個非空行必須是有效 JSON", relativePath, [index + 1]));
    }
  }
}

function uniqueDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([item.code, item.message, item.location]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSourcesFactsDiagnostic(item: Diagnostic): boolean {
  const file = item.location?.file.replaceAll("\\", "/");
  return file?.startsWith("sources/") === true || file?.startsWith("facts/") === true;
}

export async function loadAuthorProject(
  projectsRoot: string,
  projectId: string,
): Promise<LoadedAuthorProject> {
  const foundation = await validateProject(projectsRoot, projectId);
  // Sources/Facts are loaded only through the exact required paths below.
  const diagnostics = foundation.diagnostics.filter((item) => !isSourcesFactsDiagnostic(item));
  const sourceRevisions: Record<string, Revision> = {};
  const pluginSources: PluginSource[] = [];
  const pluginArtifacts: PluginArtifact[] = [];
  const characters: LoadedAuthorCharacter[] = [];
  const world: WorldEntry[] = [];
  const { projectRoot, manifest, workflow, blueprint } = foundation;

  if (!manifest || !workflow) {
    const finalDiagnostics = uniqueDiagnostics(diagnostics);
    return {
      ok: false,
      projectRoot,
      characters,
      world,
      sourceRevisions,
      pluginSources,
      pluginArtifacts,
      diagnostics: finalDiagnostics,
    };
  }

  const projectPath = await resolveWithin(projectRoot, "project.yaml");
  sourceRevisions["project.yaml"] = computeTextRevision(await readFile(projectPath, "utf8"));

  if (blueprint) {
    const blueprintPath = await resolveWithin(projectRoot, "blueprint.yaml");
    sourceRevisions["blueprint.yaml"] = computeTextRevision(await readFile(blueprintPath, "utf8"));
  }

  if (manifest.kind === "worldbook" && manifest.plugins.length > 0) {
    diagnostics.push(diagnostic("PLUGIN_PROJECT_KIND_DENIED", "worldbook 不支援官方 authoring plugins", "project.yaml", ["plugins"]));
  }
  for (const pluginId of manifest.plugins) {
    const parsedId = officialPluginIdSchema.safeParse(pluginId);
    if (!parsedId.success) {
      diagnostics.push(diagnostic("PLUGIN_ID_UNKNOWN", `未知的 active plugin: ${pluginId}`, "project.yaml", ["plugins"]));
      continue;
    }
    let loadedSource: Awaited<ReturnType<typeof readPluginSource>>;
    try {
      loadedSource = await readPluginSource(projectRoot, parsedId.data);
    } catch (error) {
      diagnostics.push(diagnostic("PLUGIN_SOURCE_INVALID", `plugin source 無法安全解析：${error instanceof Error ? error.message : String(error)}`, `extensions/${pluginId}/source.yaml`));
      continue;
    }
    if (!loadedSource) {
      diagnostics.push(diagnostic("PLUGIN_SOURCE_MISSING", `active plugin 缺少 source: ${pluginId}`, `extensions/${pluginId}/source.yaml`));
      continue;
    }
    sourceRevisions[loadedSource.relativePath] = loadedSource.revision;
    pluginSources.push(loadedSource.source);
    if (loadedSource.source.project_kind !== manifest.kind) {
      diagnostics.push(diagnostic("PLUGIN_PROJECT_KIND_MISMATCH", `plugin ${pluginId} project_kind 與 manifest 不一致`, loadedSource.relativePath));
    }
  }
  for (const sourceId of await listPluginSourceDirectories(projectRoot)) {
    if (!officialPluginIdSchema.safeParse(sourceId).success) {
      diagnostics.push(diagnostic("PLUGIN_ID_UNKNOWN", `未知的 plugin source 不可自動使用: ${sourceId}`, `extensions/${sourceId}/source.yaml`));
    } else if (!manifest.plugins.includes(sourceId)) {
      diagnostics.push(diagnostic("PLUGIN_ORPHAN_SOURCE", `未啟用的 plugin source 不可自動使用: ${sourceId}`, `extensions/${sourceId}/source.yaml`));
    }
  }

  let selectionFile: Awaited<ReturnType<typeof readPluginSelection>>;
  try {
    selectionFile = await readPluginSelection(projectRoot);
  } catch (error) {
    diagnostics.push(diagnostic("PLUGIN_SELECTION_INVALID", `plugin-selection.yaml 無法安全解析：${error instanceof Error ? error.message : String(error)}`, ".workflow/plugin-selection.yaml"));
    selectionFile = undefined;
  }
  let pluginSelection: PluginSelectionProjection | undefined;
  let pluginSelectionRevision: Revision | undefined;
  if (selectionFile) {
    sourceRevisions[".workflow/plugin-selection.yaml"] = selectionFile.revision;
    pluginSelectionRevision = selectionFile.revision;
    const parsedSelection = pluginSelectionProjectionSchema.safeParse(selectionFile.projection);
    if (!parsedSelection.success) {
      diagnostics.push(diagnostic("PLUGIN_SELECTION_INVALID", "plugin-selection.yaml 不符合正式 schema", ".workflow/plugin-selection.yaml"));
    } else {
      pluginSelection = parsedSelection.data;
      if (pluginSelection.project_id !== manifest.id) {
        diagnostics.push(diagnostic("PLUGIN_SELECTION_PROJECT_MISMATCH", "plugin-selection project_id 與 manifest 不一致", ".workflow/plugin-selection.yaml", ["project_id"]));
      }
      const activeIds = [...manifest.plugins].sort();
      const selectedIds = pluginSelection.selections.map((selection) => selection.plugin_id).sort();
      if (JSON.stringify(activeIds) !== JSON.stringify(selectedIds)) {
        diagnostics.push(diagnostic("PLUGIN_SELECTION_ACTIVE_MISMATCH", "plugin-selection 必須精確對應 manifest.plugins", ".workflow/plugin-selection.yaml", ["selections"]));
      }
    }
  } else if (manifest.plugins.length > 0) {
    diagnostics.push(diagnostic("PLUGIN_SELECTION_MISSING", "active plugin 缺少 server-derived plugin-selection", ".workflow/plugin-selection.yaml"));
  }

  let loadedArtifacts: Awaited<ReturnType<typeof listPluginArtifacts>> = [];
  try {
    loadedArtifacts = await listPluginArtifacts(projectRoot);
  } catch (error) {
    diagnostics.push(diagnostic("PLUGIN_ARTIFACT_INVALID", `plugin artifact 無法安全解析：${error instanceof Error ? error.message : String(error)}`, pluginArtifactRoot));
  }
  for (const loadedArtifact of loadedArtifacts) {
    sourceRevisions[loadedArtifact.relativePath] = loadedArtifact.revision;
    const parsedArtifact = pluginArtifactSchema.safeParse(loadedArtifact.artifact);
    if (!parsedArtifact.success) {
      diagnostics.push(diagnostic("PLUGIN_ARTIFACT_INVALID", `plugin artifact 無效: ${loadedArtifact.relativePath}`, loadedArtifact.relativePath));
      continue;
    }
    const expectedId = loadedArtifact.relativePath.split("/").at(-1)?.replace(/\.json$/u, "");
    if (expectedId !== parsedArtifact.data.id) {
      diagnostics.push(diagnostic("PLUGIN_ARTIFACT_ID_MISMATCH", `plugin artifact 檔名與內容 ID 不一致: ${loadedArtifact.relativePath}`, loadedArtifact.relativePath, ["id"]));
      continue;
    }
    pluginArtifacts.push(parsedArtifact.data);
  }
  for (const artifact of pluginArtifacts) {
    if (!manifest.plugins.includes(artifact.plugin_id)) {
      diagnostics.push(diagnostic("PLUGIN_ORPHAN_ARTIFACT", `未啟用的 plugin artifact 不可自動使用: ${artifact.id}`, `.workflow/plugin-artifacts/${artifact.id}.json`));
    }
  }
  const reportedMissingArtifacts = new Set<string>();
  const reportMissingArtifact = (pluginId: string): void => {
    if (reportedMissingArtifacts.has(pluginId)) return;
    reportedMissingArtifacts.add(pluginId);
    diagnostics.push(diagnostic("PLUGIN_ARTIFACT_MISSING", `active plugin 缺少 approved artifact: ${pluginId}`, `.workflow/plugin-artifacts/plugin-${pluginId}.json`));
  };
  for (const pluginId of manifest.plugins) {
    if (!pluginArtifacts.some((artifact) => artifact.plugin_id === pluginId && artifact.status === "approved")) {
      reportMissingArtifact(pluginId);
    }
  }
  if (pluginSelection) {
    for (const selection of pluginSelection.selections) {
      const source = pluginSources.find((candidate) => candidate.plugin_id === selection.plugin_id);
      if (!source) continue;
      const sourcePath = `extensions/${selection.plugin_id}/source.yaml`;
      if (sourceRevisions[sourcePath] !== selection.source_revision) {
        diagnostics.push(diagnostic("PLUGIN_SELECTION_SOURCE_MISMATCH", `selection 的 source revision 與正式 source 不一致: ${selection.plugin_id}`, ".workflow/plugin-selection.yaml"));
      }
      if (canonicalJson(source.implementation) !== canonicalJson(selection.implementation)) {
        diagnostics.push(diagnostic("PLUGIN_SELECTION_IMPLEMENTATION_MISMATCH", `selection 的 implementation pin 與 source 不一致: ${selection.plugin_id}`, ".workflow/plugin-selection.yaml"));
      }
      const expectedCapabilities = source.plugin_id === "official.mvu-zod"
        ? ["mvu"]
        : source.plugin_id === "official.ejs"
          ? ["ejs"]
          : source.features.map((feature) => `html.${feature}`);
      if (canonicalJson([...selection.capabilities].sort()) !== canonicalJson([...new Set(expectedCapabilities)].sort())) {
        diagnostics.push(diagnostic("PLUGIN_SELECTION_CAPABILITIES_MISMATCH", `selection 的 capabilities 與 source 不一致: ${selection.plugin_id}`, ".workflow/plugin-selection.yaml", ["selections"]));
      }
      const artifact = pluginArtifacts.find((candidate) => candidate.plugin_id === selection.plugin_id);
      if (!artifact || artifact.status !== "approved") {
        reportMissingArtifact(selection.plugin_id);
      } else if (artifact.revision !== selection.artifact_revision) {
        diagnostics.push(diagnostic("PLUGIN_ARTIFACT_REVISION_MISMATCH", `selection 的 artifact revision 與 approved artifact 不一致: ${selection.plugin_id}`, ".workflow/plugin-selection.yaml"));
      } else if (artifact.source_revision !== selection.source_revision) {
        diagnostics.push(diagnostic("PLUGIN_ARTIFACT_SOURCE_MISMATCH", `approved artifact 的 source revision 不一致: ${selection.plugin_id}`, ".workflow/plugin-selection.yaml"));
      }
    }
  }


  const sourceManifest = await parseProjection(
    projectRoot,
    sourcesFactsProjectionFiles.sourceManifest,
    sourceManifestSchema,
    "SOURCE_MANIFEST_INVALID",
    diagnostics,
    sourceRevisions,
  );
  const factRegister = await parseProjection(
    projectRoot,
    sourcesFactsProjectionFiles.factRegister,
    factRegisterSchema,
    "FACT_REGISTER_INVALID",
    diagnostics,
    sourceRevisions,
  );
  const conflictRegister = await parseProjection(
    projectRoot,
    sourcesFactsProjectionFiles.conflictRegister,
    conflictRegisterSchema,
    "CONFLICT_REGISTER_INVALID",
    diagnostics,
    sourceRevisions,
  );
  for (const journalPath of sourcesFactsJournalFiles) {
    await validateJournal(projectRoot, journalPath, diagnostics);
  }

  for (const characterManifest of manifest.characters) {
    const root = `characters/${characterManifest.id}`;
    const document = await parseAuthorFile(
      projectRoot,
      `${root}/character.yaml`,
      characterDocumentSchema,
      "CHARACTER_DOCUMENT_INVALID",
      diagnostics,
      sourceRevisions,
    );
    const usesLegacyZhujiLayout = characterManifest.mode === "zhuji"
      && await pathExists(await resolveWithin(projectRoot, `${root}/zhuji/04-expanded-extension.yaml`))
      && !await pathExists(await resolveWithin(projectRoot, `${root}/zhuji/05-trait-dialogue.yaml`));
    const moduleFiles = characterManifest.mode === "zhuji"
      ? usesLegacyZhujiLayout ? legacyZhujiModuleFiles : zhujiModuleFiles
      : paletteModuleFiles;
    const modules: Array<ZhujiModule | PaletteModule> = [];
    for (const expected of moduleFiles) {
      const relativePath = `${root}/${characterManifest.mode}/${expected.file}`;
      const module: ZhujiModule | PaletteModule | undefined =
        characterManifest.mode === "zhuji"
          ? await parseAuthorFile(
              projectRoot,
              relativePath,
              zhujiModuleSchema,
              "CHARACTER_MODULE_INVALID",
              diagnostics,
              sourceRevisions,
            )
          : await parseAuthorFile(
              projectRoot,
              relativePath,
              paletteModuleSchema,
              "CHARACTER_MODULE_INVALID",
              diagnostics,
              sourceRevisions,
            );
      if (module && module.module !== expected.kind) {
        diagnostics.push(
          diagnostic(
            "CHARACTER_MODULE_KIND_MISMATCH",
            `${relativePath} 應為 ${expected.kind}，實際為 ${module.module}`,
            relativePath,
            ["module"],
          ),
        );
      }
      if (module) modules.push(module);
    }
    const oppositeMode = characterManifest.mode === "zhuji" ? "palette" : "zhuji";
    const hasModeHistory = await pathExists(await resolveWithin(projectRoot, `${root}/mode-history`));
    if (!hasModeHistory && await pathExists(await resolveWithin(projectRoot, `${root}/${oppositeMode}`))) {
      diagnostics.push(
        diagnostic(
          "CHARACTER_MODE_MIXED",
          `角色 ${characterManifest.id} 同時存在 ${characterManifest.mode} 與 ${oppositeMode} 目錄`,
          root,
        ),
      );
    }
    if (document) {
      if (document.id !== characterManifest.id) {
        diagnostics.push(
          diagnostic(
            "CHARACTER_ID_MISMATCH",
            `character.yaml 的 ${document.id} 與 manifest 的 ${characterManifest.id} 不一致`,
            `${root}/character.yaml`,
            ["id"],
          ),
        );
      }
      if (document.display_name !== characterManifest.display_name) {
        diagnostics.push(
          diagnostic(
            "CHARACTER_NAME_MISMATCH",
            `character.yaml 顯示名稱與 manifest 不一致`,
            `${root}/character.yaml`,
            ["display_name"],
          ),
        );
      }
      characters.push({ manifest: characterManifest, document, modules });
    }
  }

  const greetings = manifest.kind === "character_card"
    ? await parseAuthorFile(
        projectRoot,
        "greetings.yaml",
        greetingsDocumentSchema,
        "GREETINGS_DOCUMENT_INVALID",
        diagnostics,
        sourceRevisions,
      )
    : undefined;

  const relationships = blueprint?.relationships.enabled
    ? await parseAuthorFile(
        projectRoot,
        "relationships.yaml",
        relationshipsDocumentSchema,
        "RELATIONSHIPS_DOCUMENT_INVALID",
        diagnostics,
        sourceRevisions,
      )
    : undefined;

  if (blueprint?.relationships.enabled) {
    if (manifest.kind !== "character_card") {
      diagnostics.push(diagnostic("RELATIONSHIPS_PROJECT_KIND_INVALID", "只有角色卡專案可啟用角色關係", "blueprint.yaml", ["relationships"]));
    }
    const manifestIds = new Set(manifest.characters.map((character) => character.id));
    blueprint.relationships.character_ids.forEach((characterId, index) => {
      if (!manifestIds.has(characterId)) {
        diagnostics.push(diagnostic("RELATIONSHIPS_CHARACTER_MISSING", `關係設定引用 manifest 中不存在的角色：${characterId}`, "blueprint.yaml", ["relationships", "character_ids", index]));
      }
    });
    if (relationships && (
      relationships.character_ids.length !== blueprint.relationships.character_ids.length
      || relationships.character_ids.some((characterId, index) => characterId !== blueprint.relationships.character_ids[index])
    )) {
      diagnostics.push(diagnostic("RELATIONSHIPS_PARTICIPANTS_MISMATCH", "relationships.yaml 的參與角色必須與 Blueprint 完全一致", "relationships.yaml", ["character_ids"]));
    }
  }

  const worldRoot = await resolveWithin(projectRoot, "world");
  if (await pathExists(worldRoot)) {
    const scan = await scanStructuredFiles(worldRoot);
    diagnostics.push(...scan.diagnostics);
    for (const file of scan.files) {
      const relativeToWorld = path.relative(worldRoot, file.filePath).replaceAll("\\", "/");
      const projectRelative = `world/${relativeToWorld}`;
      if (!/\.ya?ml$/iu.test(relativeToWorld)) {
        diagnostics.push(diagnostic("WORLD_FILE_FORMAT_INVALID", "世界設定只接受 YAML", projectRelative));
        continue;
      }
      if (file.data === undefined) continue;
      sourceRevisions[projectRelative] = computeTextRevision(file.raw);
      const parsed = validateSchema(worldEntrySchema, file.data, {
        file: projectRelative,
        code: "WORLD_ENTRY_INVALID",
      });
      diagnostics.push(...parsed.diagnostics);
      if (!parsed.ok) continue;
      const directoryCategory = relativeToWorld.split("/")[0];
      if (!worldCategorySchema.safeParse(directoryCategory).success || parsed.data.category !== directoryCategory) {
        diagnostics.push(
          diagnostic(
            "WORLD_CATEGORY_MISMATCH",
            `${projectRelative} 的 category ${parsed.data.category} 與目錄 ${directoryCategory} 不一致`,
            projectRelative,
            ["category"],
          ),
        );
      }
      world.push(parsed.data);
    }
  }

  const characterIds = new Set(manifest.characters.map((character) => character.id));
  const worldIds = new Set<string>();
  world.forEach((entry, index) => {
    if (worldIds.has(entry.id)) {
      diagnostics.push(diagnostic("WORLD_ID_DUPLICATE", `世界設定 ID 重複：${entry.id}`, "world", [index, "id"]));
    }
    worldIds.add(entry.id);
  });
  for (const character of characters) {
    character.document.relationships.forEach((relationship, index) => {
      if (!characterIds.has(relationship.target_id)) {
        diagnostics.push(
          diagnostic(
            "CHARACTER_REFERENCE_MISSING",
            `找不到關係角色：${relationship.target_id}`,
            `characters/${character.manifest.id}/character.yaml`,
            ["relationships", index, "target_id"],
          ),
        );
      }
    });
  }
  greetings?.greetings.forEach((greeting, greetingIndex) => {
    greeting.character_ids.forEach((characterId, characterIndex) => {
      if (!characterIds.has(characterId)) {
        diagnostics.push(
          diagnostic(
            "GREETING_CHARACTER_MISSING",
            `Greeting ${greeting.id} 引用不存在的角色：${characterId}`,
            "greetings.yaml",
            ["greetings", greetingIndex, "character_ids", characterIndex],
          ),
        );
      }
    });
  });
  world.forEach((entry, entryIndex) => {
    entry.related_ids.forEach((relatedId, relatedIndex) => {
      if (!worldIds.has(relatedId) && !characterIds.has(relatedId)) {
        diagnostics.push(
          diagnostic(
            "WORLD_REFERENCE_MISSING",
            `世界設定 ${entry.id} 引用不存在的 ID：${relatedId}`,
            "world",
            [entryIndex, "related_ids", relatedIndex],
          ),
        );
      }
    });
  });

  const finalDiagnostics = uniqueDiagnostics(diagnostics).sort((left, right) =>
    JSON.stringify([left.location?.file, left.location?.path, left.code]).localeCompare(
      JSON.stringify([right.location?.file, right.location?.path, right.code]),
    ),
  );
  return {
    ok: !finalDiagnostics.some((item) => item.severity === "error"),
    projectRoot,
    manifest,
    workflow,
    ...(blueprint ? { blueprint } : {}),
    characters,
    ...(greetings ? { greetings } : {}),
    ...(relationships ? { relationships } : {}),
    world,
    ...(sourceManifest ? { sourceManifest } : {}),
    ...(factRegister ? { factRegister } : {}),
    ...(conflictRegister ? { conflictRegister } : {}),
    sourceRevisions,
    pluginSources,
    ...(pluginSelection ? { pluginSelection } : {}),
    ...(pluginSelectionRevision ? { pluginSelectionRevision } : {}),
    pluginArtifacts,
    diagnostics: finalDiagnostics,
  };
}
