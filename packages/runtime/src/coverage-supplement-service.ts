import {
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  type ProjectRepository,
  type ProjectState,
  type SourceCandidate,
  type SourceEvidenceComponent,
  type SourceRecord,
  type UrlIngestionRecord,
  type UrlIngestionTransition,
  type KnowledgeChunk,
} from "@st-workspace/core";
import {
  createUserSupplementSource,
  chunkSource,
  KNOWLEDGE_EXTRACTOR_REVISION,
  type SourceFetcher,
} from "@st-workspace/domain";

export type UrlIngestionStatus = UrlIngestionRecord["status"];

export interface UrlIngestionProjection {
  url: string;
  requested_url?: string;
  status: UrlIngestionStatus;
  canonical_url?: string;
  final_url?: string;
  title?: string;
  media_type?: string;
  content_size?: number;
  error_code?: string;
  error_message?: string;
  next_actions?: Array<"retry" | "change_url">;
  source_id?: string;
}

export interface UrlIngestionLifecycleContext {
  operation_id: string;
  requested_url: string;
  retry_of?: string;
  route: "coverage_supplement" | "coverage_research_recover";
  task_id?: string;
  context?: UrlIngestionRecord["context"];
}

export interface UrlIngestionLifecycle {
  readonly id: string;
  readonly state: ProjectState;
  transition(status: UrlIngestionStatus, patch?: UrlIngestionTransitionPatch): Promise<ProjectState>;
}

export type UrlIngestionTransitionPatch = Omit<Partial<UrlIngestionTransition>, "id" | "sequence" | "operation_id" | "status" | "occurred_at">;

function transitionFor(
  record: UrlIngestionRecord,
  status: UrlIngestionStatus,
  operationId: string,
  patch: UrlIngestionTransitionPatch = {},
): UrlIngestionTransition {
  return {
    id: internalId("url_transition"),
    sequence: record.transitions?.length ?? 0,
    operation_id: operationId,
    status,
    occurred_at: new Date().toISOString(),
    requested_url: record.requested_url ?? record.url,
    ...patch,
  };
}

/** Append a lifecycle event without discarding the current projection or history. */
export function appendUrlIngestionTransition(
  state: ProjectState,
  ingestionId: string,
  status: UrlIngestionStatus,
  operationId: string,
  patch: UrlIngestionTransitionPatch = {},
): ProjectState {
  const updatedAt = new Date().toISOString();
  const record = state.url_ingestions.find((item) => item.id === ingestionId);
  if (record === undefined) throw new CoreError("URL_INGESTION_NOT_FOUND", `URL ingestion "${ingestionId}" not found.`, true);
  const transition = transitionFor(record, status, operationId, patch);
  const updated: UrlIngestionRecord = {
    ...record,
    status,
    ...(patch.requested_url === undefined ? {} : { requested_url: patch.requested_url }),
    ...(patch.final_url === undefined ? {} : { final_url: patch.final_url }),
    ...(patch.canonical_url === undefined ? {} : { canonical_url: patch.canonical_url }),
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.media_type === undefined ? {} : { media_type: patch.media_type }),
    ...(patch.content_size === undefined ? {} : { content_size: patch.content_size }),
    ...(patch.error_code === undefined ? {} : { error_code: patch.error_code }),
    ...(patch.error_message === undefined ? {} : { error_message: patch.error_message }),
    ...(patch.next_actions === undefined ? {} : { next_actions: patch.next_actions }),
    ...(patch.source_id === undefined ? {} : { source_id: patch.source_id }),
    updated_at: updatedAt,
    transitions: [...(record.transitions ?? []), transition],
  };
  return { ...state, url_ingestions: state.url_ingestions.map((item) => item.id === ingestionId ? updated : item) };
}

