import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { loadAuthorProject } from "@card-workspace/project";
import { workflowStateSchema } from "@card-workspace/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("author MCP adapters", () => {
  it("runs a relationship task through exact context and specialized MCP proposal submission", async () => {
    const fixture = await setupMcpWorkspace("relationship-mcp", "original", "free", { secondCharacter: true, relationships: true });
    cleanups.push(fixture.workspace.cleanup);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "relationship-mcp");
    const relationshipRevision = loaded.sourceRevisions["relationships.yaml"]!;
    const blueprintRevision = loaded.sourceRevisions["blueprint.yaml"]!;
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "relationship-task", actor: "engine", occurredAt: "2026-07-18T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, revision: 1, stage: "authoring",
        artifacts: [{ id: "author-relationships.yaml", status: "draft", revision: relationshipRevision, contract: "relationships@1", updated_at: "2026-07-18T00:00:00.000Z", extensions: {} }],
        tasks: [{
          id: "create-relationships", kind: "create-relationships", status: "claimed", assigned_agent: "relationship-creator",
          capabilities: ["task.execute", "relationships.propose"],
          input_artifacts: [
            { id: "blueprint", revision: blueprintRevision, contract: "blueprint@1" },
            { id: "author-relationships.yaml", revision: relationshipRevision, contract: "relationships@1" },
          ],
          output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 3,
          lease: { id: "relationship-lease", owner: "relationship-creator", claimed_at: "2026-07-18T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" },
          extensions: { stage: "authoring", output_kind: "relationships", participant_ids: ["alice", "beth"] },
        }],
      }),
    });
    const { server } = await createMcpServer({ environment: { ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "relationship-creator" } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const context = await client.callTool({ name: "task_context", arguments: {
      project_id: "relationship-mcp", task_id: "create-relationships", lease_id: "relationship-lease", artifact_id: "author-relationships.yaml",
    } });
    expect(context.isError).not.toBe(true);
    expect(JSON.parse((context.content[0] as { text: string }).text)).toMatchObject({ result: {
      artifact: { id: "author-relationships.yaml", revision: relationshipRevision, contract: "relationships@1", content: { character_ids: ["alice", "beth"] } },
    } });
    const document = {
      ...loaded.relationships!,
      character_summaries: [
        { character_id: "alice", summary: "Leads the alliance." },
        { character_id: "beth", summary: "Challenges its assumptions." },
      ],
      perspectives: [
        { source_character_id: "alice", target_character_id: "alice", summary: "Accepts responsibility." },
        { source_character_id: "alice", target_character_id: "beth", summary: "Values dissent but fears delay." },
        { source_character_id: "beth", target_character_id: "alice", summary: "Respects resolve but resists control." },
        { source_character_id: "beth", target_character_id: "beth", summary: "Sees caution as discipline." },
      ],
    };
    const response = await client.callTool({ name: "character_submit_proposal", arguments: {
      project_id: "relationship-mcp", task_id: "create-relationships", lease_id: "relationship-lease",
      expected_workflow_revision: 1, event_id: "relationship-submitted", occurred_at: "2026-07-18T00:01:00.000Z",
      proposal: { schema_version: 1, id: "relationships-mcp-v1", owner: "relationship-creator", base_workflow_revision: 1, base_artifact_revision: relationshipRevision, value: { kind: "relationships", document } },
    } });
    expect(response.isError).not.toBe(true);
    const after = await loadAuthorProject(fixture.workspace.projectsRoot, "relationship-mcp");
    expect(after.workflow?.tasks[0]).toMatchObject({ status: "completed" });
    expect(after.workflow?.artifacts.find((item) => item.id === "author-relationships.yaml")).toMatchObject({ contract: "relationships@1" });
    await client.close();
    await server.close();
  });

  it("validates and atomically applies a proposal as the task result", async () => {
    const fixture = await setupMcpWorkspace("author-mcp");
    cleanups.push(fixture.workspace.cleanup);
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "create-task", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "authoring", tasks: [{
        id: "task-1", kind: "create-character", status: "claimed", assigned_agent: "zhuji-creator",
        capabilities: ["character.propose"], input_artifacts: [], output_contract: "proposal@1", dependencies: [],
        lease: { id: "lease-1", owner: "zhuji-creator", claimed_at: "2026-07-14T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" },
        attempt: 1, max_attempts: 3,
        extensions: { output_kind: "zhuji", character_id: "alice", module: "trait_dialogue" },
      }] }),
    });
    const authorPath = path.join(fixture.projectRoot, "characters/alice/zhuji/05-trait-dialogue.yaml");
    const before = await readFile(authorPath);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "author-mcp");
    const baseArtifactRevision = loaded.sourceRevisions["characters/alice/zhuji/05-trait-dialogue.yaml"];
    const corpus = "這是一段只由角色本人直接說出的完整長篇語料，用來固定她在特定人格特質下的語速、詞彙、情緒濃度與攻防方式，不包含動作、神態、場景旁白或第三人稱心理分析，並刻意延伸到足夠長度以通過一百個 Unicode 字元的最低限制，讓後續角色扮演能穩定模仿。";
    const { server } = await createMcpServer({ environment: { ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "zhuji-creator" } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "character_submit_proposal", arguments: {
      project_id: "author-mcp", task_id: "task-1", lease_id: "lease-1", agent_id: "character-critic",
      expected_workflow_revision: 1, event_id: "submit-proposal", occurred_at: "2026-07-14T00:01:00.000Z",
      proposal: {
        schema_version: 1, id: "proposal-1", owner: "zhuji-creator", base_workflow_revision: 1, base_artifact_revision: baseArtifactRevision,
        value: { kind: "zhuji", character_id: "alice", module: {
          schema_version: 1, mode: "zhuji", module: "trait_dialogue", title: "Trait dialogue", data: {
            人物說話節奏: "先短句試探，再用長句完整表態。",
            人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "直接", 方言痕跡: "無", 語氣助詞使用: "少", 語言情感程度: "高", 用詞程度選擇: "具體" },
            扮演關鍵要點: ["維持直接而穩定的聲線"],
            Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `Trait ${index + 1}`, Embodiments: ["Direct expression"], instant: [corpus, corpus, corpus], Results: ["Stable voice"] })),
          },
        } },
      },
    } });
    expect(response.isError).not.toBe(true);
    await expect(readFile(authorPath, "utf8")).resolves.toContain("Trait 1");
    expect(await readFile(authorPath)).not.toEqual(before);
    await expect(readFile(path.join(fixture.projectRoot, ".workflow/results/task-1/proposal-1.json"), "utf8")).resolves.toContain("proposal-1");
    await client.close();
    await server.close();
  });

  it("rejects Greeting findings whose evidence is absent from the exact target revision", async () => {
    const fixture = await setupMcpWorkspace("greeting-review-evidence");
    cleanups.push(fixture.workspace.cleanup);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "greeting-review-evidence");
    const targetRevision = loaded.sourceRevisions["greetings.yaml"]!;
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "create-review-task", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state, revision: 1, stage: "content_review",
        artifacts: [{ id: "author-greetings.yaml", status: "draft", revision: targetRevision, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
        tasks: [{
          id: "review-greetings", kind: "review-greetings", status: "claimed", assigned_agent: "greetings-critic",
          capabilities: ["task.execute", "review.submit"], input_artifacts: [], output_contract: "review-report@1", dependencies: [],
          lease: { id: "review-lease", owner: "greetings-critic", claimed_at: "2026-07-14T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" },
          attempt: 1, max_attempts: 3, extensions: { stage: "content_review" },
        }],
      }),
    });
    const { server } = await createMcpServer({ environment: { ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "greetings-critic" } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "review_submit_report", arguments: {
      project_id: "greeting-review-evidence", task_id: "review-greetings", lease_id: "review-lease",
      expected_workflow_revision: 1, event_id: "fake-review", occurred_at: "2026-07-14T00:01:00.000Z",
      report: {
        schema_version: 1, id: "fake-greeting-review", reviewer: "greetings-critic",
        target_id: "author-greetings.yaml", target_revision: targetRevision,
        findings: [{ id: "invented-name-error", severity: "error", summary: "Invented typo", evidence: [{ source: "Greeting", excerpt: "這段文字根本不存在於正式開場白" }], hint: "Fix it", overridable: false }],
        summary: "Invalid evidence", extensions: {},
      },
    } });
    expect(response.isError).toBe(true);
    expect((response.content[0] as { text: string }).text).toContain("REVIEW_EVIDENCE_NOT_IN_TARGET");
    await client.close();
    await server.close();
  });
});
