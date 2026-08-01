/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalYaml,
  computeRevision,
  computeTextRevision,
  initializeProject,
  loadAuthorProject,
  paletteModuleFiles,
  zhujiModuleFiles,
} from "@card-workspace/project";
import { projectManifestSchema, workflowStateSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { applyModeConversion, commitWorkflowMutation } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const sha = "sha256:" + "a".repeat(64);
const occurredAt = "2026-07-24T00:00:00.000Z";

function manifest(id: string, mode: "zhuji" | "palette") {
  return projectManifestSchema.parse({
    schema_version: 1,
    id,
    title: "Conversion branches",
    kind: "character_card",
    card: { name: "Conversion branches" },
    characters: [{ id: "alice", display_name: "Alice", mode, role: "primary" }],
  });
}

function taskState(state: ReturnType<typeof workflowStateSchema.parse>, taskId: string, extra = false) {
  return workflowStateSchema.parse({
    ...state,
    revision: 1,
    tasks: [
      {
        id: taskId,
        kind: "conversion-proposal",
        status: "pending",
        assigned_agent: "mode-conversion",
        capabilities: ["author-write"],
        input_artifacts: [],
        output_contract: "proposal@1",
        dependencies: [],
        attempt: 0,
        max_attempts: 2,
        extensions: {},
      },
      ...(extra ? [{
        id: "other-task",
        kind: "content-review",
        status: "pending" as const,
        assigned_agent: "character-critic",
        capabilities: ["task.execute"],
        input_artifacts: [],
        output_contract: "review@1",
        dependencies: [],
        attempt: 0,
        max_attempts: 2,
        extensions: {},
      }] : []),
    ],
  });
}

function modulesFor<T extends "zhuji" | "palette">(mode: T, withProvenance = false) {
  const layout = mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
  return layout.map((item, index) => ({
    schema_version: 1 as const,
    mode,
    module: item.kind,
    title: item.title,
    content: "Converted module " + item.kind,
    ...(withProvenance && index === 0 ? {
      sections: [{
        id: "fact-section",
        title: "Fact section",
        content: "Fact-backed content",
        provenance: [
          { kind: "fact" as const, ref: "fact-source", requires_single_value: true },
          { kind: "fact" as const, ref: "fact-creative" },
        ],
      }],
    } : {}),
  }));
}

function proposal(
  taskId: string,
  sourceMode: "zhuji" | "palette",
  targetMode: "zhuji" | "palette",
  modules: unknown[],
  mappings: Array<{ source: string; target: string; summary: string }>,
  id = "conversion-branches-1",
) {
  return {
    schema_version: 1,
    id,
    owner: "mode-conversion",
    base_workflow_revision: 1,
    value: {
      kind: "conversion",
      character_id: "alice",
      source_mode: sourceMode,
      target_mode: targetMode,
      modules,
      mappings,
    },
  };
}

function expectedTargets(
  characterId: string,
  mode: "zhuji" | "palette",
  existing?: { file: string; revision: string },
) {
  const layout = mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
  return Object.fromEntries(layout.map((item) => [
    "characters/" + characterId + "/" + mode + "/" + item.file,
    existing?.file === item.file ? existing.revision : "absent",
  ]));
}

describe("conversion branch matrix", () => {
  it("converts palette to zhuji with accepted and creative provenance and preserves unrelated tasks", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest("conversion-zhuji", "zhuji") });
    const initial = await loadAuthorProject(workspace.projectsRoot, "conversion-zhuji");
    const fact = {
      schema_version: 1 as const,
      id: "fact-source",
      subject: "alice",
      predicate: "appearance.hair",
      value: "silver",
      classification: "source_fact" as const,
      confidence: 1,
      scope: { character_ids: ["alice"], extensions: {} },
      valid_time: { extensions: {} },
      evidence: [{
        id: "evidence-1",
        source_id: "novel",
        source_revision_id: sha,
        chunk_set_id: "set-1",
        chunk_id: "chunk-1",
        chunk_hash: sha,
        quote: "silver hair",
        normalized_character_range: [0, 11] as [number, number],
        normalized_line_range: [1, 1] as [number, number],
        extensions: {},
      }],
      source_tiers: ["official" as const],
      status: "accepted" as const,
      fact_revision: 1,
      decision_id: "decision-1",
      created_by: "director",
      created_at: occurredAt,
      supersedes: [],
      decision_ids: ["decision-1"],
      extensions: {},
    };
    const creative = {
      ...fact,
      id: "fact-creative",
      classification: "creative_completion" as const,
      evidence: [],

    };
    const factState = { schema_version: 1 as const, facts: [fact, creative], extensions: {} };
    await writeFile(path.join(projectRoot, "facts", "register.yaml"), canonicalYaml({
      ...factState,
      revision: computeRevision(factState),
    }), "utf8");
    if (!initial.workflow) throw new Error("workflow missing");
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0,
      eventId: "conversion-zhuji-task",
      actor: "engine",
      occurredAt,
      update: (state) => taskState(state, "convert-zhuji", true),
    });

    const modules = modulesFor("palette", true);
    const mappings = zhujiModuleFiles.map((item) => ({ source: item.kind, target: "basic_information", summary: "Mapped " + item.kind }));
    const result = await applyModeConversion({
      projectsRoot: workspace.projectsRoot,
      projectId: "conversion-zhuji",
      taskId: "convert-zhuji",
      proposal: proposal("convert-zhuji", "zhuji", "palette", modules, mappings),
      eventId: "conversion-zhuji-applied",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette"),
    });
    expect(result.state.tasks.find((item) => item.id === "convert-zhuji")?.status).toBe("completed");
    expect(result.state.tasks.find((item) => item.id === "other-task")?.status).toBe("pending");
    expect(result.report.expected_semantic_loss).toEqual([]);
    expect(result.report.provenance).toEqual(["fact-creative", "fact-source"]);
  });

  it("uses the legacy zhuji source layout when expanded extension is present", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest("conversion-legacy", "zhuji") });
    const extensionPath = path.join(projectRoot, "characters", "alice", "zhuji", "03-extension.yaml");
    const extension = await readFile(extensionPath, "utf8");
    await writeFile(path.join(projectRoot, "characters", "alice", "zhuji", "04-expanded-extension.yaml"), extension.replace("module: extension", "module: expanded_extension"), "utf8");
    const refinementPath = path.join(projectRoot, "characters", "alice", "zhuji", "04-trait-refinement.yaml");
    await writeFile(path.join(projectRoot, "characters", "alice", "zhuji", "05-trait-refinement.yaml"), await readFile(refinementPath));
    await rm(refinementPath);
    await rm(path.join(projectRoot, "characters", "alice", "zhuji", "05-trait-dialogue.yaml"));
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0,
      eventId: "conversion-legacy-task",
      actor: "engine",
      occurredAt,
      update: (state) => taskState(state, "convert-legacy"),
    });
    const mappings = [
      "appearance", "inner_nature", "extension", "expanded_extension", "trait_refinement", "scene_dialogue", "self_introduction",
    ].map((source) => ({ source, target: "basic_information", summary: "Mapped legacy" }));
    const result = await applyModeConversion({
      projectsRoot: workspace.projectsRoot,
      projectId: "conversion-legacy",
      taskId: "convert-legacy",
      proposal: proposal("convert-legacy", "zhuji", "palette", modulesFor("palette"), mappings, "conversion-legacy-1"),
      eventId: "conversion-legacy-applied",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette"),
      expectedSemanticLoss: ["legacy layout"],
    });
    expect(result.report.source_mode).toBe("zhuji");
    expect(result.report.source_revisions["characters/alice/zhuji/04-expanded-extension.yaml"]).toMatch(/^sha256:/u);
  });

  it("rejects stale source mode, incomplete source, target revision conflict, and non-file target reads", async () => {
    const makeProject = async (id: string) => {
      const workspace = await makeTemporaryWorkspace();
      cleanups.push(workspace.cleanup);
      const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest(id, "zhuji") });
      await commitWorkflowMutation(projectRoot, {
        expectedRevision: 0,
        eventId: id + "-task",
        actor: "engine",
        occurredAt,
        update: (state) => taskState(state, id + "-task"),
      });
      return { workspace, projectRoot };
    };
    const stale = await makeProject("conversion-stale");
    await expect(applyModeConversion({
      projectsRoot: stale.workspace.projectsRoot,
      projectId: "conversion-stale",
      taskId: "conversion-stale-task",
      proposal: proposal("conversion-stale-task", "palette", "zhuji", modulesFor("zhuji"), [{ source: "appearance", target: "appearance", summary: "Map" }]),
      eventId: "conversion-stale-apply",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "zhuji"),
    })).rejects.toMatchObject({ code: "CONVERSION_PROPOSAL_INVALID" });

    const incomplete = await makeProject("conversion-incomplete");
    await rm(path.join(incomplete.projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml"));
    await expect(applyModeConversion({
      projectsRoot: incomplete.workspace.projectsRoot,
      projectId: "conversion-incomplete",
      taskId: "conversion-incomplete-task",
      proposal: proposal("conversion-incomplete-task", "zhuji", "palette", modulesFor("palette"), [{ source: "appearance", target: "basic_information", summary: "Map" }]),
      eventId: "conversion-incomplete-apply",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette"),
      expectedSemanticLoss: ["missing source"],
    })).rejects.toMatchObject({ code: "CONVERSION_PROJECT_INVALID" });

    const conflict = await makeProject("conversion-target-conflict");
    const targetPath = path.join(conflict.projectRoot, "characters", "alice", "palette", "01-basic-information.yaml");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "existing: true\n", "utf8");
    await mkdir(path.join(conflict.projectRoot, "characters", "alice", "mode-history"), { recursive: true });
    await expect(applyModeConversion({
      projectsRoot: conflict.workspace.projectsRoot,
      projectId: "conversion-target-conflict",
      taskId: "conversion-target-conflict-task",
      proposal: proposal("conversion-target-conflict-task", "zhuji", "palette", modulesFor("palette"), [{ source: "appearance", target: "basic_information", summary: "Map" }]),
      eventId: "conversion-target-conflict-apply",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette", { file: "01-basic-information.yaml", revision: "sha256:" + "0".repeat(64) }),
      expectedSemanticLoss: ["other source"],
    })).rejects.toMatchObject({ code: "CONVERSION_TARGET_REVISION_CONFLICT" });

    const nonFile = await makeProject("conversion-target-directory");
    await mkdir(path.join(nonFile.projectRoot, "characters", "alice", "palette", "01-basic-information.yaml"), { recursive: true });
    await mkdir(path.join(nonFile.projectRoot, "characters", "alice", "mode-history"), { recursive: true });
    await expect(applyModeConversion({
      projectsRoot: nonFile.workspace.projectsRoot,
      projectId: "conversion-target-directory",
      taskId: "conversion-target-directory-task",
      proposal: proposal("conversion-target-directory-task", "zhuji", "palette", modulesFor("palette"), [{ source: "appearance", target: "basic_information", summary: "Map" }]),
      eventId: "conversion-target-directory-apply",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette"),
      expectedSemanticLoss: ["other source"],
    })).rejects.toThrow();
  });

  it("accepts an existing target revision and rejects an unresolved single-value conflict", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest("conversion-existing-target", "zhuji") });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0,
      eventId: "conversion-existing-task",
      actor: "engine",
      occurredAt,
      update: (state) => taskState(state, "conversion-existing-task"),
    });
    const targetPath = path.join(projectRoot, "characters", "alice", "palette", "01-basic-information.yaml");
    await mkdir(path.dirname(targetPath), { recursive: true });
    const targetRaw = "schema_version: 1\nmode: palette\nmodule: basic_information\ntitle: Existing\ncontent: Existing target\n";
    await writeFile(targetPath, targetRaw, "utf8");
    await mkdir(path.join(projectRoot, "characters", "alice", "mode-history"), { recursive: true });
    const result = await applyModeConversion({
      projectsRoot: workspace.projectsRoot,
      projectId: "conversion-existing-target",
      taskId: "conversion-existing-task",
      proposal: proposal("conversion-existing-task", "zhuji", "palette", modulesFor("palette"), [{ source: "appearance", target: "basic_information", summary: "Map" }]),
      eventId: "conversion-existing-applied",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette", { file: "01-basic-information.yaml", revision: computeTextRevision(targetRaw) }),
      expectedSemanticLoss: ["other source"],
    });
    expect(result.state.revision).toBe(2);

    const conflictWorkspace = await makeTemporaryWorkspace();
    cleanups.push(conflictWorkspace.cleanup);
    const conflictRoot = await initializeProject({ projectsRoot: conflictWorkspace.projectsRoot, manifest: manifest("conversion-open-conflict", "zhuji") });
    const initial = await loadAuthorProject(conflictWorkspace.projectsRoot, "conversion-open-conflict");
    const fact = {
      schema_version: 1 as const,
      id: "fact-source",
      subject: "alice",
      predicate: "appearance.hair",
      value: "silver",
      classification: "source_fact" as const,
      confidence: 1,
      scope: { character_ids: ["alice"], extensions: {} },
      valid_time: { extensions: {} },
      evidence: [{
        id: "evidence-1", source_id: "novel", source_revision_id: sha, chunk_set_id: "set-1", chunk_id: "chunk-1", chunk_hash: sha,
        quote: "silver hair", normalized_character_range: [0, 11] as [number, number], normalized_line_range: [1, 1] as [number, number], extensions: {},
      }],
      source_tiers: ["official" as const],
      status: "accepted" as const,
      fact_revision: 1,
      decision_id: "decision-1",
      created_by: "director",
      created_at: occurredAt,
      supersedes: [],
      decision_ids: ["decision-1"],
      extensions: {},
    };
    const factState = { schema_version: 1 as const, facts: [fact], extensions: {} };
    await writeFile(path.join(conflictRoot, "facts", "register.yaml"), canonicalYaml({ ...factState, revision: computeRevision(factState) }), "utf8");
    const conflictState = {
      schema_version: 1 as const,
      conflicts: [{
        schema_version: 1 as const,
        id: "conflict-1",
        subject: "alice",
        predicate: "appearance.hair",
        scope: { character_ids: ["alice"], extensions: {} },
        valid_time: { extensions: {} },
        members: [
          { fact_id: "fact-source", source_id: "novel", source_revision_id: sha, value: "silver" },
          { candidate_id: "candidate-1", source_id: "novel", source_revision_id: sha, value: "gold" },
        ],
        status: "open" as const,
        opened_at: occurredAt,
        updated_at: occurredAt,
        extensions: {},
      }],
      extensions: {},
    };
    await writeFile(path.join(conflictRoot, "facts", "conflicts.yaml"), canonicalYaml({ ...conflictState, revision: computeRevision(conflictState) }), "utf8");
    await commitWorkflowMutation(conflictRoot, {
      expectedRevision: 0,
      eventId: "conversion-conflict-task",
      actor: "engine",
      occurredAt,
      update: (state) => taskState(state, "conversion-conflict-task"),
    });
    const conflictModules = modulesFor("palette", true) as Array<Record<string, any>>;
    if (conflictModules[0]?.sections?.[0]) conflictModules[0].sections[0].provenance = [conflictModules[0].sections[0].provenance[0]];
    await expect(applyModeConversion({
      projectsRoot: conflictWorkspace.projectsRoot,
      projectId: "conversion-open-conflict",
      taskId: "conversion-conflict-task",
      proposal: proposal("conversion-conflict-task", "zhuji", "palette", conflictModules, [{ source: "appearance", target: "basic_information", summary: "Map" }]),
      eventId: "conversion-conflict-apply",
      occurredAt,
      expectedTargetRevisions: expectedTargets("alice", "palette"),
      expectedSemanticLoss: ["other source"],
    })).rejects.toMatchObject({ code: "PROPOSAL_FACT_CONFLICT_UNRESOLVED" });
    expect(initial.ok).toBe(true);
  });
});
