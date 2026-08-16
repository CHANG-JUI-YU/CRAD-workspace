import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  computeBuildPlan,
  computeProjectIntentProjection,
  computeProjectProjection,
  computePublishPlan,
  currentArtifactsFromRecords,
  parseArtifactValue,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type PublishPlan,
} from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";

function artifact(id: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id,
    key: id,
    kind: "character",
    name: "Yukino",
    content: JSON.stringify({ kind: "character" }),
    media_type: "text/markdown",
    content_hash: contentHash(`c-${id}`),
    revision: "rev-1",
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "writer",
    operation_id: "op-1",
    ...overrides,
  };
}

function blueprintJson(): Record<string, unknown> {
  return {
    characters: [
      { id: "yukino", label: "Yukino", mode: "zhuji", aliases: ["Yukinoshita"], ordinal: 2 },
      { id: "yukino", label: "Duplicate" },
      { character_id: "momoka", display_name: "Momoka", mode: "palette", ordinal: 1 },
    ],
    primary_character_id: "yukino",
    world: { enabled: true, authoring_timing: "early" },
    relationships: { enabled: false },
    source_adaptation: { subjects: [{ character_id: "yukino", subject_name: "雪乃" }] },
    flow: "source_adaptation",
  };
}

function blueprintYaml(): string {
  return [
    "characters:",
    "  - id: yukino",
    "    display_name: Yukino",
    "    mode: zhuji",
    "  - character_id: momoka",
    "    label: 'Momoka'",
    "    subject_name: \"白雪\"",
    "primary_character_id: yukino",
  ].join("\n");
}

function precheck(overrides: Partial<BlueprintPrecheckRecord> = {}): BlueprintPrecheckRecord {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: "project-1",
    operation_id: "op-1",
    collaboration_mode: "solo",
    candidate_blueprint: { characters: [{ id: "pc-1" }] },
    candidate_blueprint_revision: "rev-pc-1",
    checks: [],
    status: "recorded",
    created_at: now,
    created_by: "writer",
    ...overrides,
  };
}

function baseState(artifacts: ArtifactRecord[], overrides: Record<string, unknown> = {}) {
  const state = createProjectState("project-1");
  return {
    ...state,
    project_name: "雪乃",
    artifacts,
    images: [],
    ...overrides,
  } as ReturnType<typeof createProjectState>;
}

function entryKinds(plan: PublishPlan): string[] {
  return plan.entries.map((entry) => entry.kind);
}

function characterArtifact(): ArtifactRecord {
  return artifact("character-1", { key: "character:yukino", content: JSON.stringify({ document: { id: "yukino" } }) });
}

