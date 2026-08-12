import { describe, expect, it } from "vitest";
import {
  artifactDependencyFingerprint,
  createProjectState,
  type ArtifactRecord,
} from "../src/index.js";
import { incrementalMaterializationWriteSet } from "../src/repository/materialization.js";

function character(id: string, displayName: string): ArtifactRecord {
  const timestamp = new Date().toISOString();
  return {
    id: `artifact-${id}`,
    key: `character:${id}`,
    kind: "character",
    name: id,
    content: JSON.stringify({ document: { id, display_name: displayName, summary: `${displayName} summary` } }),
    media_type: "application/json",
    content_hash: "a".repeat(64),
    revision: "b".repeat(64),
    status: "approved",
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "test",
    operation_id: "op-test",
  };
}

describe("incremental materialization and dependency fingerprints", () => {
  it("does not mark existing character files stale when a new roster member is added", async () => {
    const first = createProjectState("demo");
    first.artifacts = Array.from({ length: 10 }, (_, index) => character(`character-${index + 1}`, `Character ${index + 1}`));
    first.artifacts = first.artifacts.map((artifact) => ({ ...artifact, dependency_fingerprint: artifactDependencyFingerprint(first, artifact) }));
    const second = { ...first, revision: 1, artifacts: [...first.artifacts, character("character-11", "Character 11")] };
    const writeSet = await incrementalMaterializationWriteSet(first, second, "C:/project");
    expect(writeSet.files?.some((file) => file.path.includes("character-1-Character-1"))).toBe(false);
    expect(writeSet.files?.some((file) => file.path.includes("character-11-Character-11"))).toBe(true);
    expect(second.artifacts[0]?.dependency_fingerprint).toBe(first.artifacts[0]?.dependency_fingerprint);
  });

  it("emits a stale dependency diagnostic only after a bound input changes", () => {
    const state = createProjectState("demo");
    const artifact = character("character-1", "Character 1");
    const authored = { ...state, artifacts: [{ ...artifact, dependency_fingerprint: artifactDependencyFingerprint(state, artifact) }] };
    const changed = { ...authored, facts: [{ id: "fact-1", statement: "Character 1 is direct", subject: "character-1", predicate: "has_trait", value: "direct", classification: "trait" as const, status: "accepted" as const, confidence: 1, source_ids: [], evidence: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "test" }] };
    expect(artifactDependencyFingerprint(authored, authored.artifacts[0]!)).toBe(authored.artifacts[0]?.dependency_fingerprint);
    expect(artifactDependencyFingerprint(changed, changed.artifacts[0]!)).not.toBe(changed.artifacts[0]?.dependency_fingerprint);
  });

  it("keeps the previous wardrobe revision when a newer wardrobe becomes current", async () => {
    const previous = createProjectState("demo");
    const oldWardrobe: ArtifactRecord = {
      ...character("rina", "Rina"),
      id: "wardrobe-old",
      key: "wardrobe:rina",
      kind: "wardrobe",
      name: "rina/wardrobe",
      content: "# Old wardrobe",
      media_type: "text/markdown",
      revision: "c".repeat(64),
    };
    const nextWardrobe: ArtifactRecord = {
      ...oldWardrobe,
      id: "wardrobe-new",
      content: "# New wardrobe",
      revision: "d".repeat(64),
    };
    const first = { ...previous, artifacts: [oldWardrobe] };
    const second = { ...first, revision: 1, artifacts: [oldWardrobe, nextWardrobe] };
    const writeSet = await incrementalMaterializationWriteSet(first, second, "C:/project");
    expect(writeSet.files?.some((file) => file.path.includes("wardrobe/revisions/"))).toBe(true);
    expect(writeSet.files?.some((file) => file.content.toString().includes("Old wardrobe"))).toBe(true);
    expect(writeSet.files?.some((file) => file.path.endsWith("wardrobe/wardrobe.md") && file.content.toString().includes("New wardrobe"))).toBe(true);
  });
});
