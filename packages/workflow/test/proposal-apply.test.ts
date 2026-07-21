import { readFile } from "node:fs/promises";
import path from "node:path";

import { computeTextRevision, initializeProject, loadAuthorProject } from "@card-workspace/project";
import { projectManifestSchema, workflowStateSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { applyProposal, commitWorkflowMutation } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function setup(agent = "zhuji-creator") {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "proposal-demo",
      title: "Proposal",
      kind: "character_card",
      card: { name: "Proposal" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  await commitWorkflowMutation(projectRoot, {
    expectedRevision: 0,
    eventId: "task-created",
    actor: "engine",
    occurredAt: "2026-07-14T00:00:00.000Z",
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: 1,
      gates: [
        { id: "facts", status: "approved", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [], extensions: {} },
      ],
      tasks: [{
        id: "task-1", kind: "module-proposal", status: "pending", assigned_agent: agent,
        capabilities: agent.includes("critic") ? ["review"] : ["author-write"], input_artifacts: [],
        output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 2,
        extensions: agent === "world-lore-creator" ? {} : { output_kind: "zhuji", character_id: "alice", module: "trait_dialogue" },
      }],
    }),
  });
  return { workspace, projectRoot };
}

function moduleProposal(owner: string, baseRevision: string) {
  const corpus = "這是一段只由角色本人直接說出的完整長篇語料，用來固定她在特定人格特質下的語速、詞彙、情緒濃度與攻防方式，不包含動作、神態、場景旁白或第三人稱心理分析，並刻意延伸到足夠長度以通過一百個 Unicode 字元的最低限制，讓後續角色扮演能穩定模仿。";
  return {
    schema_version: 1,
    id: "proposal-1",
    owner,
    base_workflow_revision: 1,
    base_artifact_revision: baseRevision,
    value: {
      kind: "zhuji",
      character_id: "alice",
      module: {
        schema_version: 1, mode: "zhuji", module: "trait_dialogue", title: "特質語料",
        data: {
          Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["直接表達內在立場"], instant: [corpus, corpus, corpus], Results: ["使互動維持一致聲線"] })),
          扮演關鍵要點: ["維持直接而穩定的聲線"],
          人物說話節奏: "先短句試探，再用長句完整表態。",
          人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "直接", 方言痕跡: "無", 語氣助詞使用: "少", 語言情感程度: "高", 用詞程度選擇: "具體" },
        },
      },
    },
  };
}

