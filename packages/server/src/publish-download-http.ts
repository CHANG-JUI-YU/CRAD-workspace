import type { ServerResponse } from "node:http";
import { CoreError } from "@st-workspace/core";
import type { PublishDownloadResult, WorkspaceRuntime } from "@st-workspace/runtime";
import { restError } from "./http-utils.js";

const MAX_ATTACHMENT_FILENAME_BYTES = 180;
const CONTROL_OR_DELIMITER = /[\u0000-\u001f\u007f"\\]/gu;
const ASCII_UNSAFE = /[^\x20-\x7e]|["\\;]/gu;

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const next = Buffer.byteLength(character, "utf8");
    if (bytes + next > maxBytes) break;
    result += character;
    bytes += next;
  }
  return result;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const segments = filename.split(/[\\/]+/u);
  const leaf = segments.at(-1) ?? "";
  const cleaned = leaf.replace(CONTROL_OR_DELIMITER, "_").trim();
  const usable = cleaned === "" || cleaned === "." || cleaned === ".." ? "download" : cleaned;
  return truncateUtf8(usable, MAX_ATTACHMENT_FILENAME_BYTES) || "download";
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function attachmentContentDisposition(filename: string): string {
  const safe = sanitizeAttachmentFilename(filename);
  const fallback = safe.normalize("NFKD").replace(ASCII_UNSAFE, "_") || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}

type PublishDownloadRuntime = Pick<WorkspaceRuntime, "publishDownload">;

export async function handlePublishDownloadRequest(
  method: string | undefined,
  response: ServerResponse,
  url: URL,
  getRuntime: () => Promise<PublishDownloadRuntime>,
): Promise<boolean> {
  if (method !== "GET" || url.pathname !== "/workspace/publish/download") return false;

  const publishId = url.searchParams.get("publish_id");
  const rawKind = url.searchParams.get("kind");
  if (publishId === null || publishId === "") {
    restError(response, new CoreError("PUBLISH_ID_REQUIRED", "publish_id 參數為必填。", true));
    return true;
  }
  if (rawKind !== "json" && rawKind !== "png") {
    restError(response, new CoreError("PUBLISH_DOWNLOAD_KIND_INVALID", `Invalid download kind: ${rawKind ?? "null"}`, true));
    return true;
  }

  try {
    const result: PublishDownloadResult = await (await getRuntime()).publishDownload(publishId, rawKind);
    const body = Buffer.from(result.content.buffer, result.content.byteOffset, result.content.byteLength);
    response.statusCode = 200;
    response.setHeader("content-type", result.media_type);
    response.setHeader("content-disposition", attachmentContentDisposition(result.filename));
    response.setHeader("content-length", String(body.byteLength));
    response.end(body);
  } catch (error) {
    restError(response, error);
  }
  return true;
}
