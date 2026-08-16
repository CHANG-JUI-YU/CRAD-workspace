import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileBlobStore, MemoryBlobStore } from "../src/blob-store.js";
import {
  CoreError,
  FileAttachmentStore,
  InMemoryAttachmentStore,
  contentHash,
  isFactCoverageDimension,
  isFactCoverageInput,
  requiredCoverageForClassification,
  safeOperationIdSegment,
  type SourceAttachment,
} from "../src/index.js";

const byte = (text: string): Uint8Array => new TextEncoder().encode(text);

function attachment(name: string, text: string): SourceAttachment {
  return { name, content: byte(text) };
}

function attachmentWithType(name: string, text: string, mediaType: string): SourceAttachment {
  return { name, content: byte(text), media_type: mediaType };
}

describe("Audit 8 Batch 11: attachment stores (#112 coverage)", () => {
  const tempRoots: string[] = [];
  afterEach(async () => {
    await Promise.allSettled(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "st-batch11-"));
    tempRoots.push(root);
    return root;
  }

  describe("InMemoryAttachmentStore", () => {
    it("saves, loads and inspects attachments with optional media types", async () => {
      const store = new InMemoryAttachmentStore();
      const refs = await store.save("op-1", [attachment("a.txt", "alpha"), attachmentWithType("b.txt", "beta", "text/plain")]);
      expect(refs).toHaveLength(2);
      expect(refs[0]).toMatchObject({ name: "a.txt", content_hash: contentHash("alpha") });
      expect(refs[0]!.media_type).toBeUndefined();
      expect(refs[1]!.media_type).toBe("text/plain");

      const loaded = await store.load("op-1", refs);
      expect(new TextDecoder().decode(loaded[0]!.content)).toBe("alpha");
      expect(loaded[1]!.media_type).toBe("text/plain");

      const inspected = await store.inspect("op-1", refs);
      expect(inspected.map((item) => ({ id: item.id, available: item.available }))).toEqual([
        { id: refs[0]!.id, available: true },
        { id: refs[1]!.id, available: true },
      ]);
      expect(await store.listOperationFiles("op-1")).toEqual(refs.map((ref) => ref.id));
    });

    it("reports missing attachments and unavailable inspection entries", async () => {
      const store = new InMemoryAttachmentStore();
      const refs = await store.save("op-1", [attachment("a.txt", "alpha")]);
      await expect(store.load("op-1", [{ ...refs[0]!, id: "missing-hash" }])).rejects.toThrow(CoreError);
      await expect(store.load("op-1", [{ ...refs[0]!, id: "missing-hash" }])).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
      const inspected = await store.inspect("op-1", [{ ...refs[0]!, id: "missing-hash" }]);
      expect(inspected[0]!.available).toBe(false);
      expect(await store.inspect("op-2", refs)).toEqual([{ id: refs[0]!.id, name: "a.txt", available: false }]);
      expect(await store.listOperationFiles("op-2")).toEqual([]);
    });

    it("keeps append-only saves across operations", async () => {
      const store = new InMemoryAttachmentStore();
      await store.save("op-1", [attachment("a.txt", "alpha")]);
      await store.save("op-1", [attachment("b.txt", "beta")]);
      expect(await store.listOperationFiles("op-1")).toHaveLength(2);
      const loaded = await store.load("op-1", [await store.save("op-1", [attachment("c.txt", "gamma")]).then((r) => r[0]!)]);
      expect(new TextDecoder().decode(loaded[0]!.content)).toBe("gamma");
    });

    it("stages, finalizes and aborts sessions", async () => {
      const store = new InMemoryAttachmentStore();
      const session = await store.stage("op-1", [attachment("a.txt", "alpha")]);
      expect(session.operation_id).toBe("op-1");
      expect(await store.listStagedSessions()).toHaveLength(1);
      expect(await store.listOperationFiles("op-1")).toEqual([]);

      const refs = await store.finalize(session);
      expect(refs).toHaveLength(1);
      expect(await store.listStagedSessions()).toHaveLength(0);
      expect(await store.listOperationFiles("op-1")).toEqual([refs[0]!.id]);

      const session2 = await store.stage("op-2", [attachment("b.txt", "beta")]);
      await store.abort(session2);
      expect(await store.listStagedSessions()).toHaveLength(0);
      await expect(store.finalize(session2)).rejects.toMatchObject({ code: "ATTACHMENT_STAGING_SESSION_MISSING" });
    });
  });

  describe("FileAttachmentStore", () => {
    it("saves content-addressed files and loads them back", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const refs = await store.save("op-1", [attachmentWithType("a.txt", "alpha", "text/plain")]);
      const directory = path.join(root, "project-x", ".workspace", "attachments", "op-1");
      expect(await readFile(path.join(directory, refs[0]!.id), "utf8")).toBe("alpha");
      const loaded = await store.load("op-1", refs);
      expect(new TextDecoder().decode(loaded[0]!.content)).toBe("alpha");
      expect(loaded[0]!.media_type).toBe("text/plain");
      expect(loaded[0]!.name).toBe("a.txt");
      expect(await store.listOperationFiles("op-1")).toEqual([refs[0]!.id]);
    });

    it("throws ATTACHMENT_NOT_FOUND when a referenced file is missing", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const refs = await store.save("op-1", [attachment("a.txt", "alpha")]);
      await rm(path.join(root, "project-x", ".workspace", "attachments", "op-1", refs[0]!.id));
      await expect(store.load("op-1", refs)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    });

    it("reports available and missing inspection entries", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const refs = await store.save("op-1", [attachment("a.txt", "alpha")]);
      const inspected = await store.inspect("op-1", [refs[0]!, { ...refs[0]!, id: "absent" }]);
      expect(inspected).toEqual([
        { id: refs[0]!.id, name: "a.txt", available: true },
        { id: "absent", name: "a.txt", available: false },
      ]);
    });

    it("stages into a hidden staging root with a manifest and finalizes into the operation directory", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const session = await store.stage("op-1", [attachment("a.txt", "alpha")]);
      const stagingRoot = path.join(root, "project-x", ".workspace", "attachments", ".staging");
      const stagingDir = path.join(stagingRoot, session.session_id);
      const manifest = JSON.parse(await readFile(path.join(stagingDir, "manifest.json"), "utf8")) as { session_id: string; operation_id: string; refs: Array<{ id: string }> };
      expect(manifest.session_id).toBe(session.session_id);
      expect(manifest.operation_id).toBe("op-1");
      expect(manifest.refs).toHaveLength(1);
      expect(await readFile(path.join(stagingDir, manifest.refs[0]!.id), "utf8")).toBe("alpha");

      const listed = await store.listStagedSessions();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ operation_id: "op-1" });

      const refs = await store.finalize(session);
      await expect(readdir(path.join(stagingRoot, session.session_id))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(stagingRoot)).toEqual([]);
      expect(await readFile(path.join(root, "project-x", ".workspace", "attachments", "op-1", refs[0]!.id), "utf8")).toBe("alpha");
    });

    it("abort removes only the staged session directory", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const session = await store.stage("op-1", [attachment("a.txt", "alpha")]);
      await store.abort(session);
      expect(await store.listStagedSessions()).toEqual([]);
      expect(await store.listOperationFiles("op-1")).toEqual([]);
    });

    it("ignores ENOENT when finalizing a missing staged file", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const session = await store.stage("op-1", [attachment("a.txt", "alpha")]);
      const stagingDir = path.join(root, "project-x", ".workspace", "attachments", ".staging", session.session_id);
      await rm(path.join(stagingDir, session.refs[0]!.id));
      await expect(store.finalize(session)).resolves.toHaveLength(1);
      expect(await store.listStagedSessions()).toEqual([]);
    });

    it("cleans staged files and throws ATTACHMENT_FINALIZE_FAILED when the rename cannot happen", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      const session = await store.stage("op-1", [attachment("a.txt", "alpha")]);
      const destination = path.join(root, "project-x", ".workspace", "attachments", "op-1");
      await mkdir(path.join(destination, session.refs[0]!.id), { recursive: true });
      await expect(store.finalize(session)).rejects.toMatchObject({ code: "ATTACHMENT_FINALIZE_FAILED" });
      expect(await readdir(path.join(root, "project-x", ".workspace", "attachments", ".staging"))).toEqual([]);
    });

    it("lists staged sessions with fallbacks for a broken manifest and an empty root", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      expect(await store.listStagedSessions()).toEqual([]);

      const stagingRoot = path.join(root, "project-x", ".workspace", "attachments", ".staging");
      await mkdir(path.join(stagingRoot, "broken-session"), { recursive: true });
      await writeFile(path.join(stagingRoot, "broken-session", "manifest.json"), "not json");
      const listed = await store.listStagedSessions();
      expect(listed).toEqual([{ session_id: "broken-session", operation_id: "", refs: [] }]);

      await mkdir(path.join(stagingRoot, "other"), { recursive: true });
      const withSession = await store.listStagedSessions();
      expect(withSession).toHaveLength(2);
    });

    it("keeps operation directories readable for legacy safe operation ids", async () => {
      const root = await tempRoot();
      const store = new FileAttachmentStore(root, "project-x");
      await store.save("legacy-op", [attachment("a.txt", "alpha")]);
      expect(await readdir(path.join(root, "project-x", ".workspace", "attachments", "legacy-op"))).toHaveLength(1);
    });
  });

  describe("safeOperationIdSegment", () => {
    it("passes safe single segments through unchanged", () => {
      expect(safeOperationIdSegment("op-1")).toBe("op-1");
      expect(safeOperationIdSegment("a.b_c")).toBe("a.b_c");
      expect(safeOperationIdSegment("A1")).toBe("A1");
    });

    it("hashes hostile, dot and overlong values", () => {
      const hash = (value: string) => contentHash(value);
      expect(safeOperationIdSegment("")).toBe(hash(""));
      expect(safeOperationIdSegment(".")).toBe(hash("."));
      expect(safeOperationIdSegment("..")).toBe(hash(".."));
      expect(safeOperationIdSegment(".hidden")).toBe(hash(".hidden"));
      expect(safeOperationIdSegment("a/b")).toBe(hash("a/b"));
      expect(safeOperationIdSegment("a\\b")).toBe(hash("a\\b"));
      expect(safeOperationIdSegment("C:\\evil")).toBe(hash("C:\\evil"));
      expect(safeOperationIdSegment("..\\..\\outside")).toBe(hash("..\\..\\outside"));
      expect(safeOperationIdSegment("with space")).toBe(hash("with space"));
      expect(safeOperationIdSegment("a".repeat(200))).toBe("a".repeat(200));
      expect(safeOperationIdSegment("a".repeat(201))).toBe(hash("a".repeat(201)));
    });
  });

  describe("Blob stores", () => {
    it("MemoryBlobStore puts, gets and checks blobs", async () => {
      const store = new MemoryBlobStore();
      await store.put("abc", byte("payload"));
      expect(await store.has("abc")).toBe(true);
      expect(await store.has("nope")).toBe(false);
      expect(new TextDecoder().decode(await store.get("abc"))).toBe("payload");
      expect(await store.get("nope")).toBeUndefined();
    });

    it("FileBlobStore persists blobs and reports missing blobs", async () => {
      const root = await tempRoot();
      const store = new FileBlobStore(path.join(root, "blobs"));
      await store.put("abc", byte("payload"));
      expect(await store.has("abc")).toBe(true);
      expect(await store.has("nope")).toBe(false);
      expect(new TextDecoder().decode((await store.get("abc")) ?? new Uint8Array())).toBe("payload");
      expect(await store.get("nope")).toBeUndefined();
      expect(await readFile(path.join(root, "blobs", "abc"), "utf8")).toBe("payload");
    });
  });

  describe("fact taxonomy", () => {
    it("classifies coverage dimensions and inputs", () => {
      expect(isFactCoverageDimension("identity")).toBe(true);
      expect(isFactCoverageDimension("appearance")).toBe(true);
      expect(isFactCoverageDimension("character")).toBe(false);
      expect(isFactCoverageDimension("bogus")).toBe(false);
      expect(isFactCoverageInput("character")).toBe(true);
      expect(isFactCoverageInput("identity")).toBe(true);
      expect(isFactCoverageInput("bogus")).toBe(false);
      expect(requiredCoverageForClassification("identity")).toBe("identity");
      expect(requiredCoverageForClassification("trait")).toBe("personality");
      expect(requiredCoverageForClassification("event")).toBe("background");
      expect(requiredCoverageForClassification("relationship")).toBe("relationships");
      expect(requiredCoverageForClassification("world")).toBe("world_context");
      expect(requiredCoverageForClassification("speech")).toBeUndefined();
    });
  });
});