describe("proposal apply", () => {
  it("strictly owns and applies the unique relationships document with relationships@1", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1, id: "relationships-proposal", title: "Relationships", kind: "character_card", card: { name: "Relationships" },
        characters: [
          { id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" },
          { id: "beth", display_name: "Beth", mode: "palette", role: "supporting" },
        ],
      }),
      relationships: { enabled: true, character_ids: ["alice", "beth"] },
    });
    const loaded = await loadAuthorProject(workspace.projectsRoot, "relationships-proposal");
    const baseRevision = loaded.sourceRevisions["relationships.yaml"]!;
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0, eventId: "relationship-task", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "authoring", tasks: [
        {
          id: "revise-alice", kind: "create-character", status: "pending", assigned_agent: "zhuji-creator",
          capabilities: ["task.execute", "character.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 3,
          extensions: { stage: "authoring", output_kind: "character", character_id: "alice" },
        },
        {
          id: "create-relationships", kind: "create-relationships", status: "pending", assigned_agent: "relationship-creator",
          capabilities: ["task.execute", "relationships.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: ["revise-alice"], attempt: 0, max_attempts: 3,
          extensions: { stage: "authoring", output_kind: "relationships", participant_ids: ["alice", "beth"] },
        },
      ] }),
    });
    const characterRevision = loaded.sourceRevisions["characters/alice/character.yaml"]!;
    const characterResult = await applyProposal({
      projectsRoot: workspace.projectsRoot, projectId: "relationships-proposal", taskId: "revise-alice",
      proposal: { schema_version: 1, id: "alice-v2", owner: "zhuji-creator", base_workflow_revision: 1, base_artifact_revision: characterRevision, value: { kind: "character", document: { ...loaded.characters.find((item) => item.manifest.id === "alice")!.document, summary: "Updated participant identity." } } },
      eventId: "alice-applied", occurredAt: "2026-07-14T00:00:15.000Z",
    });
    expect(characterResult.state.tasks.find((item) => item.id === "create-relationships")?.input_artifacts).toContainEqual(expect.objectContaining({ id: "author-characters-alice-character.yaml" }));
    const document = {
      ...loaded.relationships!,
      character_summaries: [
        { character_id: "alice", summary: "Leads while guarding trust." },
        { character_id: "beth", summary: "Tests the alliance before committing." },
      ],
      perspectives: [
        { source_character_id: "alice", target_character_id: "alice", summary: "Sees herself as responsible." },
        { source_character_id: "alice", target_character_id: "beth", summary: "Trusts her skill, not her silence." },
        { source_character_id: "beth", target_character_id: "alice", summary: "Relies on her but resists control." },
        { source_character_id: "beth", target_character_id: "beth", summary: "Knows she avoids commitment." },
      ],
    };
    await expect(applyProposal({
      projectsRoot: workspace.projectsRoot, projectId: "relationships-proposal", taskId: "create-relationships",
      proposal: { schema_version: 1, id: "relationships-wrong", owner: "zhuji-creator", base_workflow_revision: 2, base_artifact_revision: baseRevision, value: { kind: "relationships", document } },
      eventId: "wrong-owner", occurredAt: "2026-07-14T00:00:30.000Z",
    })).rejects.toMatchObject({ code: "PROPOSAL_OWNER_MISMATCH" });
    await expect(applyProposal({
      projectsRoot: workspace.projectsRoot, projectId: "relationships-proposal", taskId: "create-relationships",
      proposal: { schema_version: 1, id: "relationships-code-change", owner: "relationship-creator", base_workflow_revision: 2, base_artifact_revision: baseRevision, value: { kind: "relationships", document: { ...document, team_code: "ZZZZZZ" } } },
      eventId: "changed-team-code", occurredAt: "2026-07-14T00:00:45.000Z",
    })).rejects.toMatchObject({ code: "PROPOSAL_RELATIONSHIPS_TEAM_CODE_CHANGED" });
    const result = await applyProposal({
      projectsRoot: workspace.projectsRoot, projectId: "relationships-proposal", taskId: "create-relationships",
      proposal: { schema_version: 1, id: "relationships-v1", owner: "relationship-creator", base_workflow_revision: 2, base_artifact_revision: baseRevision, value: { kind: "relationships", document } },
      eventId: "relationship-applied", occurredAt: "2026-07-14T00:01:00.000Z",
    });
    expect(result.targets).toEqual(["relationships.yaml"]);
    expect(result.state.artifacts.find((artifact) => artifact.id === "author-relationships.yaml")).toMatchObject({ contract: "relationships@1" });
    await expect(readFile(path.join(projectRoot, "relationships.yaml"), "utf8")).resolves.toContain("Trusts her skill");

  });

  it("由 task 與 typed value 推導路徑，並原子更新作者檔、result、journal 與 projection", async () => {
    const { workspace, projectRoot } = await setup();
    const target = path.join(projectRoot, "characters/alice/zhuji/05-trait-dialogue.yaml");
    const revision = computeTextRevision(await readFile(target));
    const result = await applyProposal({
      projectsRoot: workspace.projectsRoot,
      projectId: "proposal-demo",
      taskId: "task-1",
      proposal: moduleProposal("zhuji-creator", revision),
      eventId: "proposal-applied",
      occurredAt: "2026-07-14T00:01:00.000Z",
    });
    expect(result.targets).toEqual(["characters/alice/zhuji/05-trait-dialogue.yaml"]);
    const written = await readFile(target, "utf8");
    expect(written).toContain("特質1");
    expect(written.indexOf("人物說話節奏:")).toBeLessThan(written.indexOf("Traits:"));
    await expect(readFile(path.join(projectRoot, result.resultPath), "utf8")).resolves.toContain('"proposal-1"');
    const loaded = await loadAuthorProject(workspace.projectsRoot, "proposal-demo");
    expect(loaded.workflow).toMatchObject({ revision: 2, tasks: [{ id: "task-1", status: "completed" }] });
    expect(loaded.workflow?.gates.map((gate) => [gate.id, gate.status])).toEqual([
      ["facts", "approved"], ["blueprint", "approved"], ["content", "superseded"], ["publish", "superseded"],
    ]);
  });

  it("Blueprint proposal preserves an approved Facts Gate", async () => {
    const { workspace, projectRoot } = await setup("director");
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 1,
      eventId: "blueprint-task-replaced",
      actor: "engine",
      occurredAt: "2026-07-14T00:00:30.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 2,
        tasks: [{
          ...state.tasks[0]!, id: "create-blueprint", kind: "create-blueprint", assigned_agent: "director",
          capabilities: ["task.execute", "blueprint.propose"], extensions: { stage: "blueprint" },
        }],
      }),
    });
    const loaded = await loadAuthorProject(workspace.projectsRoot, "proposal-demo");
    const blueprintRevision = loaded.sourceRevisions["blueprint.yaml"]!;
    const proposal = {
      schema_version: 1,
      id: "blueprint-proposal",
      owner: "director",
      base_workflow_revision: 2,
      base_artifact_revision: blueprintRevision,
      value: { kind: "blueprint", document: { ...loaded.blueprint!, purpose: "Adapt reviewed exact facts." } },
    };
    const result = await applyProposal({
      projectsRoot: workspace.projectsRoot,
      projectId: "proposal-demo",
      taskId: "create-blueprint",
      proposal,
      eventId: "blueprint-applied",
      occurredAt: "2026-07-14T00:01:00.000Z",
    });
    expect(result.state.gates.find((gate) => gate.id === "facts")?.status).toBe("approved");
    expect(result.state.gates.find((gate) => gate.id === "blueprint")?.status).toBe("superseded");
  });

  it("多作者文件、task result、journal 與 projection 使用同一交易", async () => {
    const { workspace, projectRoot } = await setup("world-lore-creator");
    const proposal = {
      schema_version: 1, id: "world-proposal", owner: "world-lore-creator", base_workflow_revision: 1,
      value: { kind: "world", entries: [
        { schema_version: 1, id: "capital", category: "geography", title: "王都", content: "中央城市", related_ids: ["guild"] },
        { schema_version: 1, id: "guild", category: "organizations", title: "公會", content: "冒險者組織", related_ids: ["capital"] },
      ] },
    };
    const result = await applyProposal({
      projectsRoot: workspace.projectsRoot, projectId: "proposal-demo", taskId: "task-1", proposal,
      eventId: "world-applied", occurredAt: "2026-07-14T00:01:00.000Z",
      expectedArtifactRevisions: {
        "world/geography/capital.yaml": "absent",
        "world/organizations/guild.yaml": "absent",
      },
    });
    expect(result.targets).toHaveLength(2);
    await expect(readFile(path.join(projectRoot, "world/geography/capital.yaml"), "utf8")).resolves.toContain("王都");
    await expect(readFile(path.join(projectRoot, "world/organizations/guild.yaml"), "utf8")).resolves.toContain("公會");
    await expect(readFile(path.join(projectRoot, result.resultPath), "utf8")).resolves.toContain("world-proposal");
  });

  it("Critic read-only，且 stale base 不留下任何作者變更", async () => {
    const critic = await setup("character-critic");
    const criticTarget = path.join(critic.projectRoot, "characters/alice/zhuji/05-trait-dialogue.yaml");
    const criticRaw = await readFile(criticTarget);
    await expect(applyProposal({
      projectsRoot: critic.workspace.projectsRoot, projectId: "proposal-demo", taskId: "task-1",
      proposal: moduleProposal("character-critic", computeTextRevision(criticRaw)),
      eventId: "critic-write", occurredAt: "2026-07-14T00:01:00.000Z",
    })).rejects.toMatchObject({ code: "PROPOSAL_CRITIC_READ_ONLY" });
    await expect(readFile(criticTarget)).resolves.toEqual(criticRaw);

    const stale = await setup();
    const staleTarget = path.join(stale.projectRoot, "characters/alice/zhuji/05-trait-dialogue.yaml");
    const before = await readFile(staleTarget);
    await expect(applyProposal({
      projectsRoot: stale.workspace.projectsRoot, projectId: "proposal-demo", taskId: "task-1",
      proposal: moduleProposal("zhuji-creator", `sha256:${"f".repeat(64)}`),
      eventId: "stale-write", occurredAt: "2026-07-14T00:01:00.000Z",
    })).rejects.toMatchObject({ code: "PROPOSAL_ARTIFACT_REVISION_CONFLICT" });
    await expect(readFile(staleTarget)).resolves.toEqual(before);
  });

  it("拒絕無效 proposal schema 與過期 workflow revision", async () => {
    const invalid = await setup();
    await expect(applyProposal({
      projectsRoot: invalid.workspace.projectsRoot, projectId: "proposal-demo", taskId: "task-1",
      proposal: { schema_version: 1 }, eventId: "invalid-proposal", occurredAt: "2026-07-14T00:01:00.000Z",
    })).rejects.toMatchObject({ code: "PROPOSAL_SCHEMA_INVALID" });

    const stale = await setup();
    const target = path.join(stale.projectRoot, "characters/alice/zhuji/05-trait-dialogue.yaml");
    const proposal = { ...moduleProposal("zhuji-creator", computeTextRevision(await readFile(target))), base_workflow_revision: 0 };
    await expect(applyProposal({
      projectsRoot: stale.workspace.projectsRoot, projectId: "proposal-demo", taskId: "task-1",
      proposal, eventId: "stale-workflow", occurredAt: "2026-07-14T00:01:00.000Z",
    })).rejects.toMatchObject({ code: "PROPOSAL_WORKFLOW_REVISION_CONFLICT" });
  });
});
