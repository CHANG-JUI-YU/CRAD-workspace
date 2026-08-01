import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { initializeProject, loadAuthorProject, paletteModuleFiles, zhujiModuleFiles } from "@card-workspace/project";
import { projectManifestSchema, workflowStateSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { applyModeConversion, commitWorkflowMutation } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("mode conversion", () => {
  it("完整封存來源模式、寫入目標固定模組後才切換 active mode", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1, id: "conversion-demo", title: "Conversion", kind: "character_card",
        card: { name: "Conversion" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
      }),
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0, eventId: "conversion-task", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, tasks: [{
        id: "convert-1", kind: "conversion-proposal", status: "pending", assigned_agent: "mode-conversion",
        capabilities: ["author-write"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
        attempt: 0, max_attempts: 2, extensions: {},
      }] }),
    });
    const modules = paletteModuleFiles.map((item) => ({
      schema_version: 1 as const, mode: "palette" as const, module: item.kind,
      title: item.title, content: `轉換：${item.title}`,
    }));
    const expectedTargetRevisions = Object.fromEntries(paletteModuleFiles.map((item) => [
      `characters/alice/palette/${item.file}`, "absent" as const,
    ]));
    const result = await applyModeConversion({
      projectsRoot: workspace.projectsRoot, projectId: "conversion-demo", taskId: "convert-1",
      proposal: {
        schema_version: 1, id: "conversion-1", owner: "mode-conversion", base_workflow_revision: 1,
        value: { kind: "conversion", character_id: "alice", source_mode: "zhuji", target_mode: "palette",
          modules, mappings: [{ source: "appearance", target: "basic-information", summary: "外觀收斂" }] },
      },
      eventId: "conversion-applied", occurredAt: "2026-07-14T00:01:00.000Z",
      expectedTargetRevisions, expectedSemanticLoss: ["七模組細節收斂為四模組"],
    });
    expect(result.archive).toHaveLength(8);
    await expect(readFile(path.join(projectRoot,
      "characters/alice/mode-history/conversion-1/zhuji/mapping-report.json"), "utf8"))
      .resolves.toContain("expected_semantic_loss");
    await expect(readFile(path.join(projectRoot, "characters/alice/zhuji/01-appearance.yaml"), "utf8"))
      .resolves.toContain("appearance");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "conversion-demo");
    expect(loaded.ok).toBe(true);
    expect(loaded.manifest?.characters[0]?.mode).toBe("palette");
    expect(loaded.diagnostics.map((item) => item.code)).not.toContain("CHARACTER_MODE_MIXED");
  });

  it("拒絕 stale task/proposal/source、缺漏模組、未宣告損失與錯誤 target CAS", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1, id: "conversion-errors", title: "Conversion", kind: "character_card",
        card: { name: "Conversion" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
      }),
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0, eventId: "conversion-task-errors", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, tasks: [{
        id: "convert-errors", kind: "conversion-proposal", status: "pending", assigned_agent: "mode-conversion",
        capabilities: ["author-write"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
        attempt: 0, max_attempts: 2, extensions: {},
      }] }),
    });
    const modules = paletteModuleFiles.map((item) => ({
      schema_version: 1 as const, mode: "palette" as const, module: item.kind,
      title: item.title, content: `轉換：${item.title}`,
    }));
    const expectedTargetRevisions = Object.fromEntries(paletteModuleFiles.map((item) => [
      `characters/alice/palette/${item.file}`, "absent" as const,
    ]));
    const baseProposal = {
      schema_version: 1, id: "conversion-errors", owner: "mode-conversion", base_workflow_revision: 1,
      value: {
        kind: "conversion", character_id: "alice", source_mode: "zhuji", target_mode: "palette",
        modules, mappings: [{ source: "appearance", target: "basic-information", summary: "外觀收斂" }],
      },
    };
    let event = 0;
    const apply = (proposal: unknown, overrides: Record<string, unknown> = {}) => applyModeConversion({
      projectsRoot: workspace.projectsRoot, projectId: "conversion-errors", taskId: "convert-errors",
      proposal, eventId: `event-${event += 1}`, occurredAt: "2026-07-14T00:01:00.000Z",
      expectedTargetRevisions, expectedSemanticLoss: ["收斂"], ...overrides,
    });

    await expect(apply(baseProposal, { taskId: "missing-task" })).rejects.toMatchObject({ code: "CONVERSION_TASK_STALE" });
    await expect(apply({})).rejects.toMatchObject({ code: "CONVERSION_PROPOSAL_INVALID" });
    await expect(apply({ ...baseProposal, value: { kind: "import_analysis", mappings: [] } }))
      .rejects.toMatchObject({ code: "CONVERSION_PROPOSAL_INVALID" });
    await expect(apply({ ...baseProposal, owner: "other" })).rejects.toMatchObject({ code: "PROPOSAL_OWNER_MISMATCH" });
    await expect(apply({ ...baseProposal, base_workflow_revision: 0 })).rejects.toMatchObject({ code: "PROPOSAL_WORKFLOW_REVISION_CONFLICT" });
    await expect(apply({ ...baseProposal, value: { ...baseProposal.value, source_mode: "palette", target_mode: "zhuji", modules: [] } }))
      .rejects.toMatchObject({ code: "CONVERSION_PROPOSAL_INVALID" });
    await expect(apply({ ...baseProposal, value: { ...baseProposal.value, modules: modules.slice(1) } }))
      .rejects.toMatchObject({ code: "CONVERSION_TARGET_INCOMPLETE" });
    await expect(apply(baseProposal, { expectedSemanticLoss: [] })).rejects.toMatchObject({ code: "CONVERSION_SEMANTIC_LOSS_UNDECLARED" });
    await expect(apply(baseProposal, { expectedTargetRevisions: {} })).rejects.toMatchObject({ code: "CONVERSION_EXPECTED_ABSENT_REQUIRED" });
    const sourceProject = await loadAuthorProject(workspace.projectsRoot, "conversion-errors");
    const staleModeModules = sourceProject.characters[0]!.modules.filter((module) => module.mode === "zhuji");
    await expect(apply({ ...baseProposal, value: { ...baseProposal.value, source_mode: "palette", target_mode: "zhuji", modules: staleModeModules } }))
      .rejects.toMatchObject({ code: "CONVERSION_PROPOSAL_INVALID" });
    const zhujiModules = zhujiModuleFiles.map((item) => ({
      schema_version: 1 as const, mode: "zhuji" as const, module: item.kind,
      title: item.title, content: "stale source mode",
    }));
    await expect(apply({
      ...baseProposal,
      value: { ...baseProposal.value, source_mode: "palette", target_mode: "zhuji", modules: zhujiModules },
    })).rejects.toMatchObject({ code: "CONVERSION_PROPOSAL_INVALID" });

    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 1, eventId: "conversion-contract", actor: "engine", occurredAt: "2026-07-14T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 2,
        tasks: state.tasks.map((task) => task.id === "convert-errors" ? { ...task, output_contract: "wrong@1" } : task),
      }),
    });
    await expect(apply({ ...baseProposal, base_workflow_revision: 2 })).rejects.toMatchObject({ code: "PROPOSAL_TASK_CONTRACT_MISMATCH" });

    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 2, eventId: "conversion-critic", actor: "engine", occurredAt: "2026-07-14T00:03:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 3,
        tasks: state.tasks.map((task) => task.id === "convert-errors" ? { ...task, output_contract: "proposal@1", assigned_agent: "conversion-critic" } : task),
      }),
    });
    await expect(apply({ ...baseProposal, base_workflow_revision: 3, owner: "conversion-critic" })).rejects.toMatchObject({ code: "PROPOSAL_CRITIC_READ_ONLY" });
    const targetPath = path.join(projectRoot, "characters/alice/palette/basic-information.yaml");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "existing: true\n", "utf8");
    await expect(apply(baseProposal)).rejects.toMatchObject({ code: "CONVERSION_PROJECT_INVALID" });
  });
});


