import {
  CoreError,
  type ProjectState,
  type SourceCandidate,
  type SourceRecord,
  type KnowledgeChunk,
} from "@st-workspace/core";
import {
  createUserSupplementSource,
  chunkSource,
  KNOWLEDGE_EXTRACTOR_REVISION,
  type SourceFetcher,
} from "@st-workspace/domain";

export interface UrlIngestionProjection {
  url: string;
  status: "url_received" | "fetching" | "fetch_failed" | "content_validated" | "ingested";
  final_url?: string;
  title?: string;
  media_type?: string;
  content_size?: number;
  error_code?: string;
  error_message?: string;
  next_actions?: Array<"retry" | "change_url">;
}

export async function fetchAndValidateUrlContent(
  fetcher: SourceFetcher | undefined,
  url: string,
): Promise<{
  text: string;
  canonical_url: string;
  final_url: string;
  title: string;
  media_type: string;
  content_size: number;
  projection: UrlIngestionProjection;
}> {
  if (fetcher === undefined) {
    throw new CoreError("URL_FETCHER_UNAVAILABLE", "URL fetcher is not configured.", true);
  }
  let fetched;
  try {
    fetched = await fetcher(url);
  } catch (err) {
    throw new CoreError("URL_FETCH_FAILED", `Failed to fetch URL ${url}: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  if (fetched === undefined || fetched.content === undefined || fetched.content.byteLength === 0) {
    throw new CoreError("URL_CONTENT_EMPTY", `URL ${url} returned empty content.`, true);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let decoded: string;
  try {
    decoded = decoder.decode(fetched.content);
  } catch {
    throw new CoreError("URL_CONTENT_INVALID", `URL ${url} content is not valid UTF-8 text.`, true);
  }
  if (decoded.trim() === "") {
    throw new CoreError("URL_CONTENT_EMPTY", `URL ${url} returned empty text content.`, true);
  }
  const finalUrl = fetched.final_url ?? url;
  const mediaType = fetched.media_type ?? "text/html";
  const title = (fetched as { title?: string }).title ?? `Source from ${url}`;
  const contentSize = fetched.content.byteLength;

  return {
    text: decoded.trim(),
    canonical_url: url,
    final_url: finalUrl,
    title,
    media_type: mediaType,
    content_size: contentSize,
    projection: {
      url,
      status: "content_validated",
      final_url: finalUrl,
      title,
      media_type: mediaType,
      content_size: contentSize,
    },
  };
}

export function validateAndDecodeAttachments(
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>,
): Array<{ name: string; text: string; media_type: string }> {
  if (attachments.length === 0) return [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const result: Array<{ name: string; text: string; media_type: string }> = [];

  for (const att of attachments) {
    const mediaType = att.media_type ?? "text/plain";
    if (
      !mediaType.startsWith("text/") &&
      mediaType !== "application/json" &&
      mediaType !== "application/xml" &&
      mediaType !== ""
    ) {
      throw new CoreError(
        "OPERATION_COMMAND_INVALID",
        `Unsupported attachment media_type "${mediaType}" for file "${att.name}".`,
        true,
      );
    }
    try {
      const decoded = decoder.decode(att.content);
      if (decoded.trim() !== "") {
        result.push({
          name: att.name,
          text: decoded.trim(),
          media_type: mediaType,
        });
      }
    } catch {
      throw new CoreError(
        "OPERATION_COMMAND_INVALID",
        `Attachment "${att.name}" is not valid UTF-8 text.`,
        true,
      );
    }
  }

  return result;
}

export interface SupplementEvidenceOptions {
  text?: string;
  url?: string;
  attachments?: Array<{ name: string; content: Uint8Array; media_type?: string }>;
  defaultTitle?: string;
}

export interface SupplementEvidenceResult {
  state: ProjectState;
  candidate: SourceCandidate;
  source: SourceRecord;
  chunks: KnowledgeChunk[];
  urlIngestion?: UrlIngestionProjection;
}

export async function ingestUserSupplementEvidence(
  fetcher: SourceFetcher | undefined,
  state: ProjectState,
  operationId: string,
  actor: string,
  options: SupplementEvidenceOptions,
): Promise<SupplementEvidenceResult> {
  const textSegments: string[] = [];
  let urlIngestion: UrlIngestionProjection | undefined;
  let finalUrl: string | undefined;

  if (options.text !== undefined && options.text.trim() !== "") {
    textSegments.push(options.text.trim());
  }

  if (options.url !== undefined && options.url.trim() !== "") {
    const targetUrl = options.url.trim();
    const fetched = await fetchAndValidateUrlContent(fetcher, targetUrl);
    textSegments.push(fetched.text);
    urlIngestion = fetched.projection;
    finalUrl = fetched.final_url;
  }

  const validAttachments = validateAndDecodeAttachments(options.attachments ?? []);
  for (const att of validAttachments) {
    textSegments.push(`Attachment (${att.name}):\n${att.text}`);
  }

  const combinedText = textSegments.join("\n\n---\n\n");
  if (combinedText.trim() === "") {
    throw new CoreError(
      "COVERAGE_SUPPLEMENT_REQUIRED",
      "User supplement must contain text, a valid URL, or valid text attachment.",
      true,
    );
  }

  const defaultTitle = options.defaultTitle ?? "User supplement";
  const { candidate, source, state: stateWithSource } = createUserSupplementSource(
    state,
    combinedText,
    actor,
    operationId,
    validAttachments[0]?.media_type ?? "text/plain",
    validAttachments[0]?.name ?? defaultTitle,
  );

  const finalSource: SourceRecord = {
    ...source,
    provenance_kind: "user_supplement",
    ...(options.url === undefined ? {} : { canonical_url: options.url, final_url: finalUrl ?? options.url }),
  };

  const updatedSources = stateWithSource.sources.map((s) => (s.id === source.id ? finalSource : s));
  const sWithSourceUpdated: ProjectState = { ...stateWithSource, sources: updatedSources };

  const chunks = chunkSource(finalSource, KNOWLEDGE_EXTRACTOR_REVISION);
  const stateWithChunks: ProjectState = {
    ...sWithSourceUpdated,
    knowledge_chunks: [...sWithSourceUpdated.knowledge_chunks, ...chunks],
  };

  if (urlIngestion !== undefined) {
    urlIngestion = { ...urlIngestion, status: "ingested" };
  }

  return {
    state: stateWithChunks,
    candidate,
    source: finalSource,
    chunks,
    ...(urlIngestion === undefined ? {} : { urlIngestion }),
  };
}
