import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  computeProjectProjection,
  contentHash,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
} from "@st-workspace/core";
import { buildRequiredArtifactManifest, validateWorkflow } from "@st-workspace/domain";
import { buildReadiness } from "../src/build-application.js";

const NOW = "2026-08-20T00:00:00.000Z";

type RelationshipScope = "full_roster" | "participant_subset";

type RelationshipConfig = {
  enabled: true;
  scope?: RelationshipScope;
  character_ids?: string[];
};

function recordedPrecheck(projectId: string, roster: readonly string[], relationships: RelationshipConfig): BlueprintPrecheckRecord {
  const candidateBlueprint = {
    schema_version: 1,
    project_id: projectId,
    flow: "character",
    primary_character_id: roster[0],
    world: { enabled: false },
    characters: roster.map((id, index) => ({ id, label: id.toUpperCase(), ordinal: index + 1, mode: "zhuji" })),
    relationships,
  };
  return {
    id: `precheck-${projectId}`,
    schema_version: 1,
    project_id: projectId,
    operation_id: "audit14-issue227",
    collaboration_mode: "assisted",
    candidate_blueprint: candidateBlueprint,
    candidate_blueprint_revision: contentHash(JSON.stringify(candidateBlueprint)),
    checks: [{
      subject_id: roster[0] ?? projectId,
      dimension: "relationships_boundaries",
      uncertainty: "low",
      impact: "low",
      basis: "Relationship scope explicitly configured for Audit 14 #227 regression.",
      action: "preserve_explicit",
    }],
    status: "recorded",
    created_at: NOW,
    created_by: "director",
  };
}

function relationshipArtifact(id: string, key: string, participants: readonly string[]): ArtifactRecord {
  const content = JSON.stringify({
    kind: "relationships",
    document: { character_ids: [...participants] },
  });
  const revision = contentHash(`${id}:${content}`);
  return {
    id,
    key,
    kind: "relationship",
    name: "relationships",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision,
    status: "draft",
    created_at: NOW,
    updated_at: NOW,
    created_by: "audit14",
    operation_id: "audit14-issue227",
  };
}

function relationshipArtifactWithoutParticipants(id: string, key: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "relationships", document: {} });
  return {
    id,
    key,
    kind: "relationship",
    name: "relationships",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(`${id}:${content}`),
    status: "draft",
    created_at: NOW,
    updated_at: NOW,
    created_by: "audit14",
    operation_id: "audit14-issue227",
  };
}

