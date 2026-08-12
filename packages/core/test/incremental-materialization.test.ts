import { describe, expect, it } from "vitest";
import {
  artifactDependencyFingerprint,
  canonicalEntityReference,
  contentHash,
  createProjectState,
  createEntityMatcher,
  type ArtifactRecord,
  type FactRecord,
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

function structuredArtifact(id: string, key: string, kind: ArtifactRecord["kind"], name: string, value: unknown): ArtifactRecord {
  const timestamp = new Date().toISOString();
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  return {
    id,
    key,
    kind,
    name,
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "test",
    operation_id: "op-test",
  };
}

function fact(id: string, subject?: string, entityRefs?: string[], classification: FactRecord["classification"] = "trait"): FactRecord {
  return {
    id,
    statement: `${subject ?? entityRefs?.join(",") ?? "world"} fact`,
    ...(subject === undefined ? {} : { subject }),
    ...(entityRefs === undefined ? {} : { entity_refs: entityRefs }),
    predicate: "has_property",
    value: "stable",
    classification,
    coverage: classification === "world" ? ["world_context"] : classification === "relationship" ? ["relationships"] : ["personality"],
    status: "accepted",
    confidence: 1,
    source_ids: [],
    evidence: [],
    created_at: "now",
    updated_at: "now",
    created_by: "test",
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

  it("uses stable entity semantics for character, relationship and greeting fact dependencies", () => {
    const state = createProjectState("entity-dependent-fingerprints");
    const blueprint = structuredArtifact("blueprint-entities", "blueprint:entity-dependent-fingerprints", "blueprint", "project-blueprint", {
      kind: "blueprint",
      flow: "source_adaptation",
      primary_character_id: "c02",
      characters: [
        { id: "c02", label: "Alice", aliases: ["Alicia"] },
        { id: "c03", label: "Bob", aliases: ["Bobby"] },
      ],
    });
    const characterArtifact = structuredArtifact("character-c02", "character:c02", "character", "c02", { document: { id: "c02", display_name: "Alice", summary: "Alice" } });
    const relationshipArtifact = structuredArtifact("relationship-network", "relationship:network", "relationship", "network", { kind: "relationships", document: { character_ids: ["Alice", "Bob"] } });
    const greetingArtifact = structuredArtifact("greeting-network", "greeting:network", "greeting", "network", {
      kind: "greetings",
      document: {
        greetings: [
          { id: "primary", kind: "primary", content: "Hello", character_ids: ["Alice"] },
          { id: "group", kind: "group_only", content: "Welcome", character_ids: ["Alicia", "c03"] },
        ],
      },
    });
    const worldArtifact = structuredArtifact("world-lore", "world_lore:world", "world_lore", "world", { kind: "world", entries: [] });
    state.artifacts = [blueprint, characterArtifact, relationshipArtifact, greetingArtifact, worldArtifact];

    const matcher = createEntityMatcher(state);
    expect(canonicalEntityReference(matcher, "c02")).toBe("c02");
    expect(canonicalEntityReference(matcher, "Alice")).toBe("c02");
    expect(canonicalEntityReference(matcher, "Alicia")).toBe("c02");

    const characterBase = artifactDependencyFingerprint(state, characterArtifact);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("character-id", "c02")] }, characterArtifact)).not.toBe(characterBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("character-label", "Alice")] }, characterArtifact)).not.toBe(characterBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("character-alias", "Alicia")] }, characterArtifact)).not.toBe(characterBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("character-refs", undefined, ["c02"])] }, characterArtifact)).not.toBe(characterBase);

    const relationshipBase = artifactDependencyFingerprint(state, relationshipArtifact);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("relationship-label", "Alice", undefined, "relationship")] }, relationshipArtifact)).not.toBe(relationshipBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("relationship-alias", "Alicia", undefined, "relationship")] }, relationshipArtifact)).not.toBe(relationshipBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("relationship-refs", undefined, ["c02"], "relationship")] }, relationshipArtifact)).not.toBe(relationshipBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("relationship-other", "Nobody", undefined, "relationship")] }, relationshipArtifact)).toBe(relationshipBase);

    const greetingBase = artifactDependencyFingerprint(state, greetingArtifact);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("greeting-participant", "Alicia")] }, greetingArtifact)).not.toBe(greetingBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("greeting-participant-ref", undefined, ["c03"])] }, greetingArtifact)).not.toBe(greetingBase);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("greeting-nonparticipant", "Nobody")] }, greetingArtifact)).toBe(greetingBase);

    const worldBase = artifactDependencyFingerprint(state, worldArtifact);
    expect(artifactDependencyFingerprint({ ...state, facts: [fact("world-fact", "setting", undefined, "world")] }, worldArtifact)).not.toBe(worldBase);
  });
});
