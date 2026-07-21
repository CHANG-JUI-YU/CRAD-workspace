import { readFile, readdir, stat } from "node:fs/promises";

import {
  chunkSchema,
  chunkSetManifestSchema,
  journalEventEnvelopeSchema,
  sourceManifestSchema,
  sourceRecordSchema,
  type Chunk,
  type ChunkSetManifest,
  type Revision,
} from "@card-workspace/schemas";
import {
  assertIngestionProjectPath,
  assertSafeSegment,
  canonicalJson,
  canonicalYaml,
  computeRevision,
  computeTextRevision,
  resolveExistingWithin,
  resolveWithin,
  runFileTransaction,
} from "@card-workspace/project";

import { createChunkSet, type ChunkSetArtifacts } from "./chunker.js";
import { appendCanonicalEvent, createSourceEvent, eventSemanticRevision } from "./events.js";
import {
  getSourceRevision,
  getTextProjection,
  readSourceManifest,
  SOURCE_JOURNAL_PATH,
  SOURCE_MANIFEST_PATH,
} from "./source-manifest.js";
import { revisionDigest, verifyExistingImmutable } from "./snapshot-store.js";
import { IngestionError } from "./types.js";

export interface StoreChunkSetOptions {
  projectRoot: string;
  artifacts: ChunkSetArtifacts;
  actor?: string;
  timestamp?: string;
  beforePublish?: (index: number) => void | Promise<void>;
}

export interface StoreChunkSetResult extends ChunkSetArtifacts {
  idempotent: boolean;
  eventId?: string;
}

function rootPath(sourceId: string, revisionId: Revision, chunkSetId: string): string {
  const safeSourceId = assertSafeSegment(sourceId);
  const safeSetId = assertSafeSegment(chunkSetId);
  return `sources/chunks/${safeSourceId}/${revisionDigest(revisionId)}/${safeSetId}`;
}

function manifestPath(sourceId: string, revisionId: Revision, chunkSetId: string): string {
  return assertIngestionProjectPath(`${rootPath(sourceId, revisionId, chunkSetId)}/manifest.json`).relativePath;
}

function chunkPath(manifest: ChunkSetManifest, chunkId: string): string {
  const safeChunkId = assertSafeSegment(chunkId);
  return assertIngestionProjectPath(
    `${rootPath(manifest.source_id, manifest.source_revision_id, manifest.id)}/${safeChunkId}.json`,
  ).relativePath;
}

async function fileExists(projectRoot: string, relativePath: string): Promise<boolean> {
  try {
    await stat(await resolveWithin(projectRoot, relativePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertArtifactsEqual(actual: ChunkSetArtifacts, expected: ChunkSetArtifacts): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new IngestionError("CHUNK_SET_CONTENT_MISMATCH", "chunk set artifacts 與 deterministic 重算結果不符");
  }
}

export async function getChunkSet(
  projectRoot: string,
  sourceId: string,
  revisionId: Revision,
  chunkSetId: string,
): Promise<ChunkSetArtifacts> {
  const relativeManifestPath = manifestPath(sourceId, revisionId, chunkSetId);
  let manifest: ChunkSetManifest;
  try {
    manifest = chunkSetManifestSchema.parse(
      JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativeManifestPath), "utf8")),
    );
  } catch (error) {
    throw new IngestionError("CHUNK_SET_NOT_FOUND", `無法讀取 chunk set：${chunkSetId}`, error);
  }
  if (manifest.id !== chunkSetId || manifest.source_id !== sourceId || manifest.source_revision_id !== revisionId) {
    throw new IngestionError("CHUNK_SET_IDENTITY_MISMATCH", `chunk set 身份不符：${chunkSetId}`);
  }
  const chunks: Chunk[] = [];
  for (const [sequence, chunkId] of manifest.chunk_ids.entries()) {
    try {
      const chunk = chunkSchema.parse(
        JSON.parse(await readFile(await resolveExistingWithin(projectRoot, chunkPath(manifest, chunkId)), "utf8")),
      );
      if (
        chunk.id !== chunkId
        || chunk.sequence !== sequence
        || chunk.source_id !== sourceId
        || chunk.source_revision_id !== revisionId
        || chunk.chunk_set_id !== chunkSetId
      ) {
        throw new IngestionError("CHUNK_IDENTITY_MISMATCH", `chunk 身份不符：${chunkId}`);
      }
      chunks.push(chunk);
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      throw new IngestionError("CHUNK_INVALID", `無法讀取合法 chunk：${chunkId}`, error);
    }
  }
  return { manifest, chunks };
}

