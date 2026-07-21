import { cp, utimes } from "node:fs/promises";
import path from "node:path";

import { loadAuthorProject, validateProject } from "@card-workspace/project";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { authorizeWorkspaceTool } from "../src/authorization.js";
import { createTrustedContext } from "../src/context.js";
import { toolRegistry } from "../src/tool-registry.js";
import { repositoryRoot } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("workspace bootstrap tools", () => {
  it("allows only the Director capability and initializes a complete project", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await cp(path.join(repositoryRoot, "workflow"), path.join(workspace.root, "workflow"), { recursive: true });
    const trusted = await createTrustedContext({
      CARD_WORKSPACE_ROOT: workspace.root,
      CARD_WORKSPACE_AGENT_ID: "director",
    });
    expect(authorizeWorkspaceTool({
      agentId: "director",
      toolName: "project_initialize",
      config: trusted.config,
    })).toEqual({ capability: "workspace.initialize" });
    expect(() => authorizeWorkspaceTool({
      agentId: "zhuji-creator",
      toolName: "project_initialize",
      config: trusted.config,
    })).toThrow(/not authorized/u);
    expect(authorizeWorkspaceTool({
      agentId: "director",
      toolName: "project_list",
      config: trusted.config,
    })).toEqual({ capability: "workspace.discover" });
    expect(() => authorizeWorkspaceTool({
      agentId: "card-import-analyst",
      toolName: "project_list",
      config: trusted.config,
    })).toThrow(/not authorized/u);

    const tool = toolRegistry.project_initialize;
    expect(tool?.scope).toBe("workspace");
    if (!tool || tool.scope !== "workspace") throw new Error("project_initialize is not workspace-scoped");
    await tool.handler({
      trusted,
      args: {
        project_id: "new-card",
        title: "New Card",
        entry_kind: "source_adaptation",
        collaboration_mode: "assisted",
        characters: [
          { display_name: "Alice", mode: "zhuji" },
          { display_name: "Beth", mode: "palette" },
        ],
        world: { enabled: true, authoring_timing: "after_characters", categories: ["concepts"] },
        relationships: {
          enabled: true,
          character_ids: ["character-1", "character-2"],
          requirements: ["保留競爭與合作的雙向差異"],
        },
        occurred_at: "2026-07-14T00:00:00.000Z",
        intake_answers: [{ decision_id: "intake-concept", question_id: "concept", answer: "Two rivals cooperate" }],
      },
    });
    const foundation = await validateProject(workspace.projectsRoot, "new-card");
    expect(foundation.workflow?.project_id).toBe("new-card");
    expect(foundation.workflow?.entry_kind).toBe("source_adaptation");
    expect(foundation.workflow?.workflow_definition_id).toBe("source-adaptation-v1");
    expect(foundation.workflow?.decisions).toMatchObject([
      { id: "creative-collaboration-mode", kind: "creative-collaboration.mode", option: "assisted" },
      { id: "intake-concept", kind: "interview.answer", summary: "Two rivals cooperate" },
    ]);
    expect(foundation.blueprint?.entry_kind).toBe("source_adaptation");
    expect(foundation.blueprint?.collaboration_mode).toBe("assisted");
    expect(foundation.blueprint?.world.authoring_timing).toBe("after_characters");
    expect(foundation.blueprint?.relationships).toMatchObject({
      enabled: true,
      character_ids: ["character-1", "character-2"],
    });
    const authorProject = await loadAuthorProject(workspace.projectsRoot, "new-card");
    expect(authorProject.relationships?.character_ids).toEqual(["character-1", "character-2"]);
    expect(authorProject.relationships?.perspectives.some((perspective) => (
      perspective.source_character_id === "character-1" && perspective.target_character_id === "character-2"
    ))).toBe(true);
    expect(authorProject.relationships?.perspectives.some((perspective) => (
      perspective.source_character_id === "character-2" && perspective.target_character_id === "character-1"
    ))).toBe(true);
    expect(foundation.manifest?.characters).toEqual([
      { id: "character-1", display_name: "Alice", mode: "zhuji", role: "primary" },
      { id: "character-2", display_name: "Beth", mode: "palette", role: "primary" },
    ]);
    await tool.handler({
      trusted,
      args: {
        project_id: "new-worldbook",
        title: "New Worldbook",
        kind: "worldbook",
        entry_kind: "original",
        collaboration_mode: "free",
        characters: [],
        world: { enabled: true, categories: ["concepts"], scope: "A standalone setting" },
        occurred_at: "2026-07-14T00:00:00.000Z",
        intake_answers: [{ decision_id: "world-concept", question_id: "concept", answer: "A standalone setting" }],
      },
    });
    const worldbook = await validateProject(workspace.projectsRoot, "new-worldbook");
    expect(worldbook).toMatchObject({
      ok: true,
      manifest: { kind: "worldbook", characters: [] },
      blueprint: { world: { enabled: true, authoring_timing: "before_characters" }, greetings: { enabled: false } },
    });
    const listTool = toolRegistry.project_list;
    if (!listTool || listTool.scope !== "workspace") throw new Error("project_list is not workspace-scoped");
    const listed = await listTool.handler({ trusted, args: { query: "new-card" } }) as {
      projects: Array<Record<string, unknown>>;
    };
    expect(listed.projects).toMatchObject([{
      project_id: "new-card",
      title: "New Card",
      entry_kind: "source_adaptation",
      stage: "intake",
      revision: 0,
      routing: "active",
    }]);
    expect(typeof listed.projects[0]?.last_modified_at).toBe("string");
    await utimes(path.join(workspace.projectsRoot, "new-card", "workflow.json"), new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    await utimes(path.join(workspace.projectsRoot, "new-worldbook", "workflow.json"), new Date("2026-02-01T00:00:00.000Z"), new Date("2026-02-01T00:00:00.000Z"));
    const recent = await listTool.handler({ trusted, args: { limit: 1 } }) as {
      projects: Array<{ project_id: string }>;
    };
    expect(recent.projects.map((project) => project.project_id)).toEqual(["new-worldbook"]);
    await expect(tool.handler({
      trusted,
      args: {
        project_id: "new-card",
        title: "Overwrite",
        entry_kind: "original",
        collaboration_mode: "free",
        characters: [{ display_name: "Alice", mode: "zhuji" }],
        occurred_at: "2026-07-14T00:00:00.000Z",
        intake_answers: [{ decision_id: "overwrite", question_id: "concept", answer: "Overwrite" }],
      },
    })).rejects.toMatchObject({ code: "PROJECT_EXISTS" });
  });
});
