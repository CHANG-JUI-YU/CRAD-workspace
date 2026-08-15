import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface AttachmentStore {
  save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]>;
  load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]>;
  inspect(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<AttachmentInspectionRef[]>;
}
export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly store = new Map<string, Array<{ ref: OperationAttachmentRef; content: Uint8Array }>>();

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const refs = attachments.map((attachment) => ({
      id: internalId("attachment"),
      name: attachment.name,
      ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }),
    }));
    const existing = this.store.get(operationId) ?? [];
    const additions = attachments.map((attachment, index) => ({ ref: refs[index]!, content: attachment.content }));
    this.store.set(operationId, [...existing, ...additions]);
    return refs;
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

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const directory = this.directoryFor(operationId);
    const refs: OperationAttachmentRef[] = [];
    await mkdir(directory, { recursive: true });
    for (const attachment of attachments) {
      const id = internalId("attachment");
      await writeFile(path.join(directory, id), attachment.content);
      refs.push({ id, name: attachment.name, ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }) });
    }
    return refs;
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
