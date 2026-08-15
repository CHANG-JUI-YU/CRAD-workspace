import { mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileProjectRepository } from "./repository/file-project-repository.js";
import type { OperationAttachmentRef } from "./project-state.js";
import type { SourceAttachment } from "./core-utilities.js";
import { contentHash, CoreError, internalId } from "./core-utilities.js";

const SAFE_OPERATION_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MAX_OPERATION_ID_LENGTH = 200;

/**
 * Maps a caller-controlled operation id onto a single safe path segment.
 * Ids that are already safe single segments pass through unchanged so existing
 * legacy directories stay readable; anything that could traverse (separators,
 * drive/UNC prefixes, dot segments, hidden leading dots, control characters,
 * overlong values) is replaced by its content hash (fixed 64-hex segment).
 */
export function safeOperationIdSegment(operationId: string): string {
  if (
    operationId.length > 0
    && operationId.length <= MAX_OPERATION_ID_LENGTH
    && operationId !== "."
    && operationId !== ".."
    && !operationId.startsWith(".")
    && SAFE_OPERATION_ID_SEGMENT.test(operationId)
  ) {
    return operationId;
  }
  return contentHash(operationId);
}

export interface AttachmentInspectionRef {
  id: string;
  name: string;
  media_type?: string;
  available: boolean;
}

export interface StagedAttachmentSession {
  session_id: string;
  operation_id: string;
  refs: OperationAttachmentRef[];
}

export interface AttachmentStore {
  save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]>;
  load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]>;
  inspect(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<AttachmentInspectionRef[]>;
  stage(operationId: string, attachments: readonly SourceAttachment[]): Promise<StagedAttachmentSession>;
  finalize(session: StagedAttachmentSession): Promise<OperationAttachmentRef[]>;
  abort(session: StagedAttachmentSession): Promise<void>;
  listStagedSessions(): Promise<StagedAttachmentSession[]>;
  listOperationFiles(operationId: string): Promise<string[]>;
}

function refFor(attachment: SourceAttachment): OperationAttachmentRef {
  const bytes = Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength);
  return {
    id: contentHash(bytes),
    name: attachment.name,
    ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }),
    content_hash: contentHash(bytes),
  };
}

interface StoredAttachmentEntry {
  ref: OperationAttachmentRef;
  content: Uint8Array;
}

export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly store = new Map<string, StoredAttachmentEntry[]>();
  private readonly staged = new Map<string, StagedAttachmentSession & { entries: StoredAttachmentEntry[] }>();

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const refs = attachments.map((attachment) => refFor(attachment));
    const existing = this.store.get(operationId) ?? [];
    const additions = attachments.map((attachment, index) => ({ ref: refs[index]!, content: attachment.content }));
    this.store.set(operationId, [...existing, ...additions]);
    return refs;
  }

  async stage(operationId: string, attachments: readonly SourceAttachment[]): Promise<StagedAttachmentSession> {
    const refs = attachments.map((attachment) => refFor(attachment));
    const session: StagedAttachmentSession & { entries: StoredAttachmentEntry[] } = {
      session_id: internalId("stage"),
      operation_id: operationId,
      refs,
      entries: attachments.map((attachment, index) => ({ ref: refs[index]!, content: attachment.content })),
    };
    this.staged.set(session.session_id, session);
    return session;
  }

  async finalize(session: StagedAttachmentSession): Promise<OperationAttachmentRef[]> {
    const staged = this.staged.get(session.session_id);
    if (staged === undefined) {
      throw new CoreError("ATTACHMENT_STAGING_SESSION_MISSING", `Staged attachment session ${session.session_id} is not available in this runtime.`, true);
    }
    this.staged.delete(session.session_id);
    const existing = this.store.get(session.operation_id) ?? [];
    this.store.set(session.operation_id, [...existing, ...staged.entries]);
    return staged.refs;
  }

  async abort(session: StagedAttachmentSession): Promise<void> {
    this.staged.delete(session.session_id);
  }

  async listStagedSessions(): Promise<StagedAttachmentSession[]> {
    return [...this.staged.values()].map(({ session_id, operation_id, refs }) => ({ session_id, operation_id, refs }));
  }

  async listOperationFiles(operationId: string): Promise<string[]> {
    return (this.store.get(operationId) ?? []).map((entry) => entry.ref.id);
  }

  async load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]> {
    const entries = this.store.get(operationId) ?? [];
    return refs.map((ref) => {
      const entry = entries.find((candidate) => candidate.ref.id === ref.id);
      if (entry === undefined) throw new CoreError("ATTACHMENT_NOT_FOUND", `Attachment ${ref.id} of operation ${operationId} is not available in this runtime.`, false);
      return { name: entry.ref.name, content: entry.content, ...(entry.ref.media_type === undefined ? {} : { media_type: entry.ref.media_type }) };
    });
  }

  async inspect(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<AttachmentInspectionRef[]> {
    const entries = this.store.get(operationId) ?? [];
    return refs.map((ref) => {
      const found = entries.some((candidate) => candidate.ref.id === ref.id);
      return {
        id: ref.id,
        name: ref.name,
        ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }),
        available: found,
      };
    });
  }
}