function assertRetryLineage(current: ProjectState, predecessorId: string): UrlIngestionRecord {
  const predecessor = current.url_ingestions.find((item) => item.id === predecessorId);
  if (predecessor === undefined) throw new CoreError("URL_INGESTION_NOT_FOUND", `URL ingestion "${predecessorId}" not found.`, true);
  if (predecessor.status !== "fetch_failed") {
    throw new CoreError("URL_INGESTION_RETRY_INVALID", `URL ingestion "${predecessorId}" is ${predecessor.status}; only fetch_failed ingestions can be retried.`, true);
  }
  if (predecessor.successor_of !== undefined || current.url_ingestions.some((item) => item.retry_of === predecessorId)) {
    throw new CoreError("URL_INGESTION_SUCCESSOR_EXISTS", `URL ingestion "${predecessorId}" already has a successor.`, true);
  }
  return predecessor;
}

/** Persist url_received before the first network operation. */
export async function beginUrlIngestion(
  repository: ProjectRepository,
  state: ProjectState,
  context: UrlIngestionLifecycleContext,
): Promise<UrlIngestionLifecycle> {
  const id = internalId("url_ingestion");
  const createdAt = new Date().toISOString();
  const initial: UrlIngestionRecord = {
    id,
    operation_id: context.operation_id,
    url: context.requested_url,
    requested_url: context.requested_url,
    status: "url_received",
    ...(context.retry_of === undefined ? {} : { retry_of: context.retry_of }),
    route: context.route,
    ...(context.task_id === undefined ? {} : { task_id: context.task_id }),
    ...(context.context === undefined ? {} : { context: context.context }),
    created_at: createdAt,
    updated_at: createdAt,
    transitions: [],
  };
  const initialWithTransition = appendUrlIngestionTransition(
    { ...state, url_ingestions: [...state.url_ingestions, initial] },
    id,
    "url_received",
    context.operation_id,
    { requested_url: context.requested_url },
  ).url_ingestions.at(-1)!;
  const persisted = await repository.commit(state.revision, (current) => {
    if (context.retry_of !== undefined) assertRetryLineage(current, context.retry_of);
    const records = [...current.url_ingestions, initialWithTransition];
    return {
      ...current,
      url_ingestions: context.retry_of === undefined
        ? records
        : records.map((item) => item.id === context.retry_of ? { ...item, successor_of: id, updated_at: createdAt } : item),
    };
  });

  let latest = persisted;
  return {
    id,
    get state() { return latest; },
    async transition(status, patch = {}) {
      latest = await repository.commit(latest.revision, (current) => appendUrlIngestionTransition(current, id, status, context.operation_id, patch));
      return latest;
    },
  };
}

function errorForFetch(url: string, error: unknown): CoreError {
  if (error instanceof CoreError) return error;
  return new CoreError("URL_FETCH_FAILED", `Failed to fetch URL ${url}: ${error instanceof Error ? error.message : String(error)}`, true);
}

function htmlMetadata(text: string): { title?: string; canonical_url?: string } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(text);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim();
  const linkTags = text.match(/<link\b[^>]*>/giu) ?? [];
  let canonicalUrl: string | undefined;
  for (const tag of linkTags) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1] ?? "";
    if (!rel.toLocaleLowerCase().split(/\s+/u).includes("canonical")) continue;
    canonicalUrl = /\bhref\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]?.trim();
    if (canonicalUrl) break;
  }
  return { ...(title ? { title } : {}), ...(canonicalUrl ? { canonical_url: canonicalUrl } : {}) };
}

function fallbackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/gu, "");
    return path.length > 0 ? `${parsed.hostname} — ${path}` : parsed.hostname;
  } catch {
    return url;
  }
}

function resolveUrl(value: string | undefined, baseUrl: string, fallback: string): string {
  if (value === undefined || value.trim() === "") return fallback;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return fallback;
  }
}

function mergeUrlLifecycleState(local: ProjectState, persisted: ProjectState): ProjectState {
  return { ...local, revision: persisted.revision, url_ingestions: persisted.url_ingestions };
}