describe("mode conversion provenance branches", () => {
  it("rejects a conversion module that references an unaccepted fact", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1, id: "conversion-provenance", title: "Conversion", kind: "character_card",
        card: { name: "Conversion" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
      }),
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0, eventId: "conversion-provenance-task", actor: "engine", occurredAt: "2026-07-23T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, tasks: [{
        id: "convert-provenance", kind: "conversion-proposal", status: "pending", assigned_agent: "mode-conversion",
        capabilities: ["author-write"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
        attempt: 0, max_attempts: 2, extensions: {},
      }] }),
    });
    const modules = paletteModuleFiles.map((item, index) => ({
      schema_version: 1 as const, mode: "palette" as const, module: item.kind,
      title: item.title, content: "Converted module",
      ...(index === 0 ? {
        sections: [{
          id: "fact-section",
          title: "Fact section",
          content: "Uses a missing fact",
          provenance: [{ kind: "fact" as const, ref: "missing-fact", requires_single_value: true }],
        }],
      } : {}),
    }));
    const expectedTargetRevisions = Object.fromEntries(paletteModuleFiles.map((item) => [
      "characters/alice/palette/" + item.file, "absent" as const,
    ]));
    await expect(applyModeConversion({
      projectsRoot: workspace.projectsRoot,
      projectId: "conversion-provenance",
      taskId: "convert-provenance",
      proposal: {
        schema_version: 1,
        id: "conversion-provenance-1",
        owner: "mode-conversion",
        base_workflow_revision: 1,
        value: {
          kind: "conversion",
          character_id: "alice",
          source_mode: "zhuji",
          target_mode: "palette",
          modules,
          mappings: [{ source: "appearance", target: "basic_information", summary: "Map appearance" }],
        },
      },
      eventId: "conversion-provenance-apply",
      occurredAt: "2026-07-23T00:01:00.000Z",
      expectedTargetRevisions,
      expectedSemanticLoss: ["legacy fields"],
    })).rejects.toMatchObject({ code: "PROPOSAL_FACT_NOT_ACCEPTED" });
  });
});
