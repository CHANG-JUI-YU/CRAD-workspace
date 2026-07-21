import { lstat, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  officialPluginIdSchema,
  pluginSourceSchema,
  pluginArtifactIdSchema,
  pluginArtifactSchema,
  pluginSelectionProjectionSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
  stableIdSchema,
  type OfficialPluginId,
  type PluginSource,
  type PluginTemplateManifest,
  type PluginTemplatePayload,
  type PluginArtifact,
  type PluginSelectionProjection,
  type Revision,
} from "@card-workspace/schemas";
import { stringify } from "yaml";

import { canonicalJson, computeTextRevision } from "./canonical.js";
import { ProjectError } from "./errors.js";
import { parsePluginDataFile } from "./plugin-data.js";
import { resolveExistingWithin, resolveWithin } from "./path-security.js";
import { runFileTransaction, type TransactionOperation } from "./transaction.js";

export const pluginSourceRoot = "extensions";
export const pluginTemplateRoot = "templates/plugins";
export const pluginSelectionRelativePath = ".workflow/plugin-selection.yaml";
export const pluginArtifactRoot = ".workflow/plugin-artifacts";

export function pluginSourceRelativePath(pluginId: OfficialPluginId): string {
  return `${pluginSourceRoot}/${pluginId}/source.yaml`;
}

export function pluginArtifactRelativePath(artifactId: string): string {
  const parsed = pluginArtifactIdSchema.parse(artifactId);
  return `${pluginArtifactRoot}/${parsed}.json`;
}

export function pluginTemplateRelativePaths(pluginId: OfficialPluginId, templateId: string): {
  directory: string;
  manifest: string;
  payload: string;
} {
  officialPluginIdSchema.parse(pluginId);
  stableIdSchema.parse(templateId);
  const directory = `${pluginTemplateRoot}/${pluginId}/${templateId}/1`;
  return { directory, manifest: `${directory}/manifest.yaml`, payload: `${directory}/payload.yaml` };
}

export interface LoadedPluginSource {
  pluginId: OfficialPluginId;
  source: PluginSource;
  raw: string;
  revision: Revision;
  relativePath: string;
}

async function resolvePluginFile(projectRoot: string, relativePath: string): Promise<string> {
  const filePath = await resolveExistingWithin(projectRoot, relativePath);
  let current = path.resolve(projectRoot);
  let metadata;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new ProjectError("PLUGIN_PATH_LINK_DENIED", `plugin 路徑不得使用 symlink：${relativePath}`);
    }
  }
  if (!metadata?.isFile()) {
    throw new ProjectError("PLUGIN_FILE_TYPE_INVALID", `plugin 路徑不是一般檔案：${relativePath}`);
  }
  return filePath;
}

