import { canonicalJson, contentHash } from "./core-utilities.js";
import type { OperationAttachmentRef } from "./project-state.js";

export const COVERAGE_COMMAND_IDENTITY_VERSION = 1;

export interface CoverageAttachmentIdentity {
  name: string;
  media_type?: string;
  content_hash: string;
}

export interface CoverageCommandIdentity {
  version: number;
  digest: string;
}

function canonicalValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      out[key] = canonicalValue(item);
    }
    return out;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return String(value);
}

export function computeCoverageAttachmentIdentities(
  attachments: ReadonlyArray<{ name: string; content: Uint8Array; media_type?: string }>,
): CoverageAttachmentIdentity[] {
  return attachments.map((attachment) => ({
    name: attachment.name,
    ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }),
    content_hash: contentHash(Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength)),
  }));
}

export function attachmentRefIdentities(refs: readonly OperationAttachmentRef[] | undefined): CoverageAttachmentIdentity[] {
  if (refs === undefined) return [];
  return refs.map((ref) => ({
    name: ref.name,
    ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }),
    content_hash: ref.content_hash ?? "",
  }));
}

function sortedAttachmentIdentities(identities: readonly CoverageAttachmentIdentity[]): CoverageAttachmentIdentity[] {
  return [...identities].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const aMedia = a.media_type ?? "";
    const bMedia = b.media_type ?? "";
    if (aMedia !== bMedia) return aMedia < bMedia ? -1 : 1;
    return a.content_hash < b.content_hash ? -1 : a.content_hash > b.content_hash ? 1 : 0;
  });
}

export function canonicalCoverageCommandIdentity(
  commandType: string,
  payload: unknown,
  attachmentIdentities: readonly CoverageAttachmentIdentity[],
): CoverageCommandIdentity {
  const source = (payload ?? {}) as Record<string, unknown>;
  const canonicalPayload: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (key === "attachment_refs") continue;
    const value = source[key];
    if (value === undefined) continue;
    canonicalPayload[key] = canonicalValue(value);
  }
  const digest = contentHash(canonicalJson({
    version: COVERAGE_COMMAND_IDENTITY_VERSION,
    type: commandType,
    payload: canonicalPayload,
    attachments: sortedAttachmentIdentities(attachmentIdentities),
  }));
  return { version: COVERAGE_COMMAND_IDENTITY_VERSION, digest };
}
