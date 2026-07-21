import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  extractedTextProjectionSchema,
  journalEventEnvelopeSchema,
  sourceManifestSchema,
  sourceRecordSchema,
  sourceRevisionSchema,
  stableIdSchema,
  type ExtractedTextProjection,
  type JsonObject,
  type Revision,
  type SourceRecord,
  type SourceRevision,
  type SourceTier,
} from "@card-workspace/schemas";
import {
  assertIngestionProjectPath,
  canonicalJson,
  canonicalYaml,
  computeRevision,
  computeTextRevision,
  ProjectError,
  resolveExistingWithin,
  runFileTransaction,
} from "@card-workspace/project";

import { extractSource } from "./adapters/index.js";
import { appendCanonicalEvent, createSourceRevisionEvent, eventSemanticRevision } from "./events.js";
import {
  normalizedRangeToLineRange,
  normalizedRangeToSourceByteRange,
  sourceCharacterRangeToNormalizedRange,
} from "./line-map.js";
import { NORMALIZER_ID, NORMALIZER_VERSION, normalizeText } from "./normalize-text.js";
import {
  getSourceRevision,
  readSourceManifest,
  SOURCE_JOURNAL_PATH,
  SOURCE_MANIFEST_PATH,
} from "./source-manifest.js";
import {
  controlledSnapshotExtension,
  revisionDigest,
  snapshotPath,
  sourceRevision,
  verifyExistingImmutable,
} from "./snapshot-store.js";
import {
  IngestionError,
  MAX_SOURCE_BYTES,
  SourceAdapterError,
  type SourceFormatHint,
  type SourceMetadata,
} from "./types.js";

interface IntakeCommonOptions {
  projectRoot: string;
  sourceId: string;
  title: string;
  tier?: SourceTier;
  actor?: string;
  author?: string;
  language?: string;
  mediaType?: string;
  extension?: string;
  format?: SourceFormatHint;
  acquiredAt?: string;
  extensions?: JsonObject;
  beforePublish?: (index: number) => void | Promise<void>;
}

export interface IntakeLocalSourceOptions extends IntakeCommonOptions {
  filePath: string;
}

export interface IntakeRetrievedSourceOptions extends IntakeCommonOptions {
  bytes: Buffer;
  requestedUrl: string;
  canonicalUrl: string;
  fetchedAt: string;
}

export interface IntakeSourceResult {
  source: SourceRecord;
  revision: SourceRevision;
  projection: ExtractedTextProjection;
  idempotent: boolean;
  eventId?: string;
}

interface IntakeBytesOptions extends IntakeCommonOptions {
  bytes: Buffer;
  origin: {
    kind: "local" | "retrieved";
    uri: string;
    requested_url?: string;
    canonical_url?: string;
    fetched_at?: string;
  };
  fileName?: string;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new IngestionError(code, message, cause);
}

function validateIdentity(value: string, label: string): string {
  const parsed = stableIdSchema.safeParse(value);
  if (!parsed.success) fail(`${label.toUpperCase()}_INVALID`, `無效的 ${label}：${value}`);
  return parsed.data;
}

function validateTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value)) || !/[zZ]|[+-]\d\d:\d\d$/u.test(value)) {
    fail("SOURCE_TIMESTAMP_INVALID", `${label} 必須是含時區的 ISO timestamp`);
  }
  return value;
}

function pointerSegments(pointer: string): Array<string | number> {
  if (!pointer.startsWith("/")) return [pointer];
  return pointer.slice(1).split("/").map((segment) => {
    const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    return /^(?:0|[1-9]\d*)$/u.test(decoded) ? Number(decoded) : decoded;
  });
}

