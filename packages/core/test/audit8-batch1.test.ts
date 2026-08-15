import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAttachmentStore, FileProjectRepository, contentHash, safeOperationIdSegment } from "@st-workspace/core";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SAFE_HEX = /^[a-f0-9]{64}$/u;

describe("#102 safeOperationIdSegment", () => {
  it("keeps safe internal-style operation ids unchanged", () => {
    for (const id of ["op-upload", "op_0c0f7b56-2c7f-4c3e-9a11-5d3f5c9b4a00", "op_precheck", "batch5-server.a-b_1"]) {
      expect(safeOperationIdSegment(id)).toBe(id);
    }
  });

  it("hashes path-traversal and unsafe operation ids", () => {
    for (const id of ["../", "..\\", "a/b", "a\\b", "C:\\x", "\\\\server\\share", "%2e%2e%2f", "", ".hidden", "..", ".", "a b", "op\u0000id", "x".repeat(201)]) {
      const segment = safeOperationIdSegment(id);
      expect(segment).toMatch(SAFE_HEX);
      expect(segment).not.toBe(id);
    }
  });

  it("produces distinct stable hashes that are independent of the caller string", () => {
    expect(safeOperationIdSegment("../")).toBe(contentHash("../"));
    expect(safeOperationIdSegment("..\\")).toBe(contentHash("..\\"));
    expect(safeOperationIdSegment("../")).not.toBe(safeOperationIdSegment("..\\"));
  });
});

describe("#102 FileAttachmentStore constrains operation ids", () => {
  async function attachmentFiles(root: string): Promise<string[]> {
    const dir = path.join(root, "project-001", ".workspace", "attachments");
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  it("never writes outside the attachments root for hostile operation ids", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-attach-safe-"));
    roots.push(root);
    const repository = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    await repository.read();
    const store = new FileAttachmentStore(repository);
    const payload = [{ name: "card.json", content: new TextEncoder().encode("{\"name\":\"Safe\"}") }];

    for (const hostile of ["../../evil", "..\\evil", "C:\\outside", "\\\\server\\share", "a/b", "%2e%2e%2f"]) {
      const refs = await store.save(hostile, payload);
      expect(refs).toHaveLength(1);
      const loaded = await store.load(hostile, refs);
      expect(new TextDecoder().decode(loaded[0]?.content)).toContain("Safe");
      const dirs = await attachmentFiles(root);
      expect(dirs).toContain(safeOperationIdSegment(hostile));
      expect(dirs).not.toContain("evil");
      expect(dirs).not.toContain("..");
    }

    const outsideProbe = path.join(root, "evil");
    const entries = await readdir(root);
    expect(entries).not.toContain("evil");
    await expect(readdir(outsideProbe)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(path.join(root, "outside"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still reads legacy safe operation directories created with plain ids", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-attach-legacy-"));
    roots.push(root);
    const repository = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    const store = new FileAttachmentStore(repository);
    const refs = await store.save("op-upload", [{ name: "note.txt", content: new TextEncoder().encode("legacy") }]);
    const loaded = await store.load("op-upload", refs);
    expect(new TextDecoder().decode(loaded[0]?.content)).toBe("legacy");
  });

  it("maps unsafe ids to a subdirectory inside the attachments root and keeps inspect working", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-attach-inspect-"));
    roots.push(root);
    const repository = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    await repository.read();
    const store = new FileAttachmentStore(repository);
    const refs = await store.save("../../escape", [{ name: "a.txt", content: new TextEncoder().encode("x") }]);
    const segment = safeOperationIdSegment("../../escape");
    expect(segment).toMatch(SAFE_HEX);
    const inspected = await store.inspect("../../escape", refs);
    expect(inspected).toHaveLength(1);
    const dir = path.join(root, "project-001", ".workspace", "attachments", segment);
    expect((await readdir(dir)).length).toBeGreaterThan(0);
    const raw = await mkdir(path.join(root, "project-001", ".workspace", "attachments", "op-raw"), { recursive: true });
    expect(raw).toBeDefined();
  });
});
