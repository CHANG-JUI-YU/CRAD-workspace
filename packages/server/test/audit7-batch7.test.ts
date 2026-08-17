import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type ArtifactRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";
const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];

function makeModuleArtifact(kind: "zhuji" | "palette", characterId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind, character_id: characterId, module: { schema_version: 1, mode: kind, module, title: module, data: { description: `${module} module.` } } });
  return {
    id: `${kind}-${module}`,
    key: `${kind}:${characterId}/${module}`,
    kind,
    name: `${characterId}/${module}`,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
  };
}

function makeGreetingArtifact(characterId: string): ArtifactRecord {
  const content = JSON.stringify({
    document: {
      greetings: [
        { id: "g1", kind: "primary", content: "Hello there!", character_ids: [characterId] },
      ],
    },
  });
  return {
    id: "art-greeting",
    key: `greeting:${characterId}/default`,
    kind: "greeting",
    name: `${characterId}/default`,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "greetings_creator",
    operation_id: "op-author",
  };
}

function makeWorldLoreArtifact(): ArtifactRecord {
  const content = JSON.stringify({
    entries: [
      { id: "e1", keys: ["world"], content: "World description." },
    ],
  });
  return {
    id: "art-world",
    key: "world_lore:global",
    kind: "world_lore",
    name: "global",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "world_lore_creator",
    operation_id: "op-author",
  };
}

async function createServerFixture() {
  const repo = new MemoryProjectRepository("test-proj");
  await repo.commit(0, (current) => {
    const zhujiArts = ZHUJI_MODULES.map((m) => makeModuleArtifact("zhuji", "alpha", m));
    const greetingArt = makeGreetingArtifact("alpha");
    const worldArt = makeWorldLoreArtifact();
    const blueprintContent = JSON.stringify({
      characters: [{ id: "alpha", label: "Alpha", mode: "zhuji" }],
      export_modes: "zhuji",
    });
    const blueprintArt: ArtifactRecord = {
      id: "art-blueprint",
      key: "blueprint:project",
      kind: "blueprint",
      name: "project",
      content: blueprintContent,
      media_type: "application/json",
      content_hash: contentHash(blueprintContent),
      revision: contentHash(blueprintContent),
      status: "reviewed",
      created_at: now,
      updated_at: now,
      created_by: "director",
      operation_id: "op-author",
    };

    const allArts = [blueprintArt, ...zhujiArts, greetingArt, worldArt];
    const reviewable = allArts.filter((a) => a.kind !== "blueprint");
    const reviews = reviewable.map((item, index) => ({
      id: `review-${index + 1}`,
      artifact_id: item.id,
      artifact_revision: item.revision,
      reviewer: "reviewer",
      status: "passed" as const,
      issue_ids: [],
      created_at: now,
    }));

    return {
      ...current,
      project_id: "test-proj",
      project_name: "Test Project",
      project_status: "ready",
      artifacts: allArts,
      reviews,
      operations: [
        { id: "op-author", kind: "authoring", request: "author", actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] },
      ],
      quality_profile: {
        level: "normal",
        blocking_severity: "error",
        overrides: {},
        override_audit: [],
      },
    };
  });

  const runtime = new WorkspaceRuntime(repo, { interviewRequired: false });
  const server = createWorkspaceServer({
    actor: "user",
    runtime,
    runtimeRevision: "audit7-batch7-test",
    autoStartWorker: false,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected address");

  return {
    url: `http://127.0.0.1:${address.port}`,
    server: {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    },
    runtime,
    repo,
  };
}

describe("Audit 7 Batch 7 - Server Endpoints & Dashboard UI", () => {
  it("renders publish stepper and primary CTA in dashboard markup", async () => {
    const { server } = await createServerFixture();
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('id="publish-stepper"');
    expect(html).toContain('data-step="readiness"');
    expect(html).toContain('data-step="inputs_frozen"');
    expect(html).toContain('data-step="provenance_reviewed"');
    expect(html).toContain('data-step="confirmed"');
    expect(html).toContain('data-step="published"');
    expect(html).toContain('id="publish-primary-cta"');
    expect(html).toContain('id="provenance-stale-diff"');
    expect(html).toContain('id="both-mode-blocker-info"');
    await server.close();
  });

  it("handles provenance confirm with prepared_snapshot and returns changed_inputs on stale diff", async () => {
    const { server, runtime, repo } = await createServerFixture();

    const preview = await runtime.publishProvenancePreview("zhuji");
    expect(preview.available).toBe(true);

    // Modify state
    const cur = await repo.read();
    await repo.commit(cur.revision, (s) => ({
      ...s,
      quality_profile: {
        level: "strict",
        blocking_severity: "warning",
        overrides: { NEW_CODE: "info" },
        override_audit: [{ code: "NEW_CODE", configured_severity: "info", against_effective_severity: "warning", actor: "user", occurred_at: now }],
      },
    }));

    const res = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Confirm": "publish" },
      body: JSON.stringify({
        fingerprint: preview.fingerprint,
        mode_selection: "zhuji",
        idempotency_key: "idem-server-1",
        prepared_snapshot: preview.prepared_snapshot,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("PROVENANCE_CONFIRMATION_STALE");
    expect(body.details).toBeDefined();
    expect(Array.isArray(body.details.changed_inputs)).toBe(true);
    expect(body.details.changed_inputs.some((c: any) => c.category === "quality_policy")).toBe(true);

    await server.close();
  });
});
