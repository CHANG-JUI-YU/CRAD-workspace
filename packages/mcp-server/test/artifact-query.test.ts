import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  computeRevision,
  loadAuthorProject,
} from "@card-workspace/project";
import { workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation, createCompilePreview } from "@card-workspace/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { toolRegistry } from "../src/tool-registry.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function payload(response: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse((response.content[0] as { text: string }).text) as {
    ok?: boolean;
    error?: { code: string };
    result?: unknown;
  };
}

describe("Director artifact query", () => {
  it("advertises exact list and read contracts", () => {
    const list = toolRegistry.project_artifact_list;
    const read = toolRegistry.project_artifact_read;
    if (!list || list.scope !== "project" || !read || read.scope !== "project") {
      throw new Error("artifact query tools are not project-scoped");
    }
    expect(list.inputSchema.safeParse({ project_id: "artifact-query" }).success).toBe(true);
    expect(read.inputSchema.safeParse({ project_id: "artifact-query", artifact_id: "blueprint" }).success).toBe(false);
    expect(read.inputSchema.safeParse({
      project_id: "artifact-query",
      artifact_id: "blueprint",
      revision: `sha256:${"a".repeat(64)}`,
    }).success).toBe(true);
  });

  it("lists and reads author artifacts, review reports, and stale previews without a task or lease", async () => {
    const fixture = await setupMcpWorkspace("artifact-query");
    cleanups.push(fixture.workspace.cleanup);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "artifact-query");
    const blueprintRevision = loaded.sourceRevisions["blueprint.yaml"]!;
    const report = {
      schema_version: 1 as const,
      id: "review-blueprint-1",
      reviewer: "character-critic",
      target_id: "blueprint",
      target_revision: blueprintRevision,
      findings: [],
      summary: "Blueprint review complete.",
      extensions: {},
    };
    const reportRevision = computeRevision(report);
    const previewReady = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "artifact-fixtures",
      actor: "engine",
      occurredAt: "2026-07-18T00:00:00.000Z",
      operations: [{
        relativePath: ".workflow/results/review-blueprint/review-blueprint-1.json",
        content: canonicalJson(report),
        expectedAbsent: true,
      }],
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 1,
        stage: "compile_preview",
        artifacts: [{
          id: "author-content",
          status: "approved",
          revision: `sha256:${"a".repeat(64)}`,
          updated_at: "2026-07-18T00:00:00.000Z",
          extensions: {},
        }],
        gates: [
          { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
          { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
          { id: "content", status: "approved", input_revisions: [{ id: "author-content", revision: `sha256:${"a".repeat(64)}` }], extensions: {} },
          { id: "publish", status: "pending", input_revisions: [], extensions: {} },
        ],
        tasks: [{
          id: "review-blueprint",
          kind: "review-character",
          status: "completed",
          assigned_agent: "character-critic",
          capabilities: ["task.execute", "review.submit"],
          input_artifacts: [{ id: "blueprint", revision: blueprintRevision }],
          output_contract: "review-report@1",
          dependencies: [],
          attempt: 1,
          max_attempts: 3,
          result: { id: report.id, revision: reportRevision, contract: "review-report@1" },
          extensions: {},
        }],
      }),
    });
    expect(previewReady.stage).toBe("compile_preview");
    expect(previewReady.gates.find((gate) => gate.id === "content")?.status).toBe("approved");
    expect(previewReady.artifacts.map((artifact) => artifact.id)).toContain("author-content");
    const preview = await createCompilePreview({
      workspaceRoot: fixture.workspace.root,
      projectId: "artifact-query",
      previewId: "preview-artifact-query",
      eventId: "artifact-preview-created",
      actor: "director",
      occurredAt: "2026-07-18T00:01:00.000Z",
      build: { png: false },
    });
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 2,
      eventId: "artifact-preview-stale",
      actor: "engine",
      occurredAt: "2026-07-18T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 3,
        artifacts: state.artifacts.map((artifact) => artifact.id === preview.id
          ? { ...artifact, status: "stale" as const }
          : artifact),
      }),
    });

    const before = await loadAuthorProject(fixture.workspace.projectsRoot, "artifact-query");
    const { server } = await createMcpServer({ environment: fixture.environment });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);

    const listedResponse = await client.callTool({
      name: "project_artifact_list",
      arguments: { project_id: "artifact-query" },
    });
    expect(listedResponse.isError).not.toBe(true);
    const listed = payload(listedResponse).result as { artifacts: Array<Record<string, unknown>> };
    expect(listed.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifact_id: "blueprint", kind: "blueprint", revision: blueprintRevision }),
      expect.objectContaining({ artifact_id: "author-characters-alice-character.yaml", kind: "character" }),
      expect.objectContaining({ artifact_id: report.id, kind: "review_report", revision: reportRevision }),
      expect.objectContaining({ artifact_id: preview.id, kind: "compile_preview", revision: preview.revision, status: "stale" }),
      expect.objectContaining({ artifact_id: "fact-register", kind: "fact_register", contract: "fact-register@1" }),
      expect.objectContaining({ artifact_id: "conflict-register", kind: "conflict_register", contract: "conflict-register@1" }),
    ]));

    const readArtifact = async (artifactId: string, revision: string) => client.callTool({
      name: "project_artifact_read",
      arguments: { project_id: "artifact-query", artifact_id: artifactId, revision },
    });
    expect(payload(await readArtifact("blueprint", blueprintRevision)).result).toMatchObject({
      artifact: { artifact_id: "blueprint", revision: blueprintRevision },
      content: { project_id: "artifact-query" },
    });
    expect(payload(await readArtifact(report.id, reportRevision)).result).toMatchObject({
      artifact: { kind: "review_report" },
      content: { id: report.id, summary: report.summary },
    });
    expect(payload(await readArtifact(preview.id, preview.revision)).result).toMatchObject({
      artifact: { kind: "compile_preview", status: "stale" },
      content: { id: preview.id, revision: preview.revision },
    });
    const factDescriptor = listed.artifacts.find((artifact) => artifact.artifact_id === "fact-register")!;
    const conflictDescriptor = listed.artifacts.find((artifact) => artifact.artifact_id === "conflict-register")!;
    expect(factDescriptor.revision).toBe(computeRevision(before.factRegister));
    expect(conflictDescriptor.revision).toBe(computeRevision(before.conflictRegister));
    expect(payload(await readArtifact("fact-register", factDescriptor.revision as string)).result).toMatchObject({
      artifact: { kind: "fact_register", contract: "fact-register@1" },
      content: before.factRegister,
    });
    expect(payload(await readArtifact("conflict-register", conflictDescriptor.revision as string)).result).toMatchObject({
      artifact: { kind: "conflict_register", contract: "conflict-register@1" },
      content: before.conflictRegister,
    });

    await writeFile(
      path.join(fixture.projectRoot, ".workflow/results/review-blueprint/review-blueprint-1.json"),
      canonicalJson({ ...report, summary: "Tampered report." }),
      "utf8",
    );
    const invalidReport = await readArtifact(report.id, reportRevision);
    expect(invalidReport.isError).toBe(true);
    expect(payload(invalidReport).error?.code).toBe("ARTIFACT_CONTENT_INVALID");
    const previewPath = path.join(fixture.projectRoot, `.workflow/previews/${preview.id}.json`);
    const previewValue = JSON.parse(await readFile(previewPath, "utf8")) as Record<string, unknown>;
    await writeFile(previewPath, JSON.stringify({ ...previewValue, project_id: "tampered" }), "utf8");
    const invalidPreview = await readArtifact(preview.id, preview.revision);
    expect(invalidPreview.isError).toBe(true);
    expect(payload(invalidPreview).error?.code).toBe("ARTIFACT_CONTENT_INVALID");

    const factPath = path.join(fixture.projectRoot, "facts/register.yaml");
    const factRaw = await readFile(factPath, "utf8");
    await writeFile(factPath, factRaw.replace("extensions: {}", "extensions:\n  tampered: true"), "utf8");
    const invalidFactProjection = await readArtifact("fact-register", factDescriptor.revision as string);
    expect(invalidFactProjection.isError).toBe(true);
    expect(payload(invalidFactProjection).error?.code).toBe("ARTIFACT_CONTENT_INVALID");
    await writeFile(factPath, factRaw, "utf8");

    const staleRevision = await readArtifact("blueprint", `sha256:${"0".repeat(64)}`);
    expect(staleRevision.isError).toBe(true);
    expect(payload(staleRevision).error?.code).toBe("ARTIFACT_REVISION_CONFLICT");
    const forged = await readArtifact("../../project.yaml", blueprintRevision);
    expect(forged.isError).toBe(true);
    expect(payload(forged).error?.code).toBe("ARTIFACT_NOT_FOUND");

    const after = await loadAuthorProject(fixture.workspace.projectsRoot, "artifact-query");
    expect(after.workflow?.revision).toBe(before.workflow?.revision);
    expect(after.sourceRevisions).toEqual(before.sourceRevisions);
    await client.close();
    await server.close();
  });

  it("lists and reads the exact relationship_module contract", async () => {
    const fixture = await setupMcpWorkspace("relationship-artifact-query", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(fixture.workspace.cleanup);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "relationship-artifact-query");
    const revision = loaded.sourceRevisions["relationships.yaml"]!;
    const { server } = await createMcpServer({ environment: fixture.environment });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const listed = payload(await client.callTool({ name: "project_artifact_list", arguments: { project_id: "relationship-artifact-query" } })).result as { artifacts: Array<Record<string, unknown>> };
    expect(listed.artifacts).toContainEqual(expect.objectContaining({
      artifact_id: "author-relationships.yaml", kind: "relationship_module", revision, contract: "relationships@1",
    }));
    expect(payload(await client.callTool({
      name: "project_artifact_read",
      arguments: { project_id: "relationship-artifact-query", artifact_id: "author-relationships.yaml", revision },
    })).result).toMatchObject({
      artifact: { kind: "relationship_module", contract: "relationships@1", revision },
      content: { team_code: loaded.relationships!.team_code, character_ids: ["alice", "beth"] },
    });
    await client.close();
    await server.close();
  });
});