function mediaTypeFor(extension: string, format: string): string {
  const byExtension: Record<string, string> = {
    chat: "text/plain",
    json: "application/json",
    md: "text/markdown",
    png: "image/png",
    txt: "text/plain",
    yaml: "application/yaml",
    yml: "application/yaml",
  };
  return byExtension[extension] ?? (format === "text" ? "text/plain" : "application/octet-stream");
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

async function readProjectText(projectRoot: string, relativePath: string): Promise<string> {
  try {
    return await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8");
  } catch (error) {
    fail("SOURCE_PROJECT_STATE_INVALID", `無法讀取專案檔案：${relativePath}`, error);
  }
}

async function readProjection(
  projectRoot: string,
  sourceId: string,
  revisionId: Revision,
): Promise<ExtractedTextProjection> {
  const relativePath = `sources/projections/${sourceId}/${revisionDigest(revisionId)}.json`;
  try {
    const projection = extractedTextProjectionSchema.parse(
      JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8")),
    );
    if (projection.source_id !== sourceId || projection.source_revision_id !== revisionId) {
      fail("SOURCE_PROJECTION_MISMATCH", `projection 身份不符：${revisionId}`);
    }
    if (sourceRevision(Buffer.from(projection.text, "utf8")) !== projection.normalized_hash) {
      fail("SOURCE_PROJECTION_HASH_MISMATCH", `projection hash 不符：${revisionId}`);
    }
    return projection;
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    fail("SOURCE_PROJECTION_INVALID", `無法讀取合法 projection：${revisionId}`, error);
  }
}

async function intakeBytes(options: IntakeBytesOptions): Promise<IntakeSourceResult> {
  const sourceId = validateIdentity(options.sourceId, "source_id");
  const actor = validateIdentity(options.actor ?? "system", "actor");
  if (options.title.length === 0) fail("SOURCE_TITLE_INVALID", "source title 不得為空");
  if (options.bytes.length > MAX_SOURCE_BYTES) {
    fail("SOURCE_TOO_LARGE", `來源超過 ${MAX_SOURCE_BYTES} bytes 限制`);
  }

  const rawRevision = sourceRevision(options.bytes);
  const digest = revisionDigest(rawRevision);
  const manifestText = await readProjectText(options.projectRoot, SOURCE_MANIFEST_PATH);
  const journalText = await readProjectText(options.projectRoot, SOURCE_JOURNAL_PATH);
  const manifest = await readSourceManifest(options.projectRoot);
  const existingSource = manifest.sources.find((candidate) => candidate.id === sourceId);
  if (existingSource?.revision_ids.includes(rawRevision)) {
    const revision = await getSourceRevision(options.projectRoot, sourceId, rawRevision);
    const projection = await readProjection(options.projectRoot, sourceId, rawRevision);
    if (revision.projection_hash && computeRevision(projection) !== revision.projection_hash) {
      fail("SOURCE_PROJECTION_ARTIFACT_HASH_MISMATCH", `projection artifact hash 不符：${rawRevision}`);
    }
    return { source: existingSource, revision, projection, idempotent: true };
  }

  const metadata: SourceMetadata = {
    ...(options.fileName ? { fileName: options.fileName } : {}),
    ...(options.extension ? { extension: options.extension } : {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.format ? { format: options.format } : {}),
    title: options.title,
    ...(options.language ? { language: options.language } : {}),
  };
  const extracted = extractSource(options.bytes, metadata);
  const normalized = normalizeText(
    extracted.evidence === "raw" ? options.bytes : Buffer.from(extracted.text, "utf8"),
    extracted.evidence === "raw" ? "raw_snapshot" : "extracted_projection",
  );
  const requestedExtension = options.extension ?? path.extname(options.fileName ?? "");
  const extension = controlledSnapshotExtension(
    isPng(options.bytes) ? ".png" : requestedExtension,
    extracted.format,
  );
  const snapshotRelativePath = snapshotPath(sourceId, rawRevision, extension);
  const revisionRelativePath = assertIngestionProjectPath(
    `sources/revisions/${sourceId}/${digest}.json`,
  ).relativePath;
  const projectionRelativePath = assertIngestionProjectPath(
    `sources/projections/${sourceId}/${digest}.json`,
  ).relativePath;
  const normalizedHash = sourceRevision(Buffer.from(normalized.text, "utf8"));
  const acquiredAt = validateTimestamp(
    options.acquiredAt ?? options.origin.fetched_at ?? new Date().toISOString(),
    "acquiredAt",
  );
  let revision = sourceRevisionSchema.parse({
    schema_version: 1,
    source_id: sourceId,
    id: rawRevision,
    media_type: options.mediaType ?? mediaTypeFor(extension, extracted.format),
    original_extension: `.${extension}`,
    raw_hash: rawRevision,
    normalized_hash: normalizedHash,
    title: options.title,
    ...(options.author ? { author: options.author } : {}),
    ...(options.language ? { language: options.language } : {}),
    acquired_at: acquiredAt,
    tier: options.tier ?? "unknown",
    origin: options.origin,
    snapshot: {
      path: snapshotRelativePath,
      byte_size: options.bytes.length,
      raw_hash: rawRevision,
    },
    adapter_id: extracted.adapter.id,
    adapter_version: extracted.adapter.version,
    normalizer_id: NORMALIZER_ID,
    normalizer_version: NORMALIZER_VERSION,
    extensions: options.extensions ?? {},
  });
  const projection = extractedTextProjectionSchema.parse({
    schema_version: 1,
    id: `projection-${digest}`,
    source_id: sourceId,
    source_revision_id: rawRevision,
    text: normalized.text,
    normalized_hash: normalizedHash,
    adapter_id: extracted.adapter.id,
    adapter_version: extracted.adapter.version,
    normalizer_id: NORMALIZER_ID,
    normalizer_version: NORMALIZER_VERSION,
    line_map: normalized.lineMap,
    mappings: extracted.fieldMappings.map((mapping) => {
      const normalizedRange = sourceCharacterRangeToNormalizedRange(
        normalized.lineMap,
        [mapping.start, mapping.end],
      );
      const rawByteRange = normalizedRangeToSourceByteRange(
        normalized.text,
        normalized.lineMap,
        normalizedRange,
      );
      return {
        evidence_kind: extracted.evidence === "raw" ? "raw_snapshot" as const : "field_projection" as const,
        normalized_character_range: normalizedRange,
        normalized_line_range: normalizedRangeToLineRange(normalized.lineMap, normalizedRange),
        ...(rawByteRange ? { raw_byte_range: rawByteRange } : {}),
        field_path: pointerSegments(mapping.fieldPath),
      };
    }),
    extensions: {
      evidence: extracted.evidence,
      format: extracted.format,
      has_byte_order_mark: extracted.hasByteOrderMark,
      sections: extracted.sections.map((section) => ({
        ...section,
        ...Object.fromEntries([
          ["start", sourceCharacterRangeToNormalizedRange(normalized.lineMap, [section.start, section.end])[0]],
          ["end", sourceCharacterRangeToNormalizedRange(normalized.lineMap, [section.start, section.end])[1]],
        ]),
      })),
    },
  });
  revision = sourceRevisionSchema.parse({
    ...revision,
    projection_hash: computeRevision(projection),
  });
  const nextSource = sourceRecordSchema.parse({
    id: sourceId,
    title: options.title,
    tier: options.tier ?? existingSource?.tier ?? "unknown",
    current_revision_id: rawRevision,
    revision_ids: [...(existingSource?.revision_ids ?? []), rawRevision],
    extensions: existingSource?.extensions ?? {},
  });
  const sources = existingSource
    ? manifest.sources.map((source) => source.id === sourceId ? nextSource : source)
    : [...manifest.sources, nextSource];
  const manifestState = { schema_version: 1 as const, sources, extensions: manifest.extensions };
  const nextManifest = sourceManifestSchema.parse({
    ...manifestState,
    revision: computeRevision(manifestState),
  });

  const journalEvents = journalText.trim().length === 0
    ? []
    : journalText.trimEnd().split("\n").map((line) => journalEventEnvelopeSchema.parse(JSON.parse(line)));
  const priorEvent = [...journalEvents].reverse().find((candidate) => candidate.aggregate_id === sourceId);
  if (existingSource && !priorEvent) {
    fail("SOURCE_EVENT_CHAIN_MISSING", `source 缺少既有 event chain：${sourceId}`);
  }
  const priorRevision = priorEvent ? eventSemanticRevision(priorEvent) : undefined;
  const event = createSourceRevisionEvent({
    sourceId,
    ...(priorRevision ? { priorRevision } : {}),
    actor,
    timestamp: acquiredAt,
    sequence: journalEvents.length + 1,
    payload: {
      source_id: sourceId,
      source_revision_id: rawRevision,
      source_record_revision: computeRevision(nextSource),
      revision_path: revisionRelativePath,
      snapshot_path: snapshotRelativePath,
      projection_path: projectionRelativePath,
    },
  });
  const operations = [
    { relativePath: snapshotRelativePath, content: options.bytes, expectedAbsent: true },
    { relativePath: revisionRelativePath, content: canonicalJson(revision), expectedAbsent: true },
    { relativePath: projectionRelativePath, content: canonicalJson(projection), expectedAbsent: true },
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
  ];
  for (const operation of operations) assertIngestionProjectPath(operation.relativePath);
  await verifyExistingImmutable(options.projectRoot, snapshotRelativePath, options.bytes);
  await verifyExistingImmutable(
    options.projectRoot,
    revisionRelativePath,
    Buffer.from(canonicalJson(revision), "utf8"),
  );
  await verifyExistingImmutable(
    options.projectRoot,
    projectionRelativePath,
    Buffer.from(canonicalJson(projection), "utf8"),
  );
  await runFileTransaction({
    root: options.projectRoot,
    operations,
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
  });
  return { source: nextSource, revision, projection, idempotent: false, eventId: event.id };
}

async function withStableError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof IngestionError ||
      error instanceof SourceAdapterError ||
      error instanceof ProjectError
    ) {
      throw error;
    }
    throw new IngestionError("SOURCE_INTAKE_FAILED", "source intake 失敗", error);
  }
}

