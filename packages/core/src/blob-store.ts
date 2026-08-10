import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Content-addressed immutable blob storage for large compiled payloads.
 * State records only a `{ hash, size }` reference; the payload itself lives
 * here so repeated builds do not keep growing the project state.
 */
export interface BlobStore {
  put(hash: string, content: Uint8Array): Promise<void>;
  get(hash: string): Promise<Uint8Array | undefined>;
  has(hash: string): Promise<boolean>;
}

export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async put(hash: string, content: Uint8Array): Promise<void> {
    this.blobs.set(hash, content);
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(hash);
  }

  async has(hash: string): Promise<boolean> {
    return this.blobs.has(hash);
  }
}

export class FileBlobStore implements BlobStore {
  constructor(private readonly directory: string) {}

  private fileFor(hash: string): string {
    return path.join(this.directory, hash);
  }

  async put(hash: string, content: Uint8Array): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.fileFor(hash), content);
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(this.fileFor(hash));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async has(hash: string): Promise<boolean> {
    try {
      await stat(this.fileFor(hash));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