export async function readPluginSource(projectRoot: string, pluginId: OfficialPluginId): Promise<LoadedPluginSource | undefined> {
  const relativePath = pluginSourceRelativePath(pluginId);
  try {
    const filePath = await resolvePluginFile(projectRoot, relativePath);
    const parsed = await parsePluginDataFile(filePath, "yaml");
    const source = pluginSourceSchema.parse(parsed.data);
    return { pluginId, source, raw: parsed.raw, revision: computeTextRevision(parsed.raw), relativePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listPluginSources(projectRoot: string): Promise<OfficialPluginId[]> {
  const directories = await listPluginSourceDirectories(projectRoot);
  return directories.filter((entry) => officialPluginIdSchema.safeParse(entry).success) as OfficialPluginId[];
}

export async function listPluginSourceDirectories(projectRoot: string): Promise<string[]> {
  const root = await resolveWithin(projectRoot, pluginSourceRoot);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(root, entry.name, "source.yaml");
    try {
      const metadata = await lstat(sourcePath);
      if (metadata.isSymbolicLink()) {
        result.push(entry.name);
        continue;
      }
      if (metadata.isFile()) result.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // An incomplete extension directory is reported by the caller as an orphan.
    }
  }
  return result.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export async function readPluginSelection(projectRoot: string): Promise<{
  projection: PluginSelectionProjection;
  raw: string;
  revision: Revision;
} | undefined> {
  try {
    const filePath = await resolvePluginFile(projectRoot, pluginSelectionRelativePath);
    const parsed = await parsePluginDataFile(filePath, "yaml");
    return {
      projection: pluginSelectionProjectionSchema.parse(parsed.data),
      raw: parsed.raw,
      revision: computeTextRevision(parsed.raw),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export interface LoadedPluginArtifact {
  readonly artifact: PluginArtifact;
  readonly raw: string;
  readonly revision: Revision;
  readonly relativePath: string;
}

export async function listPluginArtifacts(projectRoot: string): Promise<LoadedPluginArtifact[]> {
  const root = await resolveWithin(projectRoot, pluginArtifactRoot);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const artifacts: LoadedPluginArtifact[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".json")) continue;
    const artifactId = entry.name.slice(0, -5);
    if (!pluginArtifactIdSchema.safeParse(artifactId).success) continue;
    const relativePath = `${pluginArtifactRoot}/${entry.name}`;
    const filePath = await resolvePluginFile(projectRoot, relativePath);
    const parsed = await parsePluginDataFile(filePath, "json");
    const envelope = parsed.data as { artifact?: unknown };
    const artifact = pluginArtifactSchema.parse(envelope.artifact ?? envelope);
    artifacts.push({ artifact, raw: parsed.raw, revision: computeTextRevision(parsed.raw), relativePath });
  }
  return artifacts;
}

export async function readPluginTemplate(
  projectRoot: string,
  pluginId: OfficialPluginId,
  templateId: string,
): Promise<{ manifest: PluginTemplateManifest; payload: PluginTemplatePayload; revisions: Record<string, Revision> } | undefined> {
  const paths = pluginTemplateRelativePaths(pluginId, templateId);
  try {
    const [manifestPath, payloadPath] = await Promise.all([
      resolvePluginFile(projectRoot, paths.manifest),
      resolvePluginFile(projectRoot, paths.payload),
    ]);
    const [manifestData, payloadData] = await Promise.all([
      parsePluginDataFile(manifestPath, "yaml"),
      parsePluginDataFile(payloadPath, "yaml"),
    ]);
    const { manifest, payload } = validatePluginTemplatePair(
      pluginId,
      templateId,
      manifestData.data,
      payloadData.data,
    );
    return {
      manifest,
      payload,
      revisions: {
        [paths.manifest]: computeTextRevision(manifestData.raw),
        [paths.payload]: computeTextRevision(payloadData.raw),
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function validatePluginTemplatePair(
  pluginId: OfficialPluginId,
  templateId: string,
  manifest: unknown,
  payload: unknown,
): { manifest: PluginTemplateManifest; payload: PluginTemplatePayload } {
  let parsedManifest: PluginTemplateManifest;
  let parsedPayload: PluginTemplatePayload;
  try {
    parsedManifest = pluginTemplateManifestSchema.parse(manifest);
    parsedPayload = pluginTemplatePayloadSchema.parse(payload);
  } catch (error) {
    throw new ProjectError(
      "PLUGIN_TEMPLATE_SCHEMA_INVALID",
      `plugin template schema 無效：${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (
    parsedManifest.id !== templateId
    || parsedManifest.plugin_id !== pluginId
    || parsedPayload.template_id !== templateId
    || parsedPayload.plugin_id !== pluginId
  ) {
    throw new ProjectError("PLUGIN_TEMPLATE_IDENTITY_MISMATCH", "plugin template manifest/payload identity 不一致");
  }
  const payloadRevision = computeTextRevision(canonicalJson(parsedPayload));
  if (parsedManifest.payload_revision !== payloadRevision) {
    throw new ProjectError(
      "PLUGIN_TEMPLATE_PAYLOAD_REVISION_MISMATCH",
      "plugin template manifest.payload_revision 不符合 canonical payload revision",
    );
  }
  return { manifest: parsedManifest, payload: parsedPayload };
}

export async function listPluginTemplates(
  projectRoot: string,
  pluginId?: OfficialPluginId,
): Promise<Array<{ plugin_id: OfficialPluginId; template_id: string; version: 1 }>> {
  const root = await resolveWithin(projectRoot, pluginTemplateRoot);
  const pluginIds = pluginId ? [pluginId] : await listDirectoryNames(root);
  const result: Array<{ plugin_id: OfficialPluginId; template_id: string; version: 1 }> = [];
  for (const candidate of pluginIds) {
    if (!officialPluginIdSchema.safeParse(candidate).success) continue;
    const pluginRoot = path.join(root, candidate);
    for (const templateId of await listDirectoryNames(pluginRoot)) {
      if (!stableIdSchema.safeParse(templateId).success) continue;
      const versionRoot = path.join(pluginRoot, templateId, "1");
      try {
        if ((await stat(path.join(versionRoot, "manifest.yaml")).catch(() => undefined))?.isFile()) {
          result.push({ plugin_id: candidate as OfficialPluginId, template_id: templateId, version: 1 });
        }
      } catch {
        // Ignore incomplete template directories.
      }
    }
  }
  return result.sort((left, right) => {
    const leftKey = `${left.plugin_id}/${left.template_id}`;
    const rightKey = `${right.plugin_id}/${right.template_id}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

async function listDirectoryNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function pluginSourceOperation(
  pluginId: OfficialPluginId,
  source: PluginSource,
  expectedRawRevision?: Revision,
): TransactionOperation {
  return {
    relativePath: pluginSourceRelativePath(pluginId),
    content: stringify(pluginSourceSchema.parse(source)),
    ...(expectedRawRevision ? { expectedRawRevision } : { expectedAbsent: true }),
  };
}

export async function savePluginSource(
  projectRoot: string,
  pluginId: OfficialPluginId,
  source: PluginSource,
  expectedRawRevision?: Revision,
): Promise<void> {
  await runFileTransaction({ root: projectRoot, operations: [pluginSourceOperation(pluginId, source, expectedRawRevision)] });
}

export function pluginTemplateOperations(
  pluginId: OfficialPluginId,
  templateId: string,
  manifest: PluginTemplateManifest,
  payload: PluginTemplatePayload,
  expectedRevisions?: { manifest?: Revision; payload?: Revision },
): TransactionOperation[] {
  const paths = pluginTemplateRelativePaths(pluginId, templateId);
  const pair = validatePluginTemplatePair(pluginId, templateId, manifest, payload);
  const parsedManifest = pair.manifest;
  const parsedPayload = pair.payload;
  return [
    {
      relativePath: paths.manifest,
      content: stringify(parsedManifest),
      ...(expectedRevisions?.manifest ? { expectedRawRevision: expectedRevisions.manifest } : { expectedAbsent: true }),
    },
    {
      relativePath: paths.payload,
      content: stringify(parsedPayload),
      ...(expectedRevisions?.payload ? { expectedRawRevision: expectedRevisions.payload } : { expectedAbsent: true }),
    },
  ];
}

export async function savePluginTemplate(
  projectRoot: string,
  pluginId: OfficialPluginId,
  templateId: string,
  manifest: PluginTemplateManifest,
  payload: PluginTemplatePayload,
  expectedRevisions?: { manifest?: Revision; payload?: Revision },
): Promise<void> {
  await runFileTransaction({ root: projectRoot, operations: pluginTemplateOperations(pluginId, templateId, manifest, payload, expectedRevisions) });
}

export type PluginTemplateSaveStatus = "created" | "unchanged" | "replaced";

export interface PluginTemplateSaveResult {
  status: PluginTemplateSaveStatus;
  revisions: Record<string, Revision>;
}

export async function savePluginTemplateIdempotent(
  projectRoot: string,
  pluginId: OfficialPluginId,
  templateId: string,
  manifest: PluginTemplateManifest,
  payload: PluginTemplatePayload,
  expectedRevisions?: { manifest: Revision; payload: Revision },
): Promise<PluginTemplateSaveResult> {
  const pair = validatePluginTemplatePair(pluginId, templateId, manifest, payload);
  const existing = await readPluginTemplate(projectRoot, pluginId, templateId);
  if (existing) {
    const currentManifestRevision = existing.revisions[pluginTemplateRelativePaths(pluginId, templateId).manifest];
    const currentPayloadRevision = existing.revisions[pluginTemplateRelativePaths(pluginId, templateId).payload];
    if (expectedRevisions && (
      currentManifestRevision !== expectedRevisions.manifest
      || currentPayloadRevision !== expectedRevisions.payload
    )) {
      throw new ProjectError("PLUGIN_TEMPLATE_REVISION_CONFLICT", "plugin template raw revision 已變更");
    }
    if (
      canonicalJson(existing.manifest) === canonicalJson(pair.manifest)
      && canonicalJson(existing.payload) === canonicalJson(pair.payload)
    ) {
      return { status: "unchanged", revisions: existing.revisions };
    }
    if (!expectedRevisions) {
      throw new ProjectError(
        "PLUGIN_TEMPLATE_CONFLICT",
        "既有 plugin template 內容不同；覆寫必須提供 manifest 與 payload raw revision",
      );
    }
    await savePluginTemplate(projectRoot, pluginId, templateId, pair.manifest, pair.payload, expectedRevisions);
    const saved = await readPluginTemplate(projectRoot, pluginId, templateId);
    if (!saved) throw new ProjectError("PLUGIN_TEMPLATE_SAVE_FAILED", "plugin template 寫入後無法重新讀取");
    return { status: "replaced", revisions: saved.revisions };
  }
  if (expectedRevisions) {
    throw new ProjectError("PLUGIN_TEMPLATE_REVISION_CONFLICT", "plugin template 尚不存在，不能使用既有 raw revision 覆寫");
  }
  await savePluginTemplate(projectRoot, pluginId, templateId, pair.manifest, pair.payload);
  const saved = await readPluginTemplate(projectRoot, pluginId, templateId);
  if (!saved) throw new ProjectError("PLUGIN_TEMPLATE_SAVE_FAILED", "plugin template 寫入後無法重新讀取");
  return { status: "created", revisions: saved.revisions };
}

export async function ensurePluginStorage(projectRoot: string): Promise<void> {
  await mkdir(await resolveWithin(projectRoot, pluginSourceRoot), { recursive: true });
  await mkdir(await resolveWithin(projectRoot, pluginTemplateRoot), { recursive: true });
}