/**
 * File-backed attachment store under `<projectDirectory>/.workspace/attachments/<operationId>`.
 * Accepts a FileProjectRepository so that the target directory follows the repository
 * through renames (relocate) instead of freezing the original project id at construction.
 *
 * Attachment files are content-addressed (file name = sha256 of the bytes) so retries of
 * the same immutable command reuse the same refs and bytes. Staged files live under
 * `<root>/.staging/<sessionId>` and only become visible under the operation directory
 * after finalize (post-commit). abort removes only the files of the named session.
 */
export class FileAttachmentStore implements AttachmentStore {
  private readonly repository: FileProjectRepository | undefined;
  private readonly projectRoot: string;
  private readonly projectId: string;

  constructor(repository: FileProjectRepository, projectId?: never);
  constructor(projectRoot: string, projectId: string);
  constructor(rootOrRepository: FileProjectRepository | string, projectId?: string) {
    if (typeof rootOrRepository === "object") {
      this.repository = rootOrRepository;
      this.projectRoot = "";
      this.projectId = "";
    } else {
      this.projectRoot = rootOrRepository;
      this.projectId = projectId ?? "default";
    }
  }

  private directoryFor(operationId: string): string {
    const root = this.attachmentRoot();
    const directory = path.resolve(path.join(root, safeOperationIdSegment(operationId)));
    const resolvedRoot = path.resolve(root);
    if (directory !== resolvedRoot && !directory.startsWith(resolvedRoot + path.sep)) {
      throw new CoreError("ATTACHMENT_PATH_ESCAPE", `Attachment path for operation ${operationId} resolves outside the attachment root.`, false);
    }
    return directory;
  }

  private attachmentRoot(): string {
    if (this.repository !== undefined) {
      return path.join(this.repository.projectDirectory, ".workspace", "attachments");
    }
    return path.join(this.projectRoot, this.projectId, ".workspace", "attachments");
  }

  private stagingRoot(): string {
    return path.join(this.attachmentRoot(), ".staging");
  }