export async function verifyChunkSet(
  projectRoot: string,
  sourceId: string,
  revisionId: Revision,
  chunkSetId: string,
): Promise<ChunkSetArtifacts> {
  const actual = await getChunkSet(projectRoot, sourceId, revisionId, chunkSetId);
  const projection = await getTextProjection(projectRoot, sourceId, revisionId);
  const expected = createChunkSet({ projection, profile: actual.manifest.profile });
  assertArtifactsEqual(actual, expected);
  return actual;
}

export async function verifyStoredChunkSet(
  projectRoot: string,
  sourceId: string,
  revisionId: Revision,
  chunkSetId: string,
): Promise<ChunkSetArtifacts> {
  const actual = await getChunkSet(projectRoot, sourceId, revisionId, chunkSetId);
  const projection = await getTextProjection(projectRoot, sourceId, revisionId);
  const expectedSetId = `chunk-set-${computeRevision({
    source_revision_id: projection.source_revision_id,
    normalized_hash: projection.normalized_hash,
    normalizer_id: projection.normalizer_id,
    normalizer_version: projection.normalizer_version,
    profile: actual.manifest.profile,
  }).slice("sha256:".length)}`;
  if (actual.manifest.id !== expectedSetId || actual.manifest.normalized_hash !== projection.normalized_hash) {
    throw new IngestionError("CHUNK_SET_CONTENT_MISMATCH", "chunk set manifest 與 source projection 不符");
  }
  let mainEnd = 0;
  for (const chunk of actual.chunks) {
    const contentHash = computeTextRevision(chunk.content);
    const expectedChunkId = `chunk-${computeRevision({
      source_revision_id: revisionId,
      chunk_set_id: chunkSetId,
      normalized_character_range: chunk.normalized_character_range,
      main_range: chunk.main_range,
      content_hash: contentHash,
    }).slice("sha256:".length)}`;
    if (chunk.content_hash !== contentHash || chunk.id !== expectedChunkId
      || chunk.main_range[0] !== mainEnd
      || projection.text.slice(...chunk.normalized_character_range) !== chunk.content) {
      throw new IngestionError("CHUNK_SET_CONTENT_MISMATCH", `chunk 與 source projection 不符：${chunk.id}`);
    }
    mainEnd = chunk.main_range[1];
  }
  if (mainEnd !== projection.text.length) {
    throw new IngestionError("CHUNK_SET_CONTENT_MISMATCH", "chunk set coverage 不符");
  }
  return actual;
}

