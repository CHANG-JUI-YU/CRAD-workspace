import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { computeTextRevision, publishForgeArtifacts } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("publishForgeArtifacts", () => {
  it("以單一交易發布 build 與 export", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = path.join(workspace.projectsRoot, "demo");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "project.yaml"), "source", "utf8");
    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "demo",
      sourceRevisions: { "projects/demo/project.yaml": computeTextRevision("source") },
      buildFiles: [{ fileName: "manifest.json", content: "manifest" }],
      exportFiles: [{ fileName: "demo.json", content: "card" }],
    });
    await expect(readFile(path.join(projectRoot, ".build", "manifest.json"), "utf8")).resolves.toBe("manifest");
    await expect(readFile(path.join(workspace.exportsRoot, "demo", "demo.json"), "utf8")).resolves.toBe("card");

    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "demo",
      sourceRevisions: { "projects/demo/project.yaml": computeTextRevision("source") },
      buildFiles: [{ fileName: "manifest.json", content: "manifest-2" }],
      exportFiles: [{ fileName: "demo.json", content: "card-2" }],
    });
    const oldRevision = computeTextRevision("card").slice("sha256:".length);
    await expect(readFile(path.join(workspace.exportsRoot, "demo", "demo.json"), "utf8")).resolves.toBe("card-2");
    await expect(readFile(path.join(workspace.exportsRoot, "demo", "old", `demo.${oldRevision}.json`), "utf8"))
      .resolves.toBe("card");

    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "demo",
      sourceRevisions: { "projects/demo/project.yaml": computeTextRevision("source") },
      buildFiles: [{ fileName: "manifest.json", content: "manifest-3" }],
      exportFiles: [{ fileName: "demo.json", content: "card-2" }],
    });
    const currentRevision = computeTextRevision("card-2").slice("sha256:".length);
    await expect(readFile(path.join(workspace.exportsRoot, "demo", "demo.json"), "utf8")).resolves.toBe("card-2");
    await expect(readFile(path.join(workspace.exportsRoot, "demo", "old", `demo.${currentRevision}.json`)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("允許受控 plugin build trace 與其他 build artifacts 一起發布", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = path.join(workspace.projectsRoot, "plugin-demo");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "project.yaml"), "source", "utf8");
    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "plugin-demo",
      sourceRevisions: { "projects/plugin-demo/project.yaml": computeTextRevision("source") },
      buildFiles: [
        { fileName: "plugin-build-trace.json", content: "trace" },
        { fileName: "manifest.json", content: "manifest" },
      ],
      exportFiles: [],
    });
    await expect(readFile(path.join(projectRoot, ".build", "plugin-build-trace.json"), "utf8"))
      .resolves.toBe("trace");
  });

  it("plugin source/selection/artifact drift 會阻斷 Publish CAS 並保留舊產物", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = path.join(workspace.projectsRoot, "plugin-cas");
    const sourcePath = path.join(projectRoot, "extensions", "official.mvu-zod", "source.yaml");
    const selectionPath = path.join(projectRoot, ".workflow", "plugin-selection.yaml");
    const artifactPath = path.join(projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.dirname(selectionPath), { recursive: true });
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(path.join(projectRoot, "project.yaml"), "project-v1", "utf8");
    await writeFile(sourcePath, "source-v1", "utf8");
    await writeFile(selectionPath, "selection-v1", "utf8");
    await writeFile(artifactPath, "artifact-v1", "utf8");
    const buildPath = path.join(projectRoot, ".build", "manifest.json");
    const exportPath = path.join(workspace.exportsRoot, "plugin-cas", "plugin-cas.json");
    await mkdir(path.dirname(buildPath), { recursive: true });
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(buildPath, "old-manifest", "utf8");
    await writeFile(exportPath, "old-card", "utf8");

    const sourceRevisions = {
      "projects/plugin-cas/project.yaml": computeTextRevision("project-v1"),
      "projects/plugin-cas/extensions/official.mvu-zod/source.yaml": computeTextRevision("source-v1"),
      "projects/plugin-cas/.workflow/plugin-selection.yaml": computeTextRevision("selection-v1"),
      "projects/plugin-cas/.workflow/plugin-artifacts/plugin-official.mvu-zod.json": computeTextRevision("artifact-v1"),
    };
    await writeFile(sourcePath, "source-drifted", "utf8");
    await expect(publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "plugin-cas",
      sourceRevisions,
      buildFiles: [
        { fileName: "plugin-build-trace.json", content: "new-trace" },
        { fileName: "manifest.json", content: "new-manifest" },
      ],
      exportFiles: [{ fileName: "plugin-cas.json", content: "new-card" }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(readFile(buildPath, "utf8")).resolves.toBe("old-manifest");
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old-card");
    await expect(readFile(path.join(projectRoot, ".build", "plugin-build-trace.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["selection", ".workflow/plugin-selection.yaml", "selection-drifted"],
    ["artifact", ".workflow/plugin-artifacts/plugin-official.mvu-zod.json", "artifact-drifted"],
  ] as const)("%s drift 也會阻斷 plugin publish CAS", async (_kind, relativePath, driftedContent) => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = path.join(workspace.projectsRoot, "plugin-cas-boundary");
    const sourcePath = path.join(projectRoot, "extensions", "official.mvu-zod", "source.yaml");
    const selectionPath = path.join(projectRoot, ".workflow", "plugin-selection.yaml");
    const artifactPath = path.join(projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.dirname(selectionPath), { recursive: true });
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(path.join(projectRoot, "project.yaml"), "project-v1", "utf8");
    await writeFile(sourcePath, "source-v1", "utf8");
    await writeFile(selectionPath, "selection-v1", "utf8");
    await writeFile(artifactPath, "artifact-v1", "utf8");
    const buildPath = path.join(projectRoot, ".build", "manifest.json");
    const tracePath = path.join(projectRoot, ".build", "plugin-build-trace.json");
    const exportPath = path.join(workspace.exportsRoot, "plugin-cas-boundary", "plugin-cas-boundary.json");
    await mkdir(path.dirname(buildPath), { recursive: true });
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(buildPath, "old-manifest", "utf8");
    await writeFile(exportPath, "old-card", "utf8");

    const sourceRevisions = {
      "projects/plugin-cas-boundary/project.yaml": computeTextRevision("project-v1"),
      "projects/plugin-cas-boundary/extensions/official.mvu-zod/source.yaml": computeTextRevision("source-v1"),
      "projects/plugin-cas-boundary/.workflow/plugin-selection.yaml": computeTextRevision("selection-v1"),
      "projects/plugin-cas-boundary/.workflow/plugin-artifacts/plugin-official.mvu-zod.json": computeTextRevision("artifact-v1"),
    };
    await writeFile(path.join(workspace.projectsRoot, "plugin-cas-boundary", relativePath), driftedContent, "utf8");

    await expect(publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "plugin-cas-boundary",
      sourceRevisions,
      buildFiles: [
        { fileName: "plugin-build-trace.json", content: "new-trace" },
        { fileName: "manifest.json", content: "new-manifest" },
      ],
      exportFiles: [{ fileName: "plugin-cas-boundary.json", content: "new-card" }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(readFile(buildPath, "utf8")).resolves.toBe("old-manifest");
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old-card");
    await expect(readFile(tracePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("多 plugin publish 在任一 managed artifact 漂移時整體拒絕", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectId = "multi-plugin-cas";
    const projectRoot = path.join(workspace.projectsRoot, projectId);
    const managedFiles = [
      ["extensions/official.mvu-zod/source.yaml", "mvu-v1"],
      ["extensions/official.ejs/source.yaml", "ejs-v1"],
      ["extensions/official.html/source.yaml", "html-v1"],
      [".workflow/plugin-selection.yaml", "selection-v1"],
      [".workflow/plugin-artifacts/plugin-official.mvu-zod.json", "mvu-artifact-v1"],
      [".workflow/plugin-artifacts/plugin-official.ejs.json", "ejs-artifact-v1"],
      [".workflow/plugin-artifacts/plugin-official.html.json", "html-artifact-v1"],
    ] as const;
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "project.yaml"), "project-v1", "utf8");
    for (const [relativePath, content] of managedFiles) {
      const target = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const buildPath = path.join(projectRoot, ".build", "manifest.json");
    const tracePath = path.join(projectRoot, ".build", "plugin-build-trace.json");
    const exportPath = path.join(workspace.exportsRoot, projectId, `${projectId}.json`);
    await mkdir(path.dirname(buildPath), { recursive: true });
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(buildPath, "old-manifest", "utf8");
    await writeFile(exportPath, "old-card", "utf8");

    const sourceRevisions: Record<string, string> = {
      [`projects/${projectId}/project.yaml`]: computeTextRevision("project-v1"),
    };
    for (const [relativePath, content] of managedFiles) {
      sourceRevisions[`projects/${projectId}/${relativePath}`] = computeTextRevision(content);
    }
    await writeFile(path.join(projectRoot, ".workflow/plugin-artifacts/plugin-official.ejs.json"), "ejs-artifact-drifted", "utf8");

    await expect(publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId,
      sourceRevisions,
      buildFiles: [
        { fileName: "plugin-build-trace.json", content: "new-trace" },
        { fileName: "manifest.json", content: "new-manifest" },
      ],
      exportFiles: [{ fileName: `${projectId}.json`, content: "new-card" }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(readFile(buildPath, "utf8")).resolves.toBe("old-manifest");
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old-card");
    await expect(readFile(tracePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("拒絕不受控路徑，發布故障時還原整套舊產物", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = path.join(workspace.projectsRoot, "demo");
    const buildPath = path.join(projectRoot, ".build", "manifest.json");
    const exportPath = path.join(workspace.exportsRoot, "demo", "demo.json");
    await mkdir(path.dirname(buildPath), { recursive: true });
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(path.join(projectRoot, "project.yaml"), "source", "utf8");
    await writeFile(buildPath, "old-manifest", "utf8");
    await writeFile(exportPath, "old-card", "utf8");
    const common = {
      workspaceRoot: workspace.root,
      projectId: "demo",
      sourceRevisions: { "projects/demo/project.yaml": computeTextRevision("source") },
      buildFiles: [{ fileName: "manifest.json", content: "new-manifest" }],
      exportFiles: [{ fileName: "demo.json", content: "new-card" }],
    };
    await expect(publishForgeArtifacts({ ...common, beforePublish: (index) => index === 2 ? Promise.reject(new Error("fail")) : undefined })).rejects.toThrow("fail");
    await expect(readFile(buildPath, "utf8")).resolves.toBe("old-manifest");
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old-card");
    const oldRevision = computeTextRevision("old-card").slice("sha256:".length);
    await expect(readFile(path.join(workspace.exportsRoot, "demo", "old", `demo.${oldRevision}.json`)))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      publishForgeArtifacts({ ...common, exportFiles: [{ fileName: "../escape.json", content: "bad" }] }),
    ).rejects.toMatchObject({ code: "PUBLISH_PATH_DENIED" });
  });
});