async function repositoryFor(
  projectId: string,
  roster: readonly string[],
  relationships: RelationshipConfig,
  artifacts: readonly ArtifactRecord[],
): Promise<MemoryProjectRepository> {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    blueprint_prechecks: [recordedPrecheck(projectId, roster, relationships)],
    artifacts: [...artifacts],
  }));
  return repository;
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("#227 relationship manifest participant scope", () => {
  it("preserves relationship enablement, scope and configured participant ids in the Blueprint projection", async () => {
    const repository = await repositoryFor(
      "relationship-projection",
      ["a", "b", "c"],
      { enabled: true, scope: "participant_subset", character_ids: ["a", "c"] },
      [],
    );

    const projection = computeProjectProjection(await repository.read());
    expect(projection.blueprint?.relationships_enabled).toBe(true);
    expect(projection.blueprint?.relationship_scope).toBe("participant_subset");
    expect(projection.blueprint?.relationship_character_ids).toEqual(["a", "c"]);
  });

  it("preserves legacy enabled relationship planning when the Blueprint has no explicit scope", async () => {
    const relationship = relationshipArtifactWithoutParticipants("relationship-legacy", "relationship:legacy");
    const repository = await repositoryFor(
      "relationship-legacy-scope",
      ["a", "b"],
      { enabled: true },
      [relationship],
    );

    const projection = computeProjectProjection(await repository.read());
    expect(projection.blueprint?.relationship_scope).toBeUndefined();
    expect(projection.publishPlan("zhuji").relationship_artifact_ids).toContain(relationship.id);
  });

  it("requires one current full-roster relationship artifact to cover every current Blueprint character", async () => {
    const completeRepository = await repositoryFor(
      "relationship-full-complete",
      ["a", "b", "c"],
      { enabled: true, scope: "full_roster", character_ids: ["a", "b", "c"] },
      [relationshipArtifact("relationship-complete", "relationship:team", ["a", "b", "c"])],
    );
    const complete = buildRequiredArtifactManifest(await completeRepository.read());
    expect(complete?.relationships.complete).toBe(true);
    expect(complete?.relationships.artifact_ids).toEqual(["relationship-complete"]);
    expect(codes(complete?.diagnostics ?? [])).not.toContain("RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING");

    const incompleteRepository = await repositoryFor(
      "relationship-full-incomplete",
      ["a", "b", "c"],
      { enabled: true, scope: "full_roster", character_ids: ["a", "b", "c"] },
      [relationshipArtifact("relationship-incomplete", "relationship:team", ["a", "b"])],
    );
    const incomplete = buildRequiredArtifactManifest(await incompleteRepository.read());
    expect(incomplete?.relationships.complete).toBe(false);
    expect(incomplete?.relationships.artifact_ids).toEqual([]);
    expect(codes(incomplete?.diagnostics ?? [])).toContain("RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING");
  });

  it("invalidates an A/B full-roster relationship after the Blueprint expands to A/B/C and surfaces the blocker in publish and build readiness", async () => {
    const repository = await repositoryFor(
      "relationship-expansion",
      ["a", "b", "c"],
      { enabled: true, scope: "full_roster", character_ids: ["a", "b"] },
      [relationshipArtifact("relationship-ab", "relationship:team", ["a", "b"])],
    );
    const state = await repository.read();
    const manifest = buildRequiredArtifactManifest(state);
    expect(manifest?.relationships.complete).toBe(false);
    expect(codes(manifest?.diagnostics ?? [])).toEqual(expect.arrayContaining([
      "BLUEPRINT_RELATIONSHIP_FULL_ROSTER_SNAPSHOT_STALE",
      "RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING",
      "REQUIRED_RELATIONSHIPS_ARTIFACT_MISSING",
    ]));

    const publishGate = validateWorkflow(state, "publish", manifest);
    expect(publishGate.ok).toBe(false);
    expect(codes(publishGate.diagnostics)).toContain("RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING");

    const readiness = await buildReadiness({ repository });
    expect(codes(readiness.diagnostics)).toContain("RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING");
  });

  it("requires the configured participant subset while allowing extra current-roster participants with an explicit warning", async () => {
    const repository = await repositoryFor(
      "relationship-subset-extra",
      ["a", "b", "c"],
      { enabled: true, scope: "participant_subset", character_ids: ["a", "b"] },
      [relationshipArtifact("relationship-abc", "relationship:team", ["a", "b", "c"])],
    );

    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.relationships.complete).toBe(true);
    expect(manifest?.relationships.artifact_ids).toEqual(["relationship-abc"]);
    expect(codes(manifest?.diagnostics ?? [])).toContain("RELATIONSHIP_SCOPE_EXTRA_PARTICIPANTS");
    expect(codes(manifest?.diagnostics ?? [])).not.toContain("RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING");
  });

  it("rejects an empty participant_subset configuration", async () => {
    const repository = await repositoryFor(
      "relationship-subset-empty",
      ["a", "b"],
      { enabled: true, scope: "participant_subset", character_ids: [] },
      [],
    );

    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.relationships.complete).toBe(false);
    expect(codes(manifest?.diagnostics ?? [])).toContain("BLUEPRINT_RELATIONSHIP_PARTICIPANTS_MISSING");
  });

  it("rejects participant_subset configuration that references a character outside the current roster", async () => {
    const repository = await repositoryFor(
      "relationship-subset-invalid",
      ["a", "b"],
      { enabled: true, scope: "participant_subset", character_ids: ["a", "ghost"] },
      [relationshipArtifact("relationship-a", "relationship:team", ["a"])],
    );

    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(codes(manifest?.diagnostics ?? [])).toContain("BLUEPRINT_RELATIONSHIP_PARTICIPANT_INVALID");
  });

  it("rejects relationship participants outside the current Blueprint roster", async () => {
    const repository = await repositoryFor(
      "relationship-outside-roster",
      ["a", "b", "c"],
      { enabled: true, scope: "participant_subset", character_ids: ["a", "b"] },
      [relationshipArtifact("relationship-ghost", "relationship:team", ["a", "b", "ghost"])],
    );

    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.relationships.complete).toBe(false);
    expect(manifest?.relationships.artifact_ids).toEqual([]);
    expect(codes(manifest?.diagnostics ?? [])).toContain("RELATIONSHIP_PARTICIPANT_OUTSIDE_BLUEPRINT");
  });

  it("rejects a scoped relationship artifact that does not expose document.character_ids", async () => {
    const repository = await repositoryFor(
      "relationship-participants-missing",
      ["a", "b"],
      { enabled: true, scope: "full_roster", character_ids: ["a", "b"] },
      [relationshipArtifactWithoutParticipants("relationship-invalid", "relationship:team")],
    );

    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.relationships.complete).toBe(false);
    expect(codes(manifest?.diagnostics ?? [])).toContain("RELATIONSHIP_PARTICIPANTS_INVALID");
  });

  it("does not let a stale same-key relationship revision satisfy the current participant requirement", async () => {
    const oldRevision = relationshipArtifact("relationship-old", "relationship:team", ["a", "c"]);
    const currentRevision = relationshipArtifact("relationship-current", "relationship:team", ["a", "b"]);
    const repository = await repositoryFor(
      "relationship-stale-revision",
      ["a", "b", "c"],
      { enabled: true, scope: "participant_subset", character_ids: ["a", "c"] },
      [oldRevision, currentRevision],
    );
    const state = await repository.read();
    const projection = computeProjectProjection(state);
    expect(projection.currentArtifacts.map((artifact) => artifact.id)).not.toContain("relationship-old");
    expect(projection.currentArtifacts.map((artifact) => artifact.id)).toContain("relationship-current");

    const manifest = buildRequiredArtifactManifest(state);
    expect(manifest?.relationships.complete).toBe(false);
    expect(manifest?.relationships.artifact_ids).toEqual([]);
    expect(manifest?.in_scope_artifact_ids).not.toContain("relationship-old");
    expect(codes(manifest?.diagnostics ?? [])).toContain("RELATIONSHIP_SCOPE_PARTICIPANTS_MISSING");
  });
});