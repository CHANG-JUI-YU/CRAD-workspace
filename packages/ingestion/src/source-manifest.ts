import { readFile } from "node:fs/promises";

import {
  extractedTextProjectionSchema,
  sourceManifestSchema,
  sourceRevisionSchema,
  type Revision,
  type SourceManifest,
  type SourceRecord,
  type SourceRevision,
  type ExtractedTextProjection,
} from "@card-workspace/schemas";
import {
  assertIngestionProjectPath,
  assertSafeSegment,
  computeRevision,
  computeTextRevision,
  resolveExistingWithin,
} from "@card-workspace/project";
import { parse as parseYaml } from "yaml";

import { revisionDigest, verifySnapshot } from "./snapshot-store.js";
import { IngestionError } from "./types.js";

export const SOURCE_MANIFEST_PATH = "sources/manifest.yaml";
export const SOURCE_JOURNAL_PATH = "sources/journals/source-events.jsonl";

export async function readSourceManifest(projectRoot: string): Promise<SourceManifest> {
  try {
    const filePath = await resolveExistingWithin(projectRoot, SOURCE_MANIFEST_PATH);
    return sourceManifestSchema.parse(parseYaml(await readFile(filePath, "utf8")));
  } catch (error) {
    throw new IngestionError("SOURCE_MANIFEST_INVALID", "無法讀取合法的 source manifest", error);
  }
}

export async function listSources(projectRoot: string): Promise<SourceRecord[]> {
  return (await readSourceManifest(projectRoot)).sources;
}

export async function getSourceRevision(
  projectRoot: string,
  sourceId: string,
  revisionId?: Revision,
): Promise<SourceRevision> {
  const safeSourceId = assertSafeSegment(sourceId);
  const manifest = await readSourceManifest(projectRoot);
  const source = manifest.sources.find((candidate) => candidate.id === safeSourceId);
  if (!source) throw new IngestionError("SOURCE_NOT_FOUND", `找不到 source：${safeSourceId}`);
  const selected = revisionId ?? source.current_revision_id;
  if (!selected || !source.revision_ids.includes(selected)) {
    throw new IngestionError("SOURCE_REVISION_NOT_FOUND", `找不到 source revision：${selected ?? "current"}`);
  }
  const relativePath = assertIngestionProjectPath(
    `sources/revisions/${safeSourceId}/${revisionDigest(selected)}.json`,
  ).relativePath;
  let revision: SourceRevision;
  try {
    revision = sourceRevisionSchema.parse(
      JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8")),
    );
  } catch (error) {
    throw new IngestionError("SOURCE_REVISION_INVALID", `無法讀取合法 revision：${selected}`, error);
  }
  if (revision.source_id !== safeSourceId || revision.id !== selected) {
    throw new IngestionError("SOURCE_REVISION_MISMATCH", `revision 身份不符：${selected}`);
  }
  await verifySnapshot(projectRoot, revision.snapshot.path, revision.raw_hash);
  return revision;
}

export async function getTextProjection(
  projectRoot: string,
  sourceId: string,
  revisionId?: Revision,
): Promise<ExtractedTextProjection> {
  const revision = await getSourceRevision(projectRoot, sourceId, revisionId);
  const relativePath = assertIngestionProjectPath(
    `sources/projections/${revision.source_id}/${revisionDigest(revision.id)}.json`,
  ).relativePath;
  try {
    const projection = extractedTextProjectionSchema.parse(
      JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8")),
    );
    if (projection.source_id !== revision.source_id || projection.source_revision_id !== revision.id) {
      throw new IngestionError("SOURCE_PROJECTION_MISMATCH", `projection 身份不符：${revision.id}`);
    }
    if (
      projection.normalized_hash !== revision.normalized_hash
      || computeTextRevision(projection.text) !== projection.normalized_hash
    ) {
      throw new IngestionError("SOURCE_PROJECTION_HASH_MISMATCH", `projection normalized hash 不符：${revision.id}`);
    }
    if (revision.projection_hash && computeRevision(projection) !== revision.projection_hash) {
      throw new IngestionError(
        "SOURCE_PROJECTION_ARTIFACT_HASH_MISMATCH",
        `projection artifact hash 不符：${revision.id}`,
      );
    }
    return projection;
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("SOURCE_PROJECTION_INVALID", `無法讀取合法 projection：${revision.id}`, error);
  }
}
