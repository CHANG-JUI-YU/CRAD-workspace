import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileProjectRepository } from "./repository/file-project-repository.js";
import type { OperationAttachmentRef } from "./project-state.js";
import type { SourceAttachment } from "./core-utilities.js";
import { CoreError, internalId } from "./core-utilities.js";

export interface AttachmentStore {
  save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]>;
  load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]>;
}
export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly store = new Map<string, Array<{ ref: OperationAttachmentRef; content: Uint8Array }>>();

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const refs = attachments.map((attachment) => ({
      id: internalId("attachment"),
      name: attachment.name,
      ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }),
    }));
    this.store.set(operationId, attachments.map((attachment, index) => ({ ref: refs[index]!, content: attachment.content })));
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
    if (this.repository !== undefined) {
      return path.join(this.repository.projectDirectory, ".workspace", "attachments", operationId);
    }
    return path.join(this.projectRoot, this.projectId, ".workspace", "attachments", operationId);
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
}