export async function fetchAndValidateUrlContent(
  fetcher: SourceFetcher | undefined,
  url: string,
  lifecycle?: UrlIngestionLifecycle,
): Promise<{
  text: string;
  canonical_url: string;
  final_url: string;
  title: string;
  media_type: string;
  content_size: number;
  projection: UrlIngestionProjection;
}> {
  if (lifecycle !== undefined) await lifecycle.transition("fetching", { requested_url: url });
  const fail = async (error: unknown): Promise<never> => {
    const coreError = errorForFetch(url, error);
    const details = {
      ...((coreError.details !== null && typeof coreError.details === "object") ? coreError.details as Record<string, unknown> : {}),
      url_ingestion_id: lifecycle?.id,
      status: "fetch_failed",
      error_code: coreError.code,
      error_message: coreError.message,
      next_actions: ["retry", "change_url"],
    };
    if (lifecycle !== undefined) {
      await lifecycle.transition("fetch_failed", { error_code: coreError.code, error_message: coreError.message, next_actions: ["retry", "change_url"] });
    }
    throw new CoreError(coreError.code, coreError.message, true, details);
  };

  if (fetcher === undefined) return fail(new CoreError("URL_FETCHER_UNAVAILABLE", "URL fetcher is not configured.", true));
  let fetched;
  try {
    fetched = await fetcher(url);
  } catch (error) {
    return fail(error);
  }
  if (fetched === undefined || fetched.content === undefined || fetched.content.byteLength === 0) {
    return fail(new CoreError("URL_CONTENT_EMPTY", `URL ${url} returned empty content.`, true));
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let decoded: string;
  try {
    decoded = decoder.decode(fetched.content);
  } catch {
    return fail(new CoreError("URL_CONTENT_INVALID", `URL ${url} content is not valid UTF-8 text.`, true));
  }
  if (decoded.trim() === "") return fail(new CoreError("URL_CONTENT_EMPTY", `URL ${url} returned empty text content.`, true));

  const text = decoded.trim();
  const finalUrl = resolveUrl(fetched.final_url, url, url);
  const parsedMetadata = htmlMetadata(text);
  const canonicalUrl = resolveUrl(fetched.canonical_url ?? parsedMetadata.canonical_url, finalUrl, url);
  const mediaType = fetched.media_type ?? "text/html";
  const title = fetched.title?.trim() || parsedMetadata.title || fallbackTitle(finalUrl);
  const contentSize = fetched.content.byteLength;
  if (lifecycle !== undefined) {
    await lifecycle.transition("content_validated", {
      requested_url: url,
      canonical_url: canonicalUrl,
      final_url: finalUrl,
      title,
      media_type: mediaType,
      content_size: contentSize,
    });
  }
  return {
    text,
    canonical_url: canonicalUrl,
    final_url: finalUrl,
    title,
    media_type: mediaType,
    content_size: contentSize,
    projection: {
      url,
      requested_url: url,
      status: "content_validated",
      canonical_url: canonicalUrl,
      final_url: finalUrl,
      title,
      media_type: mediaType,
      content_size: contentSize,
    },
  };
}

function contentHashOf(content: Uint8Array): string {
  return contentHash(Buffer.from(content.buffer, content.byteOffset, content.byteLength));
}

export function validateAndDecodeAttachments(
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>,
): Array<{ name: string; text: string; media_type: string; content_hash: string; content_size: number }> {
  if (attachments.length === 0) return [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const result: Array<{ name: string; text: string; media_type: string; content_hash: string; content_size: number }> = [];
  for (const att of attachments) {
    const mediaType = att.media_type ?? "text/plain";
    if (!mediaType.startsWith("text/") && mediaType !== "application/json" && mediaType !== "application/xml" && mediaType !== "") {
      throw new CoreError("OPERATION_COMMAND_INVALID", `Unsupported attachment media_type "${mediaType}" for file "${att.name}".`, true);
    }
    try {
      const decoded = decoder.decode(att.content);
      if (decoded.trim() !== "") {
        result.push({ name: att.name, text: decoded.trim(), media_type: mediaType, content_hash: contentHashOf(att.content), content_size: att.content.byteLength });
      }
    } catch {
      throw new CoreError("OPERATION_COMMAND_INVALID", `Attachment "${att.name}" is not valid UTF-8 text.`, true);
    }
  }
  return result;
}

export interface SupplementEvidenceOptions {
  text?: string;
  url?: string;
  attachments?: Array<{ name: string; content: Uint8Array; media_type?: string }>;
  defaultTitle?: string;
  urlLifecycle?: UrlIngestionLifecycle;
}

export interface SupplementEvidenceResult {
  state: ProjectState;
  candidate: SourceCandidate;
  source: SourceRecord;
  chunks: KnowledgeChunk[];
  urlIngestion?: UrlIngestionProjection;
}

function componentId(component: Omit<SourceEvidenceComponent, "id">): string {
  return `evidence_${contentHash(canonicalJson(component)).slice(0, 32)}`;
}

export async function ingestUserSupplementEvidence(
  fetcher: SourceFetcher | undefined,
  state: ProjectState,
  operationId: string,
  actor: string,
  options: SupplementEvidenceOptions,
): Promise<SupplementEvidenceResult> {
  const textSegments: string[] = [];
  const components: SourceEvidenceComponent[] = [];
  let urlIngestion: UrlIngestionProjection | undefined;
  let fetchedUrl: Awaited<ReturnType<typeof fetchAndValidateUrlContent>> | undefined;

  if (options.text !== undefined && options.text.trim() !== "") {
    const text = options.text.trim();
    const component: Omit<SourceEvidenceComponent, "id"> = { type: "text", ordinal: components.length, content_hash: contentHash(text), content_size: Buffer.byteLength(text, "utf8"), media_type: "text/plain" };
    components.push({ id: componentId(component), ...component });
    textSegments.push(text);
  }
  if (options.url !== undefined && options.url.trim() !== "") {
    const targetUrl = options.url.trim();
    fetchedUrl = await fetchAndValidateUrlContent(fetcher, targetUrl, options.urlLifecycle);
    const component: Omit<SourceEvidenceComponent, "id"> = {
      type: "url",
      ordinal: components.length,
      content_hash: contentHash(fetchedUrl.text),
      content_size: fetchedUrl.content_size,
      media_type: fetchedUrl.media_type,
      title: fetchedUrl.title,
      requested_url: targetUrl,
      canonical_url: fetchedUrl.canonical_url,
      final_url: fetchedUrl.final_url,
    };
    components.push({ id: componentId(component), ...component });
    textSegments.push(fetchedUrl.text);
    urlIngestion = fetchedUrl.projection;
  }
  const validAttachments = validateAndDecodeAttachments(options.attachments ?? []);
  for (const att of validAttachments) {
    const component: Omit<SourceEvidenceComponent, "id"> = { type: "attachment", ordinal: components.length, content_hash: att.content_hash, content_size: att.content_size, media_type: att.media_type, original_name: att.name, title: att.name };
    components.push({ id: componentId(component), ...component });
    textSegments.push(`Attachment (${att.name}):\n${att.text}`);
  }

  const combinedText = textSegments.join("\n\n---\n\n");
  if (combinedText.trim() === "") throw new CoreError("COVERAGE_SUPPLEMENT_REQUIRED", "User supplement must contain text, a valid URL, or valid text attachment.", true);

  const componentCount = components.length;
  const singleUrl = componentCount === 1 && components[0]?.type === "url";
  const singleAttachment = componentCount === 1 && components[0]?.type === "attachment";
  const defaultTitle = options.defaultTitle ?? "User supplement";
  const title = singleUrl ? fetchedUrl?.title ?? fallbackTitle(options.url ?? "URL supplement") : singleAttachment ? validAttachments[0]?.name ?? defaultTitle : componentCount > 1 ? `Compound evidence (${componentCount} components)` : defaultTitle;
  const mediaType = singleUrl ? fetchedUrl?.media_type ?? "text/html" : singleAttachment ? validAttachments[0]?.media_type ?? "text/plain" : componentCount > 1 ? "application/vnd.st-workspace.compound-evidence" : "text/plain";
  const urlComponent = components.find((component) => component.type === "url");
  const size = singleUrl ? urlComponent?.content_size : singleAttachment ? components[0]?.content_size : undefined;
  const sourceResult = createUserSupplementSource(state, combinedText, actor, operationId, mediaType, title);
  const sourceRevision = contentHash(canonicalJson({ id: sourceResult.source.id, text: combinedText, media_type: mediaType, components }));
  const candidate: SourceCandidate = {
    ...sourceResult.candidate,
    ...(size === undefined ? {} : { content_size: size }),
    evidence_components: components,
    source_revision: sourceRevision,
    ...(singleUrl && urlComponent?.requested_url !== undefined ? { url: urlComponent.requested_url } : {}),
    ...(singleUrl && urlComponent?.canonical_url !== undefined ? { canonical_url: urlComponent.canonical_url } : {}),
    ...(singleUrl && urlComponent?.final_url !== undefined ? { final_url: urlComponent.final_url } : {}),
    ...(singleUrl && urlComponent?.title !== undefined ? { title: urlComponent.title } : {}),
    ...(singleUrl && urlComponent?.requested_url !== undefined ? (() => {
      try {
        const domain = new URL(urlComponent.requested_url).hostname;
        return domain.length > 0 ? { domain } : {};
      } catch {
        return {};
      }
    })() : {}),
  };
  const source: SourceRecord = {
    ...sourceResult.source,
    title,
    media_type: mediaType,
    revision: sourceRevision,
    ...(size === undefined ? {} : { content_size: size }),
    ...(singleAttachment && validAttachments[0] !== undefined ? { original_name: validAttachments[0].name } : {}),
    evidence_components: components,
    ...(singleUrl && urlComponent?.canonical_url !== undefined ? { canonical_url: urlComponent.canonical_url } : {}),
    ...(singleUrl && urlComponent?.final_url !== undefined ? { final_url: urlComponent.final_url } : {}),
  };

  const stateWithSourceBase = mergeUrlLifecycleState(sourceResult.state, options.urlLifecycle?.state ?? sourceResult.state);
  const stateWithSource: ProjectState = {
    ...stateWithSourceBase,
    candidates: stateWithSourceBase.candidates.map((item) => item.id === candidate.id ? candidate : item),
    sources: stateWithSourceBase.sources.map((item) => item.id === source.id ? source : item),
  };
  let stateBeforeChunks = stateWithSource;
  if (urlIngestion !== undefined && options.urlLifecycle !== undefined) {
    const persisted = await options.urlLifecycle.transition("ingested", {
      requested_url: urlIngestion.requested_url ?? urlIngestion.url,
      ...(urlIngestion.canonical_url === undefined ? {} : { canonical_url: urlIngestion.canonical_url }),
      ...(urlIngestion.final_url === undefined ? {} : { final_url: urlIngestion.final_url }),
      ...(urlIngestion.title === undefined ? {} : { title: urlIngestion.title }),
      ...(urlIngestion.media_type === undefined ? {} : { media_type: urlIngestion.media_type }),
      ...(urlIngestion.content_size === undefined ? {} : { content_size: urlIngestion.content_size }),
      source_id: source.id,
    });
    stateBeforeChunks = mergeUrlLifecycleState(stateWithSource, persisted);
    urlIngestion = { ...urlIngestion, status: "ingested", source_id: source.id };
  } else if (urlIngestion !== undefined) {
    urlIngestion = { ...urlIngestion, status: "ingested", source_id: source.id };
  }

  const chunks = chunkSource(source, KNOWLEDGE_EXTRACTOR_REVISION);
  const stateWithChunks: ProjectState = { ...stateBeforeChunks, knowledge_chunks: [...stateBeforeChunks.knowledge_chunks, ...chunks] };
  return { state: stateWithChunks, candidate, source, chunks, ...(urlIngestion === undefined ? {} : { urlIngestion }) };
}
