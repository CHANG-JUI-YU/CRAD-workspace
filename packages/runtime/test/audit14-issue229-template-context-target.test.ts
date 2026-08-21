import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type FactRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const NOW = "2026-08-21T00:00:00.000Z";

function recordedPrecheck(projectId: string, roster: readonly string[]): BlueprintPrecheckRecord {
  const candidateBlueprint = {
    schema_version: 1,
    project_id: projectId,
    flow: "character",
    primary_character_id: roster[0],
    world: { enabled: false },
    characters: roster.map((id, index) => ({ id, label: id.toUpperCase(), ordinal: index + 1, mode: "zhuji" })),
    relationships: { enabled: false },
  };
  return {
    id: `precheck-${projectId}`,
    schema_version: 1,
    project_id: projectId,
    operation_id: "audit14-issue229",
    collaboration_mode: "assisted",
    candidate_blueprint: candidateBlueprint,
    candidate_blueprint_revision: contentHash(JSON.stringify(candidateBlueprint)),
    checks: [{
      subject_id: roster[0] ?? projectId,
      dimension: "character_core",
      uncertainty: "low",
      impact: "low",
      basis: "Explicit Blueprint roster for Audit 14 #229 regression.",
      action: "preserve_explicit",
    }],
    status: "recorded",
    created_at: NOW,
    created_by: "director",
  };
}

function characterArtifact(id: string, key: string, characterId: string, summary: string): ArtifactRecord {
  const content = JSON.stringify({
    kind: "character",
    document: { schema_version: 1, id: characterId, display_name: characterId.toUpperCase(), summary },
  });
  return {
    id,
    key,
    kind: "character",
    name: characterId,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(`${id}:${content}`),
    status: "draft",
    created_at: NOW,
    updated_at: NOW,
    created_by: "audit14",
    operation_id: "audit14-issue229",
  };
}

function fact(id: string, characterId: string, status: FactRecord["status"]): FactRecord {
  return {
    id,
    statement: `${characterId} fact ${id}`,
    subject: characterId,
    classification: "trait",
    entity_refs: [characterId],
    status,
    confidence: 0.9,
    source_ids: [],
    evidence: [],
    created_at: NOW,
    updated_at: NOW,
    created_by: "audit14",
  };
}

async function runtimeFor(
  projectId: string,
  roster: readonly string[],
  artifacts: readonly ArtifactRecord[],
  facts: readonly FactRecord[],
): Promise<WorkspaceRuntime> {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    blueprint_prechecks: [recordedPrecheck(projectId, roster)],
    artifacts: [...artifacts],
    facts: [...facts],
  }));
  return new WorkspaceRuntime(repository);
}

async function characterContext(runtime: WorkspaceRuntime, characterId: string) {
  return runtime.templateContext(
    "character",
    { character_id: characterId } as unknown as Parameters<WorkspaceRuntime["templateContext"]>[1],
  );
}

describe("#229 explicit template context target identity", () => {
  it("scopes current existing artifacts and accepted/unresolved facts to the requested character", async () => {
    const runtime = await runtimeFor(
      "target-ab",
      ["a", "b"],
      [
        characterArtifact("character-a", "character:a", "a", "A current"),
        characterArtifact("character-b-old", "character:b", "b", "B stale"),
        characterArtifact("character-b-current", "character:b", "b", "B current"),
      ],
      [
        fact("accepted-a", "a", "accepted"),
        fact("accepted-b", "b", "accepted"),
        fact("candidate-a", "a", "candidate"),
        fact("conflict-b", "b", "conflict"),
      ],
    );

    const { context } = await characterContext(runtime, "b");
    expect(context).toMatchObject({ target: { character_id: "b" } });
    expect(context.existing.map((item) => item.artifact_id)).toEqual(["character-b-current"]);
    expect(context.knowledge?.accepted_facts.map((item) => item.id)).toEqual(["accepted-b"]);
    expect(context.knowledge?.unresolved_facts.map((item) => item.id)).toEqual(["conflict-b"]);
  });

  it("fails closed when a multi-character Blueprint omits or names an invalid character target", async () => {
    const runtime = await runtimeFor("target-required", ["a", "b"], [], []);

    await expect(runtime.templateContext("character")).rejects.toMatchObject({
      code: "TEMPLATE_CHARACTER_TARGET_REQUIRED",
      recoverable: true,
    });
    await expect(characterContext(runtime, "missing")).rejects.toMatchObject({
      code: "TEMPLATE_CHARACTER_TARGET_INVALID",
      recoverable: true,
    });
  });

  it("scopes an expansion character correctly before any same-kind artifact exists", async () => {
    const runtime = await runtimeFor(
      "target-expansion",
      ["a", "b", "c"],
      [
        characterArtifact("character-a", "character:a", "a", "A"),
        characterArtifact("character-b", "character:b", "b", "B"),
      ],
      [fact("accepted-c", "c", "accepted"), fact("candidate-c", "c", "candidate"), fact("accepted-a", "a", "accepted")],
    );

    const { context } = await characterContext(runtime, "c");
    expect(context).toMatchObject({ target: { character_id: "c" } });
    expect(context.existing).toEqual([]);
    expect(context.knowledge?.accepted_facts.map((item) => item.id)).toEqual(["accepted-c"]);
    expect(context.knowledge?.unresolved_facts.map((item) => item.id)).toEqual(["candidate-c"]);
  });

  it("keeps single-character callers backward compatible through the authoritative Blueprint roster", async () => {
    const runtime = await runtimeFor("target-single", ["solo"], [], [fact("accepted-solo", "solo", "accepted")]);
    const { context } = await runtime.templateContext("character");
    expect(context).toMatchObject({ target: { character_id: "solo" } });
    expect(context.knowledge?.accepted_facts.map((item) => item.id)).toEqual(["accepted-solo"]);
  });
});