  private stagingDirectoryFor(sessionId: string): string {
    const root = this.stagingRoot();
    const directory = path.resolve(path.join(root, safeOperationIdSegment(sessionId)));
    const resolvedRoot = path.resolve(root);
    if (directory !== resolvedRoot && !directory.startsWith(resolvedRoot + path.sep)) {
      throw new CoreError("ATTACHMENT_PATH_ESCAPE", `Staging path for session ${sessionId} resolves outside the staging root.`, false);
    }
    return directory;
  }

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const directory = this.directoryFor(operationId);
    const refs: OperationAttachmentRef[] = [];
    await mkdir(directory, { recursive: true });
    for (const attachment of attachments) {
      const ref = refFor(attachment);
      await writeFile(path.join(directory, ref.id), attachment.content);
      refs.push(ref);
    }
    return refs;
  }

  async stage(operationId: string, attachments: readonly SourceAttachment[]): Promise<StagedAttachmentSession> {
    const sessionId = internalId("stage");
    const directory = this.stagingDirectoryFor(sessionId);
    const refs = attachments.map((attachment) => refFor(attachment));
    await mkdir(directory, { recursive: true });
    for (const attachment of attachments) {
      await writeFile(path.join(directory, refFor(attachment).id), attachment.content);
    }
    await writeFile(
      path.join(directory, "manifest.json"),
      Buffer.from(JSON.stringify({ session_id: sessionId, operation_id: operationId, refs })),
    );
    return { session_id: sessionId, operation_id: operationId, refs };
  }

  async finalize(session: StagedAttachmentSession): Promise<OperationAttachmentRef[]> {
    const directory = this.stagingDirectoryFor(session.session_id);
    const destination = this.directoryFor(session.operation_id);
    await mkdir(destination, { recursive: true });
    for (const ref of session.refs) {
      const stagedPath = path.join(directory, ref.id);
      const finalPath = path.join(destination, ref.id);
      try {
        await rename(stagedPath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          await this.abort(session);
          throw new CoreError(
            "ATTACHMENT_FINALIZE_FAILED",
            `Failed to finalize staged attachment ${ref.id} for operation ${session.operation_id}; staged files were cleaned up, retry the same command to re-stage.`,
            true,
          );
        }
      }
    }
    await this.abort(session);
    return session.refs;
  }

  async abort(session: StagedAttachmentSession): Promise<void> {
    const directory = this.stagingDirectoryFor(session.session_id);
    await rm(directory, { recursive: true, force: true });
  }

  async listStagedSessions(): Promise<StagedAttachmentSession[]> {
    const { readdir } = await import("node:fs/promises");
    let entries: string[] = [];
    try {
      entries = await readdir(this.stagingRoot());
    } catch {
      return [];
    }
    const sessions: StagedAttachmentSession[] = [];
    for (const entry of entries) {
      if (entry === "manifest.json" || !SAFE_OPERATION_ID_SEGMENT.test(entry)) continue;
      const directory = this.stagingDirectoryFor(entry);
      try {
        const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
          session_id?: string;
          operation_id?: string;
          refs?: OperationAttachmentRef[];
        };
        sessions.push({
          session_id: manifest.session_id ?? entry,
          operation_id: manifest.operation_id ?? "",
          refs: Array.isArray(manifest.refs) ? manifest.refs : [],
        });
      } catch {
        sessions.push({ session_id: entry, operation_id: "", refs: [] });
      }
    }
    return sessions;
  }

  async listOperationFiles(operationId: string): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      return await readdir(this.directoryFor(operationId));
    } catch {
      return [];
    }
  }

  async load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]> {
    const directory = this.directoryFor(operationId);
    return Promise.all(refs.map(async (ref) => {
      try {
        const content = await readFile(path.join(directory, ref.id));
        return { name: ref.name, content, ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new CoreError("ATTACHMENT_NOT_FOUND", `Attachment ${ref.id} of operation ${operationId} is missing from the attachment store.`, false);
        }
        throw error;
      }
    }));
  }

  async inspect(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<AttachmentInspectionRef[]> {
    const directory = this.directoryFor(operationId);
    const { stat } = await import("node:fs/promises");
    return Promise.all(refs.map(async (ref) => {
      try {
        await stat(path.join(directory, ref.id));
        return {
          id: ref.id,
          name: ref.name,
          ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }),
          available: true,
        };
      } catch {
        return {
          id: ref.id,
          name: ref.name,
          ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }),
          available: false,
        };
      }
    }));
  }
}
