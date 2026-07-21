import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { initializeProject } from "@card-workspace/project";
import { projectManifestSchema, sourceManifestSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSourceRevisionEvent,
  eventSemanticRevision,
  getSourceRevision,
  intakeLocalSource,
  intakeRetrievedSource,
  IngestionError,
  listSources,
  sourceRevision,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function project() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "intake-demo",
      title: "Intake Demo",
      kind: "character_card",
      card: { name: "Demo" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  return { workspace, projectRoot };
}

function localOptions(projectRoot: string, filePath: string, sourceId = "novel") {
  return { projectRoot, filePath, sourceId, title: "Novel", actor: "tester" };
}

describe("source intake", () => {
  it("event ID 與 aggregate semantic revision 不受 timestamp 影響", () => {
    const common = {
      sourceId: "novel",
      actor: "tester",
      sequence: 1,
      payload: { source_revision_id: sourceRevision(Buffer.from("same")) },
    };
    const first = createSourceRevisionEvent({ ...common, timestamp: "2026-07-13T10:00:00.000Z" });
    const retry = createSourceRevisionEvent({ ...common, timestamp: "2026-07-13T11:00:00.000Z" });
    expect(retry.id).toBe(first.id);
    expect(eventSemanticRevision(retry)).toBe(eventSemanticRevision(first));
  });

  it("匯入 workspace 外明確單檔，使用 digest 路徑並寫 compact canonical event", async () => {
    const { workspace, projectRoot } = await project();
    const filePath = path.join(workspace.root, "outside.md");
    await writeFile(filePath, "甲\r\n乙\n", "utf8");

    const result = await intakeLocalSource(localOptions(projectRoot, filePath));
    const digest = result.revision.id.slice("sha256:".length);
    expect(result.idempotent).toBe(false);
    expect(result.revision.snapshot.path).toBe(`sources/snapshots/novel/${digest}.md`);
    expect(result.revision.snapshot.path).not.toContain("sha256:");
    expect(result.revision.normalizer_id).toBe("utf8-newline");
    expect(result.projection.text).toBe("甲\n乙\n");
    expect(result.projection.normalized_hash).toBe(result.revision.normalized_hash);
    expect(result.revision.projection_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.projection.line_map).toMatchObject({ coordinate_space: "raw_snapshot" });
    expect(result.projection.mappings[0]).toMatchObject({
      evidence_kind: "raw_snapshot",
      normalized_character_range: [0, 4],
      raw_byte_range: [0, 9],
    });
    await expect(readFile(path.join(projectRoot, result.revision.snapshot.path), "utf8")).resolves.toBe("甲\r\n乙\n");
    expect(await listSources(projectRoot)).toEqual([result.source]);
    expect((await getSourceRevision(projectRoot, "novel")).id).toBe(result.revision.id);

    const journal = await readFile(path.join(projectRoot, "sources/journals/source-events.jsonl"), "utf8");
    const lines = journal.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      id: result.eventId,
      kind: "source.revision_added",
      aggregate_id: "novel",
      sequence: 1,
    });
    expect(lines[0]).not.toContain("  ");
  });

  it("同 Source 同 bytes 完全 idempotent；新 bytes 建立新 immutable revision", async () => {
    const { workspace, projectRoot } = await project();
    const filePath = path.join(workspace.root, "source.txt");
    await writeFile(filePath, "first", "utf8");
    const first = await intakeLocalSource(localOptions(projectRoot, filePath));
    const retry = await intakeLocalSource(localOptions(projectRoot, filePath));
    expect(retry.idempotent).toBe(true);
    expect(retry.eventId).toBeUndefined();
    await writeFile(filePath, "second", "utf8");
    const second = await intakeLocalSource(localOptions(projectRoot, filePath));
    expect(second.revision.id).not.toBe(first.revision.id);
    expect(second.source.revision_ids).toEqual([first.revision.id, second.revision.id]);
    await expect(readFile(path.join(projectRoot, first.revision.snapshot.path), "utf8")).resolves.toBe("first");
    const journal = await readFile(path.join(projectRoot, "sources/journals/source-events.jsonl"), "utf8");
    expect(journal.trimEnd().split("\n")).toHaveLength(2);
  });

  it("不同 Source 可共享 content hash，但保有分離 artifact 與身份", async () => {
    const { workspace, projectRoot } = await project();
    const filePath = path.join(workspace.root, "shared.txt");
    await writeFile(filePath, "shared", "utf8");
    const left = await intakeLocalSource(localOptions(projectRoot, filePath, "left"));
    const right = await intakeLocalSource(localOptions(projectRoot, filePath, "right"));
    expect(left.revision.id).toBe(right.revision.id);
    expect(left.revision.snapshot.path).not.toBe(right.revision.snapshot.path);
    expect((await listSources(projectRoot)).map((source) => source.id)).toEqual(["left", "right"]);
  });

  it("Retrieved source 保存並要求 URL 與 fetched metadata", async () => {
    const { projectRoot } = await project();
    const result = await intakeRetrievedSource({
      projectRoot,
      sourceId: "web-page",
      title: "Page",
      bytes: Buffer.from("page"),
      requestedUrl: "https://example.test/start",
      canonicalUrl: "https://example.test/page",
      fetchedAt: "2026-07-13T10:00:00.000Z",
      mediaType: "text/plain",
    });
    expect(result.revision.origin).toEqual({
      kind: "retrieved",
      uri: "https://example.test/page",
      requested_url: "https://example.test/start",
      canonical_url: "https://example.test/page",
      fetched_at: "2026-07-13T10:00:00.000Z",
    });
    await expect(
      intakeRetrievedSource({
        projectRoot,
        sourceId: "bad-web",
        title: "Bad",
        bytes: Buffer.from("bad"),
        requestedUrl: "not-url",
        canonicalUrl: "https://example.test",
        fetchedAt: "no-timezone",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_URL_INVALID" });
  });

  it("structured projection 明確標記 projection evidence，且不偽造 raw byte range", async () => {
    const { workspace, projectRoot } = await project();
    const filePath = path.join(workspace.root, "structured.json");
    await writeFile(filePath, JSON.stringify({ text: "甲\r\n乙" }), "utf8");
    const result = await intakeLocalSource({
      ...localOptions(projectRoot, filePath, "structured"),
      format: "json",
    });
    expect(result.projection.text).toBe("甲\n乙");
    expect(result.projection.line_map?.coordinate_space).toBe("extracted_projection");
    expect(result.projection.mappings).toEqual([expect.objectContaining({
      evidence_kind: "field_projection",
      normalized_character_range: [0, 3],
      field_path: ["text"],
    })]);
    expect(result.projection.mappings[0]?.raw_byte_range).toBeUndefined();
  });

  it("拒絕 glob、directory、symlink、危險 ID 與超大 stat size", async () => {
    const { workspace, projectRoot } = await project();
    const target = path.join(workspace.root, "target.txt");
    const link = path.join(workspace.root, "link.txt");
    await writeFile(target, "target", "utf8");
    let linked = true;
    try {
      await symlink(target, link, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      linked = false;
    }
    await expect(intakeLocalSource(localOptions(projectRoot, "*.txt"))).rejects.toMatchObject({
      code: "SOURCE_PATH_NOT_EXPLICIT",
    });
    await expect(intakeLocalSource(localOptions(projectRoot, workspace.root))).rejects.toMatchObject({
      code: "SOURCE_NOT_REGULAR_FILE",
    });
    if (linked) {
      await expect(intakeLocalSource(localOptions(projectRoot, link))).rejects.toMatchObject({
        code: "SOURCE_SYMLINK_DENIED",
      });
    }
    await expect(intakeLocalSource(localOptions(projectRoot, target, "../escape"))).rejects.toMatchObject({
      code: "SOURCE_ID_INVALID",
    });
  });

  it("交易故障不留下 snapshot/revision/projection/event 半套", async () => {
    const { workspace, projectRoot } = await project();
    const filePath = path.join(workspace.root, "failure.txt");
    const bytes = Buffer.from("failure");
    await writeFile(filePath, bytes);
    const digest = sourceRevision(bytes).slice("sha256:".length);
    try {
      await intakeLocalSource({
        ...localOptions(projectRoot, filePath),
        beforePublish: (index) => {
          if (index === 2) throw new Error("injected failure");
        },
      });
      throw new Error("預期 intake 交易失敗");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect(error).toMatchObject({ code: "SOURCE_INTAKE_FAILED" });
      expect((error as IngestionError).originalError).toMatchObject({ message: "injected failure" });
    }
    await expect(readFile(path.join(projectRoot, `sources/snapshots/novel/${digest}.txt`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, `sources/revisions/novel/${digest}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, `sources/projections/novel/${digest}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, "sources/journals/source-events.jsonl"), "utf8")).resolves.toBe("");
    const manifest = sourceManifestSchema.parse(
      parseYaml(await readFile(path.join(projectRoot, "sources/manifest.yaml"), "utf8")),
    );
    expect(manifest.sources).toEqual([]);
  });

  it("不修補遭篡改的 immutable snapshot", async () => {
    const { workspace, projectRoot } = await project();
    const filePath = path.join(workspace.root, "tamper.txt");
    await writeFile(filePath, "original", "utf8");
    const result = await intakeLocalSource(localOptions(projectRoot, filePath));
    await writeFile(path.join(projectRoot, result.revision.snapshot.path), "tampered", "utf8");
    await expect(getSourceRevision(projectRoot, "novel")).rejects.toMatchObject({
      code: "SNAPSHOT_HASH_MISMATCH",
    });
    await expect(intakeLocalSource(localOptions(projectRoot, filePath))).rejects.toMatchObject({
      code: "SNAPSHOT_HASH_MISMATCH",
    });
  });
});