export async function listChunkSets(
  projectRoot: string,
  sourceId: string,
  revisionId?: Revision,
): Promise<ChunkSetManifest[]> {
  const revision = await getSourceRevision(projectRoot, sourceId, revisionId);
  const relativeRoot = `sources/chunks/${assertSafeSegment(sourceId)}/${revisionDigest(revision.id)}`;
  let entries;
  try {
    entries = await readdir(await resolveExistingWithin(projectRoot, relativeRoot), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new IngestionError("CHUNK_SET_LIST_FAILED", `無法列出 chunk sets：${sourceId}`, error);
  }
  const manifests: ChunkSetManifest[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    if (!entry.isDirectory()) continue;
    const setId = assertSafeSegment(entry.name);
    manifests.push((await getChunkSet(projectRoot, sourceId, revision.id, setId)).manifest);
  }
  return manifests;
}

export async function storeChunkSet(options: StoreChunkSetOptions): Promise<StoreChunkSetResult> {
  const manifest = chunkSetManifestSchema.parse(options.artifacts.manifest);
  const projection = await getTextProjection(options.projectRoot, manifest.source_id, manifest.source_revision_id);
  const expected = createChunkSet({ projection, profile: manifest.profile });
  assertArtifactsEqual(options.artifacts, expected);
  const relativeManifestPath = manifestPath(manifest.source_id, manifest.source_revision_id, manifest.id);
  if (await fileExists(options.projectRoot, relativeManifestPath)) {
    const existing = await verifyStoredChunkSet(
      options.projectRoot,
      manifest.source_id,
      manifest.source_revision_id,
      manifest.id,
    );
    assertArtifactsEqual(existing, expected);
    return { ...existing, idempotent: true };
  }

  const manifestText = await readFile(
    await resolveExistingWithin(options.projectRoot, SOURCE_MANIFEST_PATH),
    "utf8",
  );
  const journalText = await readFile(
    await resolveExistingWithin(options.projectRoot, SOURCE_JOURNAL_PATH),
    "utf8",
  );
  const sourceManifest = await readSourceManifest(options.projectRoot);
  const source = sourceManifest.sources.find((candidate) => candidate.id === manifest.source_id);
  if (!source || !source.revision_ids.includes(manifest.source_revision_id)) {
    throw new IngestionError("SOURCE_REVISION_NOT_FOUND", "chunk set 的 source revision 不存在");
  }
  const nextSource = sourceRecordSchema.parse({
    ...source,
    current_chunk_set: {
      source_revision_id: manifest.source_revision_id,
      chunk_set_id: manifest.id,
    },
  });
  const sources = sourceManifest.sources.map((candidate) => candidate.id === source.id ? nextSource : candidate);
  const manifestState = { schema_version: 1 as const, sources, extensions: sourceManifest.extensions };
  const nextManifest = sourceManifestSchema.parse({
    ...manifestState,
    revision: computeRevision(manifestState),
  });
  const journalEvents = journalText.trim().length === 0
    ? []
    : journalText.trimEnd().split("\n").map((line) => journalEventEnvelopeSchema.parse(JSON.parse(line)));
  const priorEvent = [...journalEvents].reverse().find((candidate) => candidate.aggregate_id === source.id);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const event = createSourceEvent({
    kind: "source.chunk_set_created",
    sourceId: source.id,
    ...(priorEvent ? { priorRevision: eventSemanticRevision(priorEvent) } : {}),
    actor: assertSafeSegment(options.actor ?? "system"),
    timestamp,
    sequence: journalEvents.length + 1,
    payload: {
      source_id: source.id,
      source_revision_id: manifest.source_revision_id,
      chunk_set_id: manifest.id,
      chunk_set_path: relativeManifestPath,
      chunk_set_hash: computeRevision(expected),
    },
  });
  const immutableOperations = [
    { relativePath: relativeManifestPath, content: canonicalJson(manifest), expectedAbsent: true },
    ...expected.chunks.map((chunk) => ({
      relativePath: chunkPath(manifest, chunk.id),
      content: canonicalJson(chunk),
      expectedAbsent: true,
    })),
  ];
  for (const operation of immutableOperations) {
    await verifyExistingImmutable(
      options.projectRoot,
      operation.relativePath,
      Buffer.from(operation.content, "utf8"),
    );
  }
  await runFileTransaction({
    root: options.projectRoot,
    operations: [
      ...immutableOperations,
      {
        relativePath: SOURCE_MANIFEST_PATH,
        content: canonicalYaml(nextManifest),
        expectedRawRevision: computeTextRevision(manifestText),
      },
      {
        relativePath: SOURCE_JOURNAL_PATH,
        content: appendCanonicalEvent(journalText, event),
        expectedRawRevision: computeTextRevision(journalText),
      },
    ],
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
  });
  return { ...expected, idempotent: false, eventId: event.id };
}
