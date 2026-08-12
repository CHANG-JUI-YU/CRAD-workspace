import { describe, expect, it } from "vitest";
import {
  computeProjectProjection,
  contentHash,
  createProjectState,
  MemoryProjectRepository,
  type ArtifactRecord,
  type OperationRecord,
} from "@st-workspace/core";
import { compileProject } from "@st-workspace/compiler";
import { AuthoringService } from "../src/index.js";

const projectId = "formal-artifact-publish";
const characterId = "character-1";
const characterName = "\u96ea\u4e4b\u4e0b\u967d\u4e43";

function operation(id: string): OperationRecord {
  const timestamp = "2026-08-12T00:00:00.000Z";
  return { id, kind: "authoring", request: id, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function blueprintArtifact(): ArtifactRecord {
  const content = JSON.stringify({
    schema_version: 1,
    kind: "blueprint",
    project_id: projectId,
    flow: "original",
    characters: [{ id: characterId, label: characterName, aliases: [], ordinal: 1 }],
    primary_character_id: characterId,
  });
  const hash = contentHash(content);
  const timestamp = "2026-08-12T00:00:00.000Z";
  return {
    id: "artifact-blueprint",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "project-blueprint",
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "director",
    operation_id: "op-blueprint",
  };
}

describe("formal artifact publish binding", () => {
  it("creates formal artifacts, plans them, and compiles their bound outputs", async () => {
    const repository = new MemoryProjectRepository(projectId);
    await repository.commit(0, (state) => ({
      ...createProjectState(projectId),
      ...state,
      project_name: "Formal Artifact Project",
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      artifacts: [blueprintArtifact()],
      operations: [operation("op-palette"), operation("op-wardrobe"), operation("op-greetings")],
    }));

    const authoring = new AuthoringService(repository);
    const palette = await authoring.createTemplate("op-palette", {
      kind: "palette",
      character_id: characterId,
      module: {
        schema_version: 1,
        mode: "palette",
        module: "basic_information",
        title: "\u57fa\u672c\u8cc7\u8a0a",
        content: "Palette lore",
        sections: {},
        provenance: [],
        extensions: {},
      },
    }, "palette-creator");
    const wardrobe = await authoring.createTemplate("op-wardrobe", {
      kind: "wardrobe",
      character_id: characterId,
      content: "# Wardrobe lore\n\n## Summary\n- total items: 1\n\n## Casual\n| Style | Color | Quantity |\n| --- | --- | ---: |\n| Daily | Blue | 1 |",
    }, "wardrobe-creator");
    const greetings = await authoring.createTemplate("op-greetings", {
      kind: "greetings",
      document: {
        schema_version: 1,
        greetings: [
          { id: "primary", kind: "primary", content: "Primary greeting", character_ids: [characterId] },
          { id: "alternate", kind: "alternate", content: "Alternate greeting", character_ids: [characterId] },
          { id: "group", kind: "group_only", content: "Group greeting", character_ids: [characterId] },
        ],
        extensions: {},
      },
    }, "greetings-creator");

    expect(palette.status).toBe("completed");
    expect(wardrobe.status).toBe("completed");
    expect(greetings.status).toBe("completed");

    const state = await repository.read();
    const formalArtifacts = state.artifacts.filter((artifact) => artifact.kind === "palette" || artifact.kind === "wardrobe" || artifact.kind === "greeting");
    expect(formalArtifacts.map((artifact) => artifact.key)).toEqual(expect.arrayContaining([
      `palette:${characterId}_002fbasic_005finformation`,
      `wardrobe:${characterId}_002fwardrobe`,
      "greeting:greetings",
    ]));

    const projection = computeProjectProjection(state);
    const plan = projection.publishPlan("both");
    for (const artifact of formalArtifacts) {
      expect(plan.entries.some((entry) => entry.artifact_id === artifact.id), `${artifact.kind}:${artifact.key}`).toBe(true);
    }

    const compiled = compileProject(state, { mode_selection: "palette" });
    const loreEntries = compiled.card.data.character_book?.entries ?? [];
    expect(compiled.card.data.description).toBe("");
    expect(compiled.card.data.personality).toBe("");
    expect(compiled.card.data.scenario).toBe("");
    expect(loreEntries.some((entry) => entry.content.includes("Palette lore"))).toBe(true);
    expect(loreEntries.some((entry) => entry.content.includes("Wardrobe lore"))).toBe(true);
    expect(compiled.card.data.first_mes).toBe("Primary greeting");
    expect(compiled.card.data.alternate_greetings).toEqual(["Alternate greeting"]);
    expect(compiled.card.data.group_only_greetings).toEqual(["Group greeting"]);
  });
});