describe("Audit 8 batch 11: project projection branches (#112 coverage)", () => {
  describe("parseArtifactValue and currentArtifactsFromRecords", () => {
    it("parses JSON object content and tolerates free text", () => {
      expect(parseArtifactValue(artifact("a", { content: JSON.stringify({ character_id: "yukino" }) }))).toEqual({ character_id: "yukino" });
      expect(parseArtifactValue(artifact("b", { content: "just text" }))).toEqual({});
      expect(parseArtifactValue(artifact("c", { content: "null" }))).toEqual({});
      expect(parseArtifactValue(artifact("d", { content: "[1, 2]" }))).toEqual([1, 2]);
    });

    it("keeps the latest artifact per key", () => {
      const records = [
        artifact("a1", { key: "character:yukino", revision: "rev-1" }),
        artifact("a2", { key: "character:yukino", revision: "rev-2" }),
        artifact("b1", { key: "zhuji:yukino", revision: "rev-1" }),
      ];
      const latest = currentArtifactsFromRecords(records);
      expect(latest.map((item) => item.id)).toEqual(["a2", "b1"]);
    });
  });

  describe("computeProjectProjection", () => {
    it("returns an empty projection when nothing is present", () => {
      const state = baseState([], { blueprint_prechecks: [] });
      const projection = computeProjectProjection(state);
      expect(projection.blueprint).toBeUndefined();
      expect(projection.intent.is_source_adaptation).toBe(false);
      expect(projection.intent.primary_character_id).toBeUndefined();
      expect(projection.roster).toEqual([]);
      expect(projection.factRegister).toEqual([]);
    });

    it("projects a structured JSON blueprint artifact", () => {
      const blueprint = artifact("bp-1", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify(blueprintJson()) });
      const projection = computeProjectProjection(baseState([blueprint], { blueprint_prechecks: [] }));
      const parsed = projection.blueprint;
      expect(parsed).toBeDefined();
      expect(parsed.artifact_id).toBe("bp-1");
      expect(parsed.artifact_revision).toBe("rev-1");
      expect(parsed.characters.map((character) => character.id)).toEqual(["yukino", "momoka"]);
      const yukino = parsed.characters[0];
      expect(yukino.ordinal).toBe(2);
      expect(yukino.mode).toBe("zhuji");
      expect(yukino.aliases).toEqual(["Yukinoshita", "雪乃"]);
      const momoka = parsed.characters[1];
      expect(momoka.label).toBe("Momoka");
      expect(momoka.ordinal).toBe(1);
      expect(parsed.primary_character_id).toBe("yukino");
      expect(parsed.primary_character_id_explicit).toBe(true);
      expect(parsed.world_enabled).toBe(true);
      expect(parsed.world_authoring_timing).toBe("early");
      expect(parsed.relationships_enabled).toBe(false);
      expect(parsed.source_adaptation).toBe(true);
      expect(parsed.artifact_value).toEqual(blueprintJson());
    });

    it("parses a legacy YAML blueprint with quoting, aliases and mixed id fields", () => {
      const blueprint = artifact("bp-2", { key: "blueprint:main", kind: "blueprint", content: blueprintYaml() });
      const projection = computeProjectProjection(baseState([blueprint], { blueprint_prechecks: [] }));
      const parsed = projection.blueprint;
      expect(parsed.characters.map((character) => character.id)).toEqual(["yukino", "momoka"]);
      expect(parsed.characters[0].label).toBe("Yukino");
      expect(parsed.characters[0].mode).toBe("zhuji");
      expect(parsed.characters[1].label).toBe("Momoka");
      expect(parsed.characters[1].aliases).toEqual(["白雪"]);
      expect(parsed.world_enabled).toBe(true);
      expect(parsed.relationships_enabled).toBe(true);
      expect(parsed.source_adaptation).toBe(false);
    });

    it("returns no blueprint for YAML without characters or a primary id", () => {
      const blueprint = artifact("bp-3", { key: "blueprint:main", kind: "blueprint", content: "some: free-form\nnotes: here" });
      const projection = computeProjectProjection(baseState([blueprint], { blueprint_prechecks: [] }));
      expect(projection.blueprint).toBeUndefined();
    });

    it("prefers a precheck roster when the artifact has none", () => {
      const blueprint = artifact("bp-4", { key: "blueprint:main", kind: "blueprint", content: "{}" });
      const state = baseState([blueprint], {
        blueprint_prechecks: [precheck({ candidate_blueprint: { characters: [{ id: "pc-1", mode: "palette" }] } })],
      });
      const projection = computeProjectProjection(state);
      expect(projection.blueprint.characters.map((character) => character.id)).toEqual(["pc-1"]);
      expect(projection.blueprint.precheck_id).toBe("precheck-1");
      expect(projection.blueprint.precheck_revision).toBe("rev-pc-1");
      expect(projection.blueprint.precheck_value).toEqual({ characters: [{ id: "pc-1", mode: "palette" }] });
      expect(projection.blueprint.world_enabled).toBe(false);
      expect(projection.blueprint.relationships_enabled).toBe(false);
    });

    it("prefers the precheck value when both sources carry a roster", () => {
      const blueprint = artifact("bp-5", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "from-artifact" }] }) });
      const state = baseState([blueprint], {
        blueprint_prechecks: [precheck({ candidate_blueprint: { characters: [{ id: "from-precheck" }] } })],
      });
      const projection = computeProjectProjection(state);
      expect(projection.blueprint.characters.map((character) => character.id)).toEqual(["from-precheck"]);
    });

    it("builds the intent projection from interview flow and blueprint primary", () => {
      const blueprint = artifact("bp-6", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify(blueprintJson()) });
      const state = baseState([blueprint], { blueprint_prechecks: [] });
      const intent = computeProjectIntentProjection(state);
      expect(intent.is_source_adaptation).toBe(true);
      expect(intent.primary_character_id).toBe("yukino");
      expect(intent.roster.find((character) => character.id === "yukino").is_primary).toBe(true);
      expect(intent.roster.find((character) => character.id === "momoka").is_primary).toBe(false);

      const plainBlueprint = artifact("bp-6b", { key: "blueprint:main", kind: "blueprint", content: blueprintYaml() });
      expect(computeProjectIntentProjection(baseState([plainBlueprint], { blueprint_prechecks: [] })).is_source_adaptation).toBe(false);

      const adaptationState = baseState([blueprint], { interview: { ...state.interview, flow: "source_adaptation" } });
      expect(computeProjectIntentProjection(adaptationState).is_source_adaptation).toBe(true);
    });
  });

  describe("computePublishPlan", () => {
    it("keeps all artifacts when no blueprint roster exists and skips mode artifacts without a mode", () => {
      const review = artifact("review-1", { key: "review:1", kind: "review", content: "x" });
      const zhuji = artifact("zhuji-1", { key: "zhuji:yukino:appearance", kind: "zhuji", content: JSON.stringify({ character_id: "yukino" }) });
      const plan = computePublishPlan(baseState([characterArtifact(), review, zhuji], { blueprint_prechecks: [] }));
      expect(entryKinds(plan)).toEqual(["character"]);
      expect(plan.export_roster).toEqual([]);
      expect(plan.primary_character_id).toBe("yukino");
      expect(plan.primary_character_id_explicit).toBe(false);
      expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "PRIMARY_CHARACTER_ID_FALLBACK")).toBe(true);
    });

    it("excludes review artifacts and respects world and relationship toggles", () => {
      const review = artifact("review-1", { key: "review:1", kind: "review", content: "x" });
      const world = artifact("world-1", { key: "world_lore:main", kind: "world_lore", content: "x" });
      const relationship = artifact("rel-1", { key: "relationship:rel", kind: "relationship", content: "x" });
      const closed = artifact("bp-7", {
        key: "blueprint:main",
        kind: "blueprint",
        content: JSON.stringify({ characters: [{ id: "yukino" }], world: { enabled: false }, relationships: { enabled: false } }),
      });
      const closedPlan = computePublishPlan(baseState([review, world, relationship, closed], { blueprint_prechecks: [] }));
      expect(closedPlan.entries.map((entry) => entry.key)).toEqual(["blueprint:main"]);
      const open = artifact("bp-7b", {
        key: "blueprint:main",
        kind: "blueprint",
        content: JSON.stringify({ characters: [{ id: "yukino" }], world: { enabled: true }, relationships: { enabled: true } }),
      });
      const openPlan = computePublishPlan(baseState([review, world, relationship, open], { blueprint_prechecks: [] }));
      expect(openPlan.entries.map((entry) => entry.key)).toEqual(["world_lore:main", "relationship:rel", "blueprint:main"]);
    });

    it("filters zhuji and palette artifacts by the selected mode", () => {
      const zhuji = artifact("zhuji-1", { key: "zhuji:yukino:appearance", kind: "zhuji", content: JSON.stringify({ character_id: "yukino" }) });
      const palette = artifact("palette-1", { key: "palette:yukino", kind: "palette", content: JSON.stringify({ character_id: "yukino" }) });
      const blueprint = artifact("bp-8", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino" }] }) });
      const zhujiPlan = computePublishPlan(baseState([characterArtifact(), zhuji, palette, blueprint], { blueprint_prechecks: [] }), "zhuji");
      expect(entryKinds(zhujiPlan)).toEqual(["character", "zhuji", "blueprint"]);
      expect(zhujiPlan.mode_selection).toBe("zhuji");
      const both = computePublishPlan(baseState([characterArtifact(), zhuji, palette, blueprint], { blueprint_prechecks: [] }), "both");
      expect(entryKinds(both)).toEqual(["character", "zhuji", "palette", "blueprint"]);
      const inferred = computePublishPlan(baseState([characterArtifact(), zhuji, blueprint], { blueprint_prechecks: [] }), undefined, { inferMode: true });
      expect(inferred.mode_selection).toBe("zhuji");
    });

    it("reports an excluded explicit primary as an error", () => {
      const blueprint = artifact("bp-9", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino", mode: "palette" }], primary_character_id: "yukino" }) });
      const plan = computePublishPlan(baseState([blueprint], { blueprint_prechecks: [] }), "zhuji");
      expect(plan.primary_character_id).toBeUndefined();
      expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "PRIMARY_CHARACTER_EXCLUDED_BY_MODE")).toBe(true);
    });

    it("warns and falls back when the explicit primary is unknown", () => {
      const blueprint = artifact("bp-10", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino" }], primary_character_id: "ghost" }) });
      const plan = computePublishPlan(baseState([blueprint], { blueprint_prechecks: [] }));
      expect(plan.primary_character_id).toBe("yukino");
      expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "PRIMARY_CHARACTER_ID_INVALID")).toBe(true);
    });

    it("drops artifacts bound to characters outside the export roster", () => {
      const zhuji = artifact("zhuji-2", { key: "zhuji:other:appearance", kind: "zhuji", content: JSON.stringify({ character_id: "other" }) });
      const blueprint = artifact("bp-11", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino" }] }) });
      const plan = computePublishPlan(baseState([zhuji, blueprint], { blueprint_prechecks: [] }), "zhuji");
      expect(plan.entries.some((entry) => entry.key === "zhuji:other:appearance")).toBe(false);
    });

    it("drops mode-conflicting artifacts based on declared character modes", () => {
      const zhuji = artifact("zhuji-3", { key: "zhuji:yukino:appearance", kind: "zhuji", content: JSON.stringify({ character_id: "yukino" }) });
      const blueprint = artifact("bp-12", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino", mode: "palette" }] }) });
      const plan = computePublishPlan(baseState([zhuji, blueprint], { blueprint_prechecks: [] }), "zhuji");
      expect(plan.entries.some((entry) => entry.kind === "zhuji")).toBe(false);
    });

    it("keeps globally-bound artifacts regardless of the roster", () => {
      const greeting = artifact("greeting-1", {
        key: "greeting:yukino",
        kind: "greeting",
        content: JSON.stringify({ document: { greetings: [{ character_ids: ["yukino"], global: true }] } }),
      });
      const blueprint = artifact("bp-13", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino" }] }) });
      const plan = computePublishPlan(baseState([greeting, blueprint], { blueprint_prechecks: [] }));
      expect(entryKinds(plan)).toContain("greeting");
    });

    it("groups world and relationship artifact ids", () => {
      const world = artifact("world-1", { key: "world_lore:main", kind: "world_lore", content: "x" });
      const relationship = artifact("rel-1", { key: "relationship:rel", kind: "relationship", content: "x" });
      const blueprint = artifact("bp-14", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino" }], world: { enabled: true }, relationships: { enabled: true } }) });
      const plan = computePublishPlan(baseState([world, relationship, blueprint], { blueprint_prechecks: [] }));
      expect(plan.world_artifact_ids).toEqual(["world-1"]);
      expect(plan.relationship_artifact_ids).toEqual(["rel-1"]);
    });

    it("freezes plan objects and build plans mirror publish plans", () => {
      const blueprint = artifact("bp-15", { key: "blueprint:main", kind: "blueprint", content: JSON.stringify({ characters: [{ id: "yukino" }] }) });
      const state = baseState([characterArtifact(), blueprint], { blueprint_prechecks: [] });
      const plan = computePublishPlan(state);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.entries)).toBe(true);
      const build = computeBuildPlan(state);
      expect(build.entries.map((entry) => entry.key)).toEqual(plan.entries.map((entry) => entry.key));
    });
  });
});
