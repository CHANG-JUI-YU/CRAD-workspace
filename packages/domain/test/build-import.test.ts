import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileProjectRepository,
  MemoryProjectRepository,
  contentHash,
  type ArtifactRecord,
  type OperationRecord,
} from "@st-workspace/core";
import { BuildService, ImportService } from "../src/index.js";

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind, request: kind, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function artifact(operationId: string, content: string): ArtifactRecord {
  const hash = contentHash(content);
  return { id: "artifact-1", key: "character:yukino", kind: "character", name: "Yukino", content, media_type: "text/markdown", content_hash: hash, revision: hash, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "writer", operation_id: operationId };
}

function jsonArtifact(id: string, key: string, kind: ArtifactRecord["kind"], name: string, value: unknown, operationId = "op-author"): ArtifactRecord {
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id, key, kind, name, content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "writer", operation_id: operationId };
}

describe("build, publish and import", () => {
  it("publishes the named card export as a Tavern-loadable CCv3 envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-export-card-"));
    try {
      const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      await repository.read();
      const characterContent = JSON.stringify({
        kind: "character",
        document: {
          schema_version: 1,
          id: "momoka",
          display_name: "一條桃華",
          aliases: [],
          summary: "A complete character.",
          relationships: [],
          sections: [{ id: "personality", title: "Personality", content: "Calm and direct.", provenance: [], extensions: {} }],
          provenance: [],
          extensions: {},
        },
      });
      const zhujiContent = JSON.stringify({
        kind: "zhuji",
        character_id: "momoka",
        module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { description: "A recognizable appearance." } },
      });
      const zhujiHash = contentHash(zhujiContent);
      await repository.commit(0, (state) => ({
        ...state,
        project_name: "一條桃華",
        artifacts: [
          artifact("op-author", characterContent),
          { id: "artifact-zhuji", key: "zhuji:momoka/appearance", kind: "zhuji", name: "momoka/appearance", content: zhujiContent, media_type: "application/json", content_hash: zhujiHash, revision: zhujiHash, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "writer", operation_id: "op-author" },
        ],
        operations: [operation("op-publish", "build")],
      }));

      const result = await new BuildService(repository).run("op-publish", "publish current card", "publisher");
      expect(result.status).toBe("completed");
      const output = JSON.parse(await readFile(path.join(root, "demo", "exports", "一條桃華-珠璣角色卡.json"), "utf8")) as Record<string, unknown>;
      expect(output).toMatchObject({ spec: "chara_card_v3", spec_version: "3.0", data: { name: "一條桃華" } });
      expect(output).not.toHaveProperty("zhuji_modules");
      expect((await readFile(path.join(root, "demo", "exports", "一條桃華-珠璣角色卡.png"))).byteLength).toBeGreaterThan(0);
      await expect(readFile(path.join(root, "demo", "exports", "ccv3.json"))).rejects.toThrow();
      await expect(readFile(path.join(root, "demo", "exports", "card.json"))).rejects.toThrow();
      await expect(readFile(path.join(root, "demo", "exports", "manifest.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates deterministic preview and transactional publish", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, artifacts: [artifact("op-author", "A complete character with personality and goals.")], operations: [operation("op-build", "build")] }));
    const service = new BuildService(repository);
    const preview = await service.run("op-build", "preview current card", "builder");
    expect(preview.status).toBe("completed");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-publish", "build")] }));
    const publish = await service.run("op-publish", "publish current card", "publisher");
    expect(publish.status).toBe("completed");
    const state = await repository.read();
    expect(state.publishes).toHaveLength(1);
    expect(state.publishes[0]?.content_hash).toBe(state.builds[1]?.content_hash);
    expect(state.project_status).toBe("published");
  });

  it("asks for the mode on every dual-mode build and resumes the same operation after selection", async () => {
    const repository = new MemoryProjectRepository("mode-choice");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Mode Choice",
      artifacts: [
        jsonArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", {
          kind: "zhuji",
          character_id: "demo",
          module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } },
        }),
        jsonArtifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", {
          kind: "palette",
          character_id: "demo",
          module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" },
        }),
      ],
      operations: [operation("op-mode-1", "build")],
    }));
    const service = new BuildService(repository);
    const first = await service.run("op-mode-1", "preview current card", "builder");
    expect(first.status).toBe("needs_input");
    expect(first.summary).toContain("珠璣");
    expect((await repository.read()).operations.find((item) => item.id === "op-mode-1")?.status).toBe("needs_input");

    const selected = await service.run("op-mode-1", "preview current card", "builder", { mode_selection: "zhuji" });
    expect(selected.status).toBe("completed");
    expect(selected.mode_selection).toBe("zhuji");
    const afterSelection = await repository.read();
    expect(afterSelection.builds).toHaveLength(1);
    const builtCard = JSON.parse(afterSelection.builds[0]?.canonical_ir ?? "{}") as { data?: { character_book?: { entries?: Array<{ name: string }> } } };
    expect(builtCard.data?.character_book?.entries?.map((entry) => entry.name)).toEqual(["demo_外觀"]);
    expect(afterSelection.operations.find((item) => item.id === "op-mode-1")?.status).toBe("completed");

    await repository.commit(afterSelection.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-mode-2", "build")] }));
    const secondBuild = await service.run("op-mode-2", "preview current card", "builder");
    expect(secondBuild.status).toBe("needs_input");
    expect((await repository.read()).builds).toHaveLength(1);
  });

  it("does not publish when an effective blocking issue exists", async () => {
    const repository = new MemoryProjectRepository("demo");
    const target = artifact("op-author", "TODO unfinished card");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [target],
      issues: [{ id: "issue-1", artifact_id: target.id, review_id: "review-1", code: "PLACEHOLDER_REMAINS", message: "unfinished", severity: "error", effective_severity: "error", status: "open", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      operations: [operation("op-publish", "build"), operation("op-other", "build")],
    }));
    const result = await new BuildService(repository).run("op-publish", "publish", "publisher");
    expect(result.status).toBe("blocked");
    expect((await repository.read()).publishes).toHaveLength(0);
  });

  it("stops a managed publish before compilation when the workflow gate is incomplete", async () => {
    const repository = new MemoryProjectRepository("managed-gate");
    const target = artifact("op-author", "A complete character with personality and goals.");
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      artifacts: [target],
      operations: [operation("op-managed-publish", "build")],
    }));
    const result = await new BuildService(repository).run("op-managed-publish", "publish", "publisher");
    expect(result.status).toBe("blocked");
    expect((await repository.read()).publishes).toHaveLength(0);
  });

  it("supports the four-level quality policy and records a build snapshot", async () => {
    const repository = new MemoryProjectRepository("demo");
    const target = artifact("op-author", "TODO unfinished card");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [target],
      issues: [{ id: "issue-none", artifact_id: target.id, review_id: "review-none", code: "PLACEHOLDER_REMAINS", message: "unfinished", severity: "error", effective_severity: "error", status: "open", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      quality_profile: { level: "none", blocking_severity: "none", overrides: {}, override_audit: [] },
      operations: [operation("op-none", "build")],
    }));
    const result = await new BuildService(repository).run("op-none", "publish", "publisher");
    expect(result.status).toBe("completed");
    expect((await repository.read()).builds[0]?.quality_policy_snapshot).toMatchObject({ level: "none", blocking_severity: "none" });
  });

  it("asks for an artifact before building and rejects unknown operations", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-empty-build", "build"), operation("op-other", "build")] }));
    const service = new BuildService(repository);
    expect((await service.run("op-empty-build", "preview", "builder")).status).toBe("needs_input");
    await expect(service.run("missing-build", "preview", "builder")).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });

  it("supports dry-run import and retains unknown fields", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-import", "import")] }));
    const attachment = { name: "card.json", content: new TextEncoder().encode(JSON.stringify({ name: "Yukino", description: "A card", unexpected: { keep: true } })) };
    const service = new ImportService(repository);
    const dryRun = await service.run("op-import", "import dry-run", "importer", [attachment]);
    expect(dryRun.status).toBe("completed");
    let state = await repository.read();
    expect(state.artifacts).toHaveLength(0);
    expect(state.imports[0]?.report.join(" ")).toContain("unexpected");
    await repository.commit(state.revision, (current) => ({ ...current, operations: [...current.operations, operation("op-import-real", "import")] }));
    const imported = await service.run("op-import-real", "import card", "importer", [attachment]);
    expect(imported.artifact_id).toBeDefined();
    state = await repository.read();
    expect(state.artifacts[0]?.content).toContain("unexpected");
  });

  it("asks for an attachment and preserves invalid-input diagnostics", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-no-attachment", "import"), operation("op-invalid", "import")] }));
    const service = new ImportService(repository);
    expect((await service.run("op-no-attachment", "import card", "importer", [])).status).toBe("needs_input");
    const invalid = await service.run("op-invalid", "import card", "importer", [{ name: "bad.json", content: new TextEncoder().encode("not json") }]);
    expect(invalid.status).toBe("needs_input");
    expect((await repository.read()).imports.find((item) => item.original_name === "bad.json")?.status).toBe("failed");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-array", "import")] }));
    const invalidRoot = await service.run("op-array", "import card", "importer", [{ name: "array.json", content: new TextEncoder().encode("[]") }]);
    expect(invalidRoot.status).toBe("needs_input");
  });

  it("derives an artifact name from the file when the imported JSON has none", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-name-fallback", "import")] }));
    const result = await new ImportService(repository).run("op-name-fallback", "import card", "importer", [{ name: "fallback-card.json", content: new TextEncoder().encode(JSON.stringify({ description: "A complete card without a name" })) }]);
    expect(result.status).toBe("completed");
    expect((await repository.read()).artifacts[0]?.name).toBe("fallback-card");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-character-name", "import"), operation("op-char-name", "import"), operation("op-punctuation-name", "import")] }));
    expect((await new ImportService(repository).run("op-character-name", "import", "importer", [{ name: "character-name.json", content: new TextEncoder().encode(JSON.stringify({ character_name: "Character Name", description: "A complete card" })) }])).status).toBe("completed");
    expect((await new ImportService(repository).run("op-char-name", "import", "importer", [{ name: "char-name.json", content: new TextEncoder().encode(JSON.stringify({ char_name: "Char Name", description: "A complete card" })) }])).status).toBe("completed");
    expect((await new ImportService(repository).run("op-punctuation-name", "import", "importer", [{ name: "!!!", content: new TextEncoder().encode(JSON.stringify({ description: "A complete card" })) }])).status).toBe("completed");
    await expect(new ImportService(repository).run("missing-import", "import", "importer", [])).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });
});
