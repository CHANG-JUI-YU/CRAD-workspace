import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compileProject } from "@st-workspace/compiler";
import {
  FileProjectRepository,
  MemoryProjectRepository,
  contentHash,
  qualityProfileForLevel,
  type ArtifactRecord,
  type OperationRecord,
} from "@st-workspace/core";
import { BuildService, ImportService } from "../src/index.js";

const compilerReal = vi.hoisted(() => ({ compile: null as (() => Promise<unknown>) | null }));
vi.mock("@st-workspace/compiler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@st-workspace/compiler")>();
  compilerReal.compile = actual.compileProject as unknown as () => Promise<unknown>;
  return {
    ...actual,
    compileProject: vi.fn((state: Parameters<typeof actual.compileProject>[0], options?: Parameters<typeof actual.compileProject>[1]) => actual.compileProject(state, options)),
  };
});

function injectCompilerError(): void {
  vi.mocked(compileProject).mockImplementationOnce((state, options) => {
    const real = compilerReal.compile as unknown as typeof compileProject;
    const result = real(state, options);
    return { ...result, diagnostics: [...result.diagnostics, { code: "MODE_SELECTION_UNAVAILABLE", severity: "error", message: "injected compiler error" }] };
  });
}

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind, request: kind, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

async function blobJson(repository: MemoryProjectRepository, hash: string | undefined): Promise<Record<string, unknown>> {
  if (hash === undefined) return {};
  const bytes = await repository.readBlob(hash);
  if (bytes === undefined) return {};
  return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as Record<string, unknown>;
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
    expect(state.publishes[0]?.content).toBeUndefined();
    expect(state.publishes[0]?.png_base64).toBeUndefined();
    expect(state.publishes[0]?.content_ref?.hash).toBe(state.publishes[0]?.content_hash);
    const jsonBlob = await repository.readBlob(state.publishes[0]!.content_ref!.hash);
    expect(jsonBlob).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(jsonBlob)) as { spec?: string }).toMatchObject({ spec: "chara_card_v3" });
    const pngBlob = await repository.readBlob(state.publishes[0]!.png_ref!.hash);
    expect(pngBlob).toBeDefined();
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
    expect(afterSelection.builds[0]?.canonical_ir).toBeUndefined();
    expect(afterSelection.builds[0]?.canonical_ir_ref?.hash).toBe(afterSelection.builds[0]?.content_hash);
    const builtCard = await blobJson(repository, afterSelection.builds[0]?.canonical_ir_ref?.hash) as { data?: { character_book?: { entries?: Array<{ name: string }> } } };
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

  it("publishes when the current profile override allows a stored blocking severity", async () => {
    const repository = new MemoryProjectRepository("profile-override-publish");
    const target = artifact("op-author", "TODO unfinished card");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      artifacts: [target],
      reviews: [{ id: "review-current", artifact_id: target.id, artifact_revision: target.revision, reviewer: "character-critic", status: "failed", issue_ids: ["issue-current"], created_at: timestamp }],
      issues: [{ id: "issue-current", artifact_id: target.id, review_id: "review-current", code: "PLACEHOLDER_REMAINS", message: "unfinished", severity: "error", effective_severity: "error", against_effective_severity: "error", status: "open", created_at: timestamp, updated_at: timestamp }],
      quality_profile: qualityProfileForLevel("normal", { PLACEHOLDER_REMAINS: "info" }),
      operations: [operation("op-profile-override", "build")],
    }));
    const result = await new BuildService(repository).run("op-profile-override", "publish", "publisher");
    expect(result.status).toBe("completed");
    expect((await repository.read()).publishes).toHaveLength(1);
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

  it("includes only the selected zhuji artifacts when a mixed project selects zhuji", async () => {
    const repository = new MemoryProjectRepository("mixed-zhuji");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Mixed Project",
      artifacts: [
        jsonArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } } }),
        jsonArtifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" } }),
      ],
      operations: [operation("op-mixed-zhuji", "build")],
    }));
    const result = await new BuildService(repository).run("op-mixed-zhuji", "preview current card", "builder", { mode_selection: "zhuji" });
    expect(result.status).toBe("completed");
    expect(result.mode_selection).toBe("zhuji");
    const state = await repository.read();
    expect(state.builds[0]?.artifact_ids).toEqual(["zhuji-appearance"]);
    expect(state.builds[0]?.canonical_ir).toBeUndefined();
    const zhujiCard = await blobJson(repository, state.builds[0]?.canonical_ir_ref?.hash) as { data?: { character_book?: { entries?: Array<{ name: string }> } } };
    expect(JSON.stringify(zhujiCard)).not.toContain("Palette");
    expect(state.operations.find((item) => item.id === "op-mixed-zhuji")?.status).toBe("completed");
  });

  it("names the export for the selected palette mode instead of any zhuji artifact", async () => {
    const repository = new MemoryProjectRepository("mixed-palette");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Mode Choice",
      quality_profile: qualityProfileForLevel("none"),
      artifacts: [
        artifact("op-author", "A complete character with personality and goals."),
        jsonArtifact("character-demo", "character:demo", "character", "demo", { document: { schema_version: 1, id: "demo", display_name: "Demo", sections: [], provenance: [], extensions: {} } }),
        jsonArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } } }),
        jsonArtifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" } }),
      ],
      operations: [operation("op-mixed-palette", "build")],
    }));
    const result = await new BuildService(repository).run("op-mixed-palette", "publish current card", "publisher", { mode_selection: "palette" });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.publishes[0]?.export_json_path).toBe("exports/Mode-Choice-調色盤角色卡.json");
    expect(state.publishes[0]?.export_png_path).toBe("exports/Mode-Choice-調色盤角色卡.png");
    expect(state.publishes[0]?.export_json_path).not.toContain("珠璣");
  });

  it("fails a both selection when palette is unavailable instead of downgrading", async () => {
    const repository = new MemoryProjectRepository("both-missing-palette");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [
        jsonArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } } }),
      ],
      operations: [operation("op-both-missing", "build")],
    }));
    const result = await new BuildService(repository).run("op-both-missing", "preview current card", "builder", { mode_selection: "both" });
    expect(result.status).toBe("needs_input");
    expect(result.summary).toContain("重新選擇");
    const state = await repository.read();
    expect(state.builds).toHaveLength(0);
    expect(state.operations.find((item) => item.id === "op-both-missing")?.status).toBe("needs_input");
  });

  it("includes both modes when a both selection is fully available", async () => {
    const repository = new MemoryProjectRepository("both-complete");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Both Project",
      artifacts: [
        jsonArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } } }),
        jsonArtifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" } }),
      ],
      operations: [operation("op-both-complete", "build")],
    }));
    const result = await new BuildService(repository).run("op-both-complete", "preview current card", "builder", { mode_selection: "both" });
    expect(result.status).toBe("completed");
    expect(result.mode_selection).toBe("both");
    const state = await repository.read();
    expect(state.builds[0]?.artifact_ids).toEqual(["palette-basic", "zhuji-appearance"]);
    const builtCard = await blobJson(repository, state.builds[0]?.canonical_ir_ref?.hash) as { data?: { character_book?: { entries?: Array<{ name: string }> } } };
    expect(builtCard.data?.character_book?.entries?.map((entry) => entry.name)).toEqual(["demo_基本資訊", "demo_外觀"]);
  });

  it("marks the build failed and blocks the operation when the compiler reports error diagnostics", async () => {
    injectCompilerError();
    const repository = new MemoryProjectRepository("compiler-error-preview");
    await repository.commit(0, (state) => ({ ...state, artifacts: [artifact("op-author", "A complete character.")], operations: [operation("op-error-preview", "build")] }));
    const result = await new BuildService(repository).run("op-error-preview", "preview current card", "builder");
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("Build failed");
    const state = await repository.read();
    expect(state.builds).toHaveLength(1);
    expect(state.builds[0]?.status).toBe("failed");
    expect(state.builds[0]?.diagnostics.join(" ")).toContain("MODE_SELECTION_UNAVAILABLE");
    const op = state.operations.find((item) => item.id === "op-error-preview");
    expect(op?.status).toBe("blocked");
    expect(op?.progress).toContainEqual(expect.objectContaining({ status: "blocked" }));
    expect(state.audit.some((entry) => entry.event === "build.failed")).toBe(true);
    expect(state.publishes).toHaveLength(0);
  });

  it("does not publish or mark the project published when compilation fails during publish", async () => {
    injectCompilerError();
    const repository = new MemoryProjectRepository("compiler-error-publish");
    const target = artifact("op-author", "A complete character.");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      artifacts: [target],
      reviews: [{ id: "review-current", artifact_id: target.id, artifact_revision: target.revision, reviewer: "character-critic", status: "failed", issue_ids: ["issue-current"], created_at: timestamp }],
      issues: [{ id: "issue-current", artifact_id: target.id, review_id: "review-current", code: "PLACEHOLDER_REMAINS", message: "unfinished", severity: "error", effective_severity: "error", against_effective_severity: "error", status: "open", created_at: timestamp, updated_at: timestamp }],
      quality_profile: qualityProfileForLevel("normal", { PLACEHOLDER_REMAINS: "info" }),
      operations: [operation("op-error-publish", "build")],
    }));
    const result = await new BuildService(repository).run("op-error-publish", "publish current card", "publisher");
    expect(result.status).toBe("blocked");
    const state = await repository.read();
    expect(state.publishes).toHaveLength(0);
    expect(state.project_status).not.toBe("published");
    expect(state.builds[0]?.status).toBe("failed");
  });

  it("keeps a successful preview with diagnostics when the compiler only reports warnings", async () => {
    const repository = new MemoryProjectRepository("warning-preview");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Warning Project",
      artifacts: [
        jsonArtifact("blueprint-1", "blueprint:runtime", "blueprint", "runtime", { schema_version: 1, kind: "blueprint", project_id: "runtime-blueprint", flow: "character", collaboration_mode: "independent", characters: [{ id: "demo", label: "Demo", ordinal: 0 }], intake_values: {}, provenance: { blueprint_precheck_id: "precheck-1", checks: [] } }),
        jsonArtifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } } }),
      ],
      operations: [operation("op-warning-preview", "build")],
    }));
    const result = await new BuildService(repository).run("op-warning-preview", "preview current card", "builder");
    expect(result.status).toBe("completed");
    expect(result.summary).toContain("1 個警告");
    const state = await repository.read();
    expect(state.builds[0]?.status).toBe("previewed");
    expect(state.builds[0]?.diagnostics.join(" ")).toContain("PRIMARY_CHARACTER_ID_FALLBACK");
    expect(state.audit.find((entry) => entry.event === "build.previewed")?.details).toMatchObject({ diagnostics: expect.any(Array) });
  });

  it("materializes a palette-named export for a selected palette mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-export-palette-"));
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
      const paletteContent = JSON.stringify({
        kind: "palette",
        character_id: "momoka",
        module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" },
      });
      const zhujiHash = contentHash(zhujiContent);
      const paletteHash = contentHash(paletteContent);
      const timestamp = new Date().toISOString();
      await repository.commit(0, (state) => ({
        ...state,
        project_name: "一條桃華",
        artifacts: [
          artifact("op-author", characterContent),
          { id: "artifact-zhuji", key: "zhuji:momoka/appearance", kind: "zhuji", name: "momoka/appearance", content: zhujiContent, media_type: "application/json", content_hash: zhujiHash, revision: zhujiHash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "writer", operation_id: "op-author" },
          { id: "artifact-palette", key: "palette:momoka/basic_information", kind: "palette", name: "momoka/basic_information", content: paletteContent, media_type: "application/json", content_hash: paletteHash, revision: paletteHash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "writer", operation_id: "op-author" },
        ],
        operations: [operation("op-publish-palette", "build")],
      }));

      const result = await new BuildService(repository).run("op-publish-palette", "publish current card", "publisher", { mode_selection: "palette" });
      expect(result.status).toBe("completed");
      const paletteOutput = JSON.parse(await readFile(path.join(root, "demo", "exports", "一條桃華-調色盤角色卡.json"), "utf8")) as Record<string, unknown>;
      expect(paletteOutput).toMatchObject({ spec: "chara_card_v3", spec_version: "3.0" });
      expect((await readFile(path.join(root, "demo", "exports", "一條桃華-調色盤角色卡.png"))).byteLength).toBeGreaterThan(0);
      await expect(readFile(path.join(root, "demo", "exports", "一條桃華-珠璣角色卡.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("asks for the mode again when both modes are available even if the Blueprint selects one", async () => {
    const repository = new MemoryProjectRepository("mode-ask-again");
    const timestamp = new Date().toISOString();
    const precheck = {
      id: "precheck-mode-ask",
      schema_version: 1,
      project_id: "mode-ask-again",
      operation_id: "interview",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "mode-ask-again", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }], world: { enabled: false }, relationships: { enabled: false } },
      candidate_blueprint_revision: contentHash("bp"),
      checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded" as const,
      created_at: timestamp,
      created_by: "director",
    };
    const characterValue = { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", aliases: [], summary: "A complete character.", relationships: [], sections: [], provenance: [], extensions: {} } };
    const zhujiValue = { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { summary: "Zhuji" } } };
    const paletteValue = { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Palette" } };
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Mode Ask Again",
      blueprint_prechecks: [precheck],
      artifacts: [
        jsonArtifact("character-mode-ask", "character:demo", "character", "demo", characterValue),
        jsonArtifact("zhuji-mode-ask", "zhuji:demo/appearance", "zhuji", "demo/appearance", zhujiValue),
        jsonArtifact("palette-mode-ask", "palette:demo/basic_information", "palette", "demo/basic_information", paletteValue),
      ],
      operations: [operation("op-mode-ask", "build")],
    }));
    const service = new BuildService(repository);
    const result = await service.run("op-mode-ask", "preview current card", "builder");
    expect(result.status).toBe("needs_input");
    expect(result.summary).toContain("Blueprint 選定");
    const state = await repository.read();
    expect(state.audit.some((entry) => entry.event === "build.mode_selection_required")).toBe(true);
    const confirmed = await service.run("op-mode-ask", "preview current card", "builder", { mode_selection: "zhuji" });
    expect(confirmed.status).toBe("completed");
    expect(confirmed.mode_selection).toBe("zhuji");
  });

  it("gates publish against the exact selected mode", async () => {
    const repository = new MemoryProjectRepository("gate-exact-mode");
    const timestamp = new Date().toISOString();
    const precheck = {
      id: "precheck-exact-mode",
      schema_version: 1,
      project_id: "gate-exact-mode",
      operation_id: "interview",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "gate-exact-mode", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "palette" }], world: { enabled: false }, relationships: { enabled: false } },
      candidate_blueprint_revision: contentHash("bp"),
      checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded" as const,
      created_at: timestamp,
      created_by: "director",
    };
    const artifacts = [
      jsonArtifact("character-dem", "character:demo", "character", "demo", { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", aliases: [], summary: "A complete character.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm and direct." }], provenance: [], extensions: {} } }),
      jsonArtifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Calm." } }),
      jsonArtifact("greeting-dem", "greeting:greetings", "greeting", "greetings", { document: { greetings: [{ kind: "primary", content: "Hello there.", character_ids: ["demo"] }] } }),
    ];
    const reviews = artifacts.map((item) => ({ id: `review-${item.id}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "character-critic", status: "passed" as const, issue_ids: [], created_at: timestamp }));
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Gate Exact",
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      quality_profile: qualityProfileForLevel("none"),
      blueprint_prechecks: [precheck],
      artifacts,
      reviews,
      operations: [operation("op-gate-exact", "build")],
    }));
    const result = await new BuildService(repository).run("op-gate-exact", "publish current card", "publisher", { mode_selection: "palette" });
    expect(result.status).toBe("blocked");
    const state = await repository.read();
    expect(state.audit.find((entry) => entry.event === "publish.gate_blocked")?.details).toMatchObject({ codes: expect.arrayContaining(["MODE_MODULES_INCOMPLETE"]) });
    expect(state.publishes).toHaveLength(0);
  });

  it("passes publish for the selected mode even when other-mode modules are incomplete", async () => {
    const repository = new MemoryProjectRepository("publish-selected-mode");
    const timestamp = new Date().toISOString();
    const precheck = {
      id: "precheck-dual",
      schema_version: 1,
      project_id: "publish-selected-mode",
      operation_id: "interview",
      collaboration_mode: "assisted",
      candidate_blueprint: { project_id: "publish-selected-mode", characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }, { id: "beta", label: "Beta", ordinal: 2, mode: "palette" }], world: { enabled: false }, relationships: { enabled: false } },
      candidate_blueprint_revision: contentHash("bp"),
      checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded" as const,
      created_at: timestamp,
      created_by: "director",
    };
    const zhujiModules = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];
    const artifacts = [
      jsonArtifact("character-alpha", "character:alpha", "character", "alpha", { kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", aliases: [], summary: "A complete character.", relationships: [], sections: [], provenance: [], extensions: {} } }),
      jsonArtifact("character-beta", "character:beta", "character", "beta", { kind: "character", document: { schema_version: 1, id: "beta", display_name: "Beta", aliases: [], summary: "A complete character.", relationships: [], sections: [], provenance: [], extensions: {} } }),
      ...zhujiModules.map((module, index) => jsonArtifact(`zhuji-${module}`, `zhuji:alpha/${module}`, "zhuji", `alpha/${module}`, { kind: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module, title: module, data: { summary: `module-${index}` } } })),
      jsonArtifact("greeting-alpha", "greeting:greetings", "greeting", "greetings", { document: { greetings: [{ kind: "primary", content: "Hello alpha.", character_ids: ["alpha"] }] } }),
    ];
    const reviews = artifacts.map((item) => ({ id: `review-${item.id}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "character-critic", status: "passed" as const, issue_ids: [], created_at: timestamp }));
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Selected Mode",
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      quality_profile: qualityProfileForLevel("none"),
      blueprint_prechecks: [precheck],
      artifacts: artifacts.map((item) => ({ ...item, blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision })),
      reviews,
      operations: [operation("op-selected-mode", "build")],
    }));
    const result = await new BuildService(repository).run("op-selected-mode", "publish current card", "publisher", { mode_selection: "zhuji" });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.publishes).toHaveLength(1);
    expect(state.publishes[0]?.export_json_path).toBe("exports/Selected-Mode-珠璣角色卡.json");
  });

  it("imports a YAML card and converts it into the internal Character schema", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-yaml", "import")] }));
    const yaml = "name: Yukino\ndescription: A calm and direct character\npersonality: calm, direct\n";
    const result = await new ImportService(repository).run("op-yaml", "import card", "importer", [{ name: "card.yaml", content: new TextEncoder().encode(yaml), media_type: "text/yaml" }]);
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.imports[0]?.original_name).toBe("card.yaml");
    expect(state.imports[0]?.report.join(" ")).toContain("yaml");
    const parsed = JSON.parse(state.artifacts[0]!.content) as { kind: string; document: { display_name: string; sections: Array<{ title: string }> } };
    expect(parsed.kind).toBe("character");
    expect(parsed.document.display_name).toBe("Yukino");
    expect(parsed.document.sections.map((section) => section.title)).toContain("Personality");
  });

  it("derives the artifact name from the nested CCv3 data.name field", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-nested-name", "import")] }));
    const result = await new ImportService(repository).run("op-nested-name", "import card", "importer", [{ name: "nested.json", content: new TextEncoder().encode(JSON.stringify({ data: { name: "Inner Name", description: "Nested card" }, description: "Outer card" })) }]);
    expect(result.status).toBe("completed");
    expect((await repository.read()).artifacts[0]?.name).toBe("Inner Name");
  });

  it("decodes PNG cards through the injected adapter and preserves the original binary", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-png", "import")] }));
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const service = new ImportService(repository, {
      pngDecoder: async () => ({ authority: "ccv3" as const, card: { name: "PngCard", description: "From png", personality: "quiet" } }),
    });
    const result = await service.run("op-png", "import card", "importer", [{ name: "card.png", content: pngBytes, media_type: "image/png" }]);
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.imports[0]?.report.join(" ")).toContain("png-ccv3");
    expect(state.imports[0]?.original_binary).toBeDefined();
    expect(state.artifacts[0]?.name).toBe("PngCard");
  });

  it("records a failed record when a PNG card cannot be decoded", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-png-fail", "import")] }));
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const service = new ImportService(repository, { pngDecoder: async () => { throw new Error("broken card"); } });
    const result = await service.run("op-png-fail", "import card", "importer", [{ name: "card.png", content: pngBytes, media_type: "image/png" }]);
    expect(result.status).toBe("needs_input");
    expect((await repository.read()).imports[0]?.status).toBe("failed");
  });

  it("imports the valid attachments and records failures for the rest", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-multi", "import")] }));
    const service = new ImportService(repository);
    const result = await service.run("op-multi", "import card", "importer", [
      { name: "good.json", content: new TextEncoder().encode(JSON.stringify({ name: "Good", description: "A good card" })) },
      { name: "bad.json", content: new TextEncoder().encode("not json at all") },
    ]);
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.imports).toHaveLength(2);
    expect(state.imports.find((item) => item.original_name === "good.json")?.status).toBe("imported");
    expect(state.imports.find((item) => item.original_name === "bad.json")?.status).toBe("failed");
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.name).toBe("Good");
  });

  function coverPng(width: number, height: number): Uint8Array {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    function crc32(input: Buffer): number {
      let crc = 0xffffffff;
      for (const byte of input) {
        let value = (crc ^ byte) & 0xff;
        for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        crc = (crc >>> 8) ^ value;
      }
      return (crc ^ 0xffffffff) >>> 0;
    }
    function chunk(type: string, data: Buffer): Buffer {
      const typeBuffer = Buffer.from(type, "ascii");
      const output = Buffer.alloc(data.length + 12);
      output.writeUInt32BE(data.length, 0);
      typeBuffer.copy(output, 4);
      data.copy(output, 8);
      output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
      return output;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([pngSignature, chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
  }

  async function imageProject(images: Array<{ id: string; character_id?: string; blob_hash: string }>) {
    const repository = new MemoryProjectRepository("image-project");
    const timestamp = new Date().toISOString();
    const blueprintContent = JSON.stringify({
      kind: "blueprint",
      project_id: "image-project",
      blueprint_direction: { selected: "calm and direct" },
      characters: [
        { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
        { id: "beta", label: "Beta", ordinal: 2, mode: "zhuji" },
      ],
      primary_character_id: "alpha",
    });
    const blueprintHash = contentHash(blueprintContent);
    const precheck = {
      id: "precheck-image",
      schema_version: 1,
      project_id: "image-project",
      operation_id: "op-precheck",
      collaboration_mode: "assisted",
      candidate_blueprint: JSON.parse(blueprintContent) as Record<string, unknown>,
      candidate_blueprint_revision: blueprintHash,
      checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded" as const,
      created_at: timestamp,
      created_by: "director",
    };
    const zhujiContent = JSON.stringify({
      kind: "zhuji",
      character_id: "alpha",
      module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", data: { description: "A recognizable appearance." } },
    });
    const zhujiHash = contentHash(zhujiContent);
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Image Project",
      artifacts: [
        { id: "artifact-blueprint", key: "blueprint:image-project", kind: "blueprint", name: "image-project", content: blueprintContent, media_type: "application/json", content_hash: blueprintHash, revision: blueprintHash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "director", operation_id: "op-precheck", blueprint_precheck_id: "precheck-image", blueprint_precheck_revision: blueprintHash },
        { id: "artifact-zhuji", key: "zhuji:alpha/appearance", kind: "zhuji", name: "alpha/appearance", content: zhujiContent, media_type: "application/json", content_hash: zhujiHash, revision: zhujiHash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "writer", operation_id: "op-author" },
      ],
      blueprint_prechecks: [precheck],
      images: images.map((image) => ({ ...image, media_type: "image/png", width: 512, height: 768, created_at: timestamp, updated_at: timestamp })),
      operations: [operation("op-build", "build")],
    }));
    return repository;
  }

  it("selects the cover image by the manifest primary and warns when only other characters have images", async () => {
    const repository = await imageProject([{ id: "image-beta", character_id: "beta", blob_hash: contentHash(coverPng(512, 768)) }]);
    await repository.writeBlob(contentHash(coverPng(512, 768)), coverPng(512, 768));
    const service = new BuildService(repository);
    const result = await service.run("op-build", "Preview current card", "worker");
    expect(result.status).toBe("completed");
    const builds = (await repository.read()).builds;
    const diagnostics = builds[0]?.diagnostics ?? [];
    expect(diagnostics.some((item) => item.startsWith("CARD_IMAGE_MISSING"))).toBe(true);
    expect(diagnostics.join(" ")).toContain("primary");
  });

  it("falls back to an unbound image when no primary-bound image exists", async () => {
    const repository = await imageProject([{ id: "image-cover", blob_hash: contentHash(coverPng(512, 768)) }]);
    await repository.writeBlob(contentHash(coverPng(512, 768)), coverPng(512, 768));
    const service = new BuildService(repository);
    const result = await service.run("op-build", "Preview current card", "worker");
    expect(result.status).toBe("completed");
    const builds = (await repository.read()).builds;
    expect(builds[0]?.diagnostics.some((item) => item.startsWith("CARD_IMAGE_MISSING"))).toBe(false);
  });

  it("warns when the selected cover image blob is missing", async () => {
    const repository = await imageProject([{ id: "image-alpha", character_id: "alpha", blob_hash: "c".repeat(64) }]);
    const service = new BuildService(repository);
    const result = await service.run("op-build", "Preview current card", "worker");
    expect(result.status).toBe("completed");
    const builds = (await repository.read()).builds;
    const diagnostics = builds[0]?.diagnostics ?? [];
    expect(diagnostics.some((item) => item.startsWith("CARD_IMAGE_MISSING"))).toBe(true);
    expect(diagnostics.join(" ")).toContain("blob");
  });

  it("parses quoted hashes, block scalars and indented list-of-map continuations in YAML", async () => {
    const repository = new MemoryProjectRepository("yaml-import");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-yaml", "import")] }));
    const yaml = [
      'name: "Yukino #1"',
      "description: |",
      "  Line one.",
      "  Line #two.",
      "personality: >",
      "  First line.",
      "  Second line.",
      "world:",
      "  - key: value",
      "    other: nested",
      "  - key: two",
      "",
    ].join("\n");
    const result = await new ImportService(repository).run("op-yaml", "import card", "importer", [{ name: "card.yaml", content: new TextEncoder().encode(yaml), media_type: "text/yaml" }]);
    expect(result.status).toBe("completed");
    const state = await repository.read();
    const character = state.artifacts.find((item) => item.kind === "character");
    expect(character).toBeDefined();
    const document = JSON.parse(character!.content) as { document: { display_name: string; sections: Array<{ id: string; content: string }> } };
    expect(document.document.display_name).toBe("Yukino #1");
    expect(document.document.sections.find((item) => item.id === "personality")?.content).toBe("First line. Second line.");
    const source = JSON.parse(character!.content) as { document: { extensions: Record<string, { import_source: Record<string, unknown> }> } };
    const raw = source.document.extensions["card-workspace"]?.import_source;
    expect(raw.description).toBe("Line one.\nLine #two.\n");
    const world = raw.world as Array<{ key: string; other?: string }>;
    expect(world[0]).toEqual({ key: "value", other: "nested" });
    expect(world[1]).toEqual({ key: "two" });
  });

  it("maps CCv3 data fields, greetings and character_book into dedicated artifacts", async () => {
    const repository = new MemoryProjectRepository("ccv3-import");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-ccv3", "import")] }));
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Snow Queen",
        description: "A cold but caring student.",
        personality: "Calm and direct.",
        scenario: "The student council room.",
        system_prompt: "Act as Yukino.",
        mes_example: "<START>",
        first_mes: "Hello.",
        alternate_greetings: ["Hi.", "Yo."],
        group_only_greetings: ["Everyone."],
        character_book: {
          name: "Snow World",
          entries: [
            { keys: ["council"], content: "The council room.", insertion_order: 1 },
            { keys: ["snow"], content: "Snow falls at noon.", insertion_order: 2 },
          ],
        },
      },
    };
    const result = await new ImportService(repository).run("op-ccv3", "import card", "importer", [{ name: "snow.json", content: new TextEncoder().encode(JSON.stringify(card)) }]);
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.artifacts.map((item) => item.kind).sort()).toEqual(["character", "greeting", "world_lore"]);
    const character = state.artifacts.find((item) => item.kind === "character")!;
    const document = JSON.parse(character.content) as { document: { sections: Array<{ id: string; content: string }> } };
    expect(document.document.sections.map((item) => item.id).sort()).toEqual(["message-examples", "personality", "scenario", "system-prompt"]);
    const greeting = state.artifacts.find((item) => item.kind === "greeting")!;
    const greetings = (JSON.parse(greeting.content) as { document: { greetings: Array<{ kind: string; content: string }> } }).document.greetings;
    expect(greetings).toEqual([
      { kind: "primary", content: "Hello.", character_ids: ["snow-queen"] },
      { kind: "alternate", content: "Hi.", character_ids: ["snow-queen"] },
      { kind: "alternate", content: "Yo.", character_ids: ["snow-queen"] },
      { kind: "group_only", content: "Everyone.", character_ids: ["snow-queen"] },
    ]);
    const world = state.artifacts.find((item) => item.kind === "world_lore")!;
    const entries = (JSON.parse(world.content) as { entries: Array<{ id: string; title: string; content: string; aliases: string[] }> }).entries;
    expect(entries.map((item) => item.title)).toEqual(["council", "snow"]);
    expect(entries[0]?.content).toBe("The council room.");
    const report = state.imports[0]?.report.join(" ");
    expect(report).toContain("→Character(sections: 已建立 4 節)");
    expect(report).toContain("→Greeting(primary: 已建立)");
    expect(report).toContain("alternate: 2 組");
    expect(report).toContain("World(entries: 2 條，書名「Snow World」)");
    expect(state.operations.find((item) => item.id === "op-ccv3")?.status).toBe("completed");
  });

  it("imports a V1 top-level first_mes as a primary greeting artifact", async () => {
    const repository = new MemoryProjectRepository("v1-import");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-v1", "import")] }));
    const result = await new ImportService(repository).run("op-v1", "import card", "importer", [{ name: "v1.json", content: new TextEncoder().encode(JSON.stringify({ name: "V1 Card", first_mes: "Hi there." })) }]);
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.artifacts.map((item) => item.kind).sort()).toEqual(["character", "greeting"]);
    const greeting = state.artifacts.find((item) => item.kind === "greeting")!;
    const greetings = (JSON.parse(greeting.content) as { document: { greetings: Array<{ kind: string; content: string }> } }).document.greetings;
    expect(greetings).toEqual([{ kind: "primary", content: "Hi there.", character_ids: ["v1-card"] }]);
    expect(state.imports[0]?.report.join(" ")).toContain("Greeting(primary: 已建立)");
  });
});