export async function intakeLocalSource(options: IntakeLocalSourceOptions): Promise<IntakeSourceResult> {
  return withStableError(async () => {
    if (!options.filePath || [..."*?[]{}"].some((character) => options.filePath.includes(character))) {
      fail("SOURCE_PATH_NOT_EXPLICIT", "本機來源必須是明確單檔路徑，不接受 glob");
    }
    let before;
    try {
      before = await lstat(options.filePath, { bigint: true });
    } catch (error) {
      fail("SOURCE_FILE_UNREADABLE", `無法讀取本機來源：${options.filePath}`, error);
    }
    if (before.isSymbolicLink()) fail("SOURCE_SYMLINK_DENIED", "本機來源不可為 symlink");
    if (!before.isFile()) fail("SOURCE_NOT_REGULAR_FILE", "本機來源必須是 regular file");
    if (before.size > BigInt(MAX_SOURCE_BYTES)) {
      fail("SOURCE_TOO_LARGE", `來源超過 ${MAX_SOURCE_BYTES} bytes 限制`);
    }
    const bytes = await readFile(options.filePath);
    const after = await lstat(options.filePath, { bigint: true });
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.length) !== after.size
    ) {
      fail("SOURCE_CHANGED_DURING_READ", "本機來源在讀取期間被替換或修改");
    }
    const absolutePath = path.resolve(options.filePath);
    return intakeBytes({
      ...options,
      bytes,
      fileName: path.basename(absolutePath),
      extension: options.extension ?? path.extname(absolutePath),
      origin: { kind: "local", uri: absolutePath },
    });
  });
}

export async function intakeRetrievedSource(
  options: IntakeRetrievedSourceOptions,
): Promise<IntakeSourceResult> {
  return withStableError(async () => {
    let requested: URL;
    let canonical: URL;
    try {
      requested = new URL(options.requestedUrl);
      canonical = new URL(options.canonicalUrl);
    } catch (error) {
      fail("SOURCE_URL_INVALID", "Retrieved source 需要合法 requested/canonical URL", error);
    }
    const fetchedAt = validateTimestamp(options.fetchedAt, "fetchedAt");
    return intakeBytes({
      ...options,
      origin: {
        kind: "retrieved",
        uri: canonical.href,
        requested_url: requested.href,
        canonical_url: canonical.href,
        fetched_at: fetchedAt,
      },
    });
  });
}
