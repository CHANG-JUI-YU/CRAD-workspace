import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAttachmentStore, FileProjectRepository } from "@st-workspace/core";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileAttachmentStore", () => {
  it("resolves attachments from the repository directory after a rename", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-attach-rename-"));
    roots.push(root);
    const repository = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    const store = new FileAttachmentStore(repository);
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({ ...current, project_name: "改名專案", project_slug: "改名專案", project_status: "ready" }));

    const refs = await store.save("op-upload", [{ name: "card.json", content: new TextEncoder().encode("{\"name\":\"Legacy\"}") }]);
    expect(refs).toHaveLength(1);
    await repository.relocate("改名專案");

    const loaded = await store.load("op-upload", refs);
    expect(loaded[0]?.name).toBe("card.json");
    expect(new TextDecoder().decode(loaded[0]?.content)).toContain("Legacy");
    expect(repository.projectDirectory).toContain("改名專案");
  });

  it("keeps attachments at the fixed path when constructed with a root and id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-attach-fixed-"));
    roots.push(root);
    const store = new FileAttachmentStore(root, "project-001");
    const refs = await store.save("op-upload", [{ name: "note.txt", content: new TextEncoder().encode("hello") }]);
    const loaded = await store.load("op-upload", refs);
    expect(new TextDecoder().decode(loaded[0]?.content)).toBe("hello");
    await expect(store.load("op-upload", [{ id: "missing", name: "nope.txt" }])).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });
});
