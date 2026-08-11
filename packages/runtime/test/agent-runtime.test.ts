import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { AgentAdapter, AgentRegistry, AgentRouter, WorkspaceRuntime, type AgentDefinition, classifyIntent } from "../src/index.js";

describe("high-level agent compatibility layer", () => {
  it("keeps the legacy agent inventory and critic isolation", () => {
    const registry = new AgentRegistry();
    expect(registry.list()).toHaveLength(23);
    expect(registry.resolve("source-research")).toMatchObject({ id: "source-researcher", role: "researcher" });
    expect(registry.resolve("mvu-creator-critic")).toMatchObject({ id: "mvu-critic", read_only: true });
    expect(registry.list().filter((agent) => agent.role === "critic" || agent.role === "reviewer").every((agent) => agent.read_only === true)).toBe(true);
    expect(registry.aliasEntries().size).toBeGreaterThan(30);
    expect(registry.has("director")).toBe(true);
    expect(registry.has("missing-agent")).toBe(false);
  });

  it("rejects invalid custom registries early", () => {
    const valid: AgentDefinition = { id: "custom", role: "creator", prompt: "", personality: "", skills: ["skill"], intents: ["intent"] };
    expect(() => new AgentRegistry([valid, valid])).toThrow("Duplicate agent definition");
    expect(() => new AgentRegistry([{ ...valid, skills: [] }])).toThrow("must declare");
    expect(() => new AgentRegistry([valid], { alias: "missing" })).toThrow("unknown agent");
    expect(new AgentRegistry([valid], { " Alias ": "custom" }).resolve("alias")).toMatchObject({ id: "custom" });
  });

  it("routes natural language without low-level fields", () => {
    const router = new AgentRouter();
    expect(router.resolve("搜尋官方來源")).toMatchObject({ agent_id: "source-researcher", kind: "source" });
    expect(router.resolve("Review current character")).toMatchObject({ agent_id: "character-critic", kind: "review" });
    expect(router.resolve("Preview current card")).toMatchObject({ kind: "build" });
    expect(router.resolve("Create a palette mode")).toMatchObject({ agent_id: "palette-creator", kind: "authoring" });
    expect(router.resolve("@mvu-creator build an interaction")).toMatchObject({ agent_id: "mvu-creator", kind: "authoring", explicit: true });
    expect(router.registryView()).toBeInstanceOf(AgentRegistry);
  });

  it("covers specialist routes for each preserved role", () => {
    const router = new AgentRouter();
    expect(router.resolve("Refresh knowledge")).toMatchObject({ agent_id: "fact-curator", kind: "knowledge" });
    expect(router.resolve("Review facts")).toMatchObject({ agent_id: "fact-reviewer-1", kind: "review" });
    expect(router.resolve("Import legacy card")).toMatchObject({ agent_id: "card-import-analyst", kind: "import" });
    expect(router.resolve("Review world lore")).toMatchObject({ agent_id: "world-lore-critic" });
    expect(router.resolve("Review greeting")).toMatchObject({ agent_id: "greetings-critic" });
    expect(router.resolve("Review MVU plugin")).toMatchObject({ agent_id: "mvu-critic" });
    expect(router.resolve("Review EJS plugin")).toMatchObject({ agent_id: "ejs-critic" });
    expect(router.resolve("Review HTML plugin")).toMatchObject({ agent_id: "html-critic" });
    expect(router.resolve("Create zhuji")).toMatchObject({ agent_id: "zhuji-creator" });
    expect(router.resolve("Convert zhuji to palette")).toMatchObject({ agent_id: "mode-conversion", kind: "authoring" });
    expect(router.resolve("Create relationship")).toMatchObject({ agent_id: "relationship-creator" });
    expect(router.resolve("Create greeting")).toMatchObject({ agent_id: "greetings-creator" });
    expect(router.resolve("Create world lore")).toMatchObject({ agent_id: "world-lore-creator" });
    expect(router.resolve("建立角色衣櫃清單")).toMatchObject({ agent_id: "wardrobe-creator", kind: "authoring" });
    expect(router.resolve("Create MVU plugin")).toMatchObject({ agent_id: "mvu-creator" });
    expect(router.resolve("Create EJS plugin")).toMatchObject({ agent_id: "ejs-creator" });
    expect(router.resolve("Create HTML plugin")).toMatchObject({ agent_id: "html-creator" });
    expect(router.resolve("Create a character")).toMatchObject({ agent_id: "director", kind: "authoring" });
    expect(classifyIntent("目前狀態")).toBe("status");
    expect(classifyIntent("something else")).toBe("unknown");
  });

  it("rejects an explicit agent name that is not in the trusted registry", () => {
    expect(() => new AgentRouter().resolve("建立角色", "does-not-exist")).toThrowError(expect.objectContaining({ code: "AGENT_UNKNOWN" }));
  });

  it("exposes proposal capabilities without allowing a critic to author", () => {
    const registry = new AgentRegistry();
    expect(registry.canSubmitProposal("palette-creator", "palette")).toBe(true);
    expect(registry.canSubmitProposal("zhuji-creator", "palette")).toBe(false);
    expect(registry.canSubmitProposal("html-creator", "zhuji")).toBe(false);
    expect(registry.canSubmitProposal("mvu-creator", "plugin", "official.mvu-zod")).toBe(true);
    expect(registry.canSubmitProposal("html-creator", "plugin", "official.mvu-zod")).toBe(false);
    expect(registry.canSubmitProposal("character-critic", "palette")).toBe(false);
    expect(registry.canSubmitProposal("character-critic", "review", "character")).toBe(true);
    expect(registry.canSubmitProposal("character-critic", "review", "world")).toBe(false);
    expect(registry.canSubmitProposal("mvu-critic", "review", "plugin official.mvu-zod")).toBe(true);
    expect(registry.canSubmitProposal("character-critic", "review", "plugin official.mvu-zod")).toBe(false);
  });

  it("honors explicit specialist roles and tolerates a reduced registry", () => {
    const router = new AgentRouter();
    expect(router.resolve("anything", "fact-curator")).toMatchObject({ agent_id: "fact-curator", kind: "knowledge", explicit: true });
    expect(router.resolve("anything", "mvu-critic")).toMatchObject({ agent_id: "mvu-critic", kind: "review", explicit: true });
    expect(router.resolve("anything", "card-import-analyst")).toMatchObject({ agent_id: "card-import-analyst", kind: "import", explicit: true });
    expect(router.resolve("anything", "mode-conversion")).toMatchObject({ agent_id: "mode-conversion", kind: "authoring", explicit: true });
    expect(router.resolve("refresh reviewer")).toMatchObject({ agent_id: "fact-reviewer-1", kind: "knowledge" });

    const reduced = new AgentRegistry([
      { id: "director", role: "orchestrator", prompt: "", personality: "", skills: ["skill"], intents: ["route"] },
    ], {});
    expect(new AgentRouter(reduced).resolve("Create a palette")).toMatchObject({ agent_id: "director", kind: "authoring" });

    const permissive = new AgentRegistry([
      { id: "odd", role: "unsupported" as AgentDefinition["role"], prompt: "", personality: "", skills: ["skill"], intents: ["route"] },
    ], {});
    expect(new AgentRouter(permissive).resolve("status", "odd")).toMatchObject({ agent_id: "odd", kind: "status", explicit: true });
  });

  it("uses the adapter while preserving the existing runtime result shape", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const adapter = new AgentAdapter(runtime);
    expect(adapter.resolve("搜尋官方來源")).toMatchObject({ agent_id: "source-researcher" });
    const result = await runtime.submitTemplateProposal(
      { kind: "character", document: { schema_version: 1, id: "adapter", display_name: "Adapter", summary: "A calm character." } },
      { actor: "writer", attachments: [] },
    );
    expect(result.status).toBe("completed");
    expect((await repository.read()).audit.find((event) => event.event === "operation.created")?.details).toMatchObject({ agent_id: "director" });
    expect(adapter.list().find((agent) => agent.id === "director")).toMatchObject({ role: "orchestrator", prompt: ".agents/agents/director.md" });
  });

  it("routes refresh-intent import requests to the import analyst before the knowledge curator", () => {
    const router = new AgentRouter();
    expect(router.resolve("Refresh imported cards")).toMatchObject({ agent_id: "card-import-analyst", kind: "import" });
    expect(router.resolve("Refresh knowledge")).toMatchObject({ agent_id: "fact-curator", kind: "knowledge" });
  });

  describe("BUG2-07: review execution identity & critic capability", () => {
    it("allows different execution agents with the same transport actor 'server' to review (BUG2-07)", async () => {
      const repository = new MemoryProjectRepository("demo-review-identity");
      const runtime = new WorkspaceRuntime(repository);
      const created = await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "yukino-review", display_name: "Yukino", summary: "A complete character document with enough content for review." } },
        { actor: "server", attachments: [] },
        { agent: "director" },
      );
      expect(created.status).toBe("completed");

      const reviewed = await runtime.request("Review current character", { actor: "server", attachments: [] }, { agent: "character-critic" });
      expect(reviewed.status).toBe("completed");
      expect(reviewed.summary).not.toContain("已阻擋作者自審");
    });

    it("blocks review when artifact creator and reviewer execution agents are identical (BUG2-07)", async () => {
      const repository = new MemoryProjectRepository("demo-self-review-block");
      const runtime = new WorkspaceRuntime(repository);
      await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "self-review", display_name: "Self", summary: "Character for self review test." } },
        { actor: "user-actor-1", attachments: [] },
        { agent: "director" },
      );

      const reviewed = await runtime.request("Review current character", { actor: "user-actor-2", attachments: [] }, { agent: "director" });
      expect(reviewed.status).toBe("blocked");
      expect(reviewed.summary).toContain("已阻擋作者自審");
    });

    it("yields consistent results for typed review proposal and natural-language review (BUG2-07)", async () => {
      const repository = new MemoryProjectRepository("demo-review-consistency");
      const runtime = new WorkspaceRuntime(repository);
      await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "consistency", display_name: "Consistency", summary: "Character document for consistency." } },
        { actor: "server", attachments: [] },
        { agent: "director" },
      );

      const naturalResult = await runtime.request("Review current character", { actor: "server", attachments: [] }, { agent: "character-critic" });
      expect(naturalResult.status).toBe("completed");
    });

    it("does not route character artifact review to fact-reviewer-1 (BUG2-07)", () => {
      const router = new AgentRouter();
      const resolution = router.resolve("Review current character");
      expect(resolution.agent_id).not.toBe("fact-reviewer-1");
      expect(resolution.agent_id).toBe("character-critic");
    });

    it("returns needs_input when target artifact cannot be safely determined (BUG2-07)", async () => {
      const repository = new MemoryProjectRepository("demo-ambiguous-review");
      const runtime = new WorkspaceRuntime(repository);
      const result = await runtime.request("Review current artifact", { actor: "server", attachments: [] });
      expect(result.status).toBe("needs_input");
    });
  });

  describe("BUG2-08: operation execution snapshot & recovery identity stability", () => {
    it("persists execution_snapshot and restores original creator identity upon crash recovery (BUG2-08)", async () => {
      const repository = new MemoryProjectRepository("demo-recovery-creator");
      const runtime = new WorkspaceRuntime(repository);
      const created = await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "crash-test", display_name: "Crash", summary: "Character document for crash recovery test." } },
        { actor: "server", attachments: [] },
        { agent: "director" },
      );
      expect(created.status).toBe("completed");
      const state = await repository.read();
      const op = state.operations.find((o) => o.id === created.operation_id);
      expect(op?.execution_snapshot?.execution_agent_id).toBe("director");

      // Simulate crash: set operation status back to running
      await repository.commit(state.revision, (s) => ({
        ...s,
        operations: s.operations.map((o) => o.id === created.operation_id ? { ...o, status: "running" as const } : o),
      }));

      // Recover operation
      const recovered = await runtime.recoverOperation(created.operation_id!, { actor: "server", attachments: [] });
      expect(recovered.agent_id).toBe("director");
    });

    it("restores original reviewer identity across crash recovery (BUG2-08)", async () => {
      const repository = new MemoryProjectRepository("demo-recovery-reviewer");
      const runtime = new WorkspaceRuntime(repository);
      await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "reviewer-test", display_name: "ReviewerTest", summary: "Document for reviewer recovery test." } },
        { actor: "server", attachments: [] },
        { agent: "director" },
      );
      const reviewRes = await runtime.request("Review current character", { actor: "server", attachments: [] }, { agent: "character-critic" });
      expect(reviewRes.status).toBe("completed");

      const state = await repository.read();
      const op = state.operations.find((o) => o.id === reviewRes.operation_id)!;
      expect(op.execution_snapshot?.execution_agent_id).toBe("character-critic");

      // Reset operation status to running
      await repository.commit(state.revision, (s) => ({
        ...s,
        operations: s.operations.map((o) => o.id === reviewRes.operation_id ? { ...o, status: "running" as const } : o),
      }));

      const recovered = await runtime.recoverOperation(reviewRes.operation_id!, { actor: "different-actor", attachments: [] });
      expect(recovered.agent_id).toBe("character-critic");
    });

    it("uses execution_snapshot even if router state or request resolution changes (BUG2-08)", async () => {
      const repository = new MemoryProjectRepository("demo-snapshot-over-router");
      const runtime = new WorkspaceRuntime(repository);
      const created = await runtime.submitTemplateProposal(
        { kind: "greetings", document: { schema_version: 1, greetings: [{ id: "greeting-1", kind: "primary", content: "Hello!", character_ids: ["c1"] }] } },
        { actor: "server", attachments: [] },
        { agent: "greetings-creator" },
      );
      const state = await repository.read();
      const op = state.operations.find((o) => o.id === created.operation_id)!;
      expect(op.execution_snapshot?.execution_agent_id).toBe("greetings-creator");

      await repository.commit(state.revision, (s) => ({
        ...s,
        operations: s.operations.map((o) => o.id === created.operation_id ? { ...o, status: "running" as const } : o),
      }));

      const recovered = await runtime.recoverOperation(created.operation_id!, { actor: "server", attachments: [] });
      expect(recovered.agent_id).toBe("greetings-creator");
    });
  });

  describe("BUG2-09: source selection recovery payload shape & validation", () => {
    it("handles { payload: { decisions } } crash-window round trip for source_select (BUG2-09)", async () => {
      const repository = new MemoryProjectRepository("demo-source-select-recovery");
      const runtime = new WorkspaceRuntime(repository);

      // Register candidate first
      await repository.commit(0, (state) => ({
        ...state,
        candidates: [{ id: "candidate-09", title: "Candidate 09", status: "approved" as const, content: "valid content" }],
      }));

      const selectResult = await runtime.selectSourceCandidates(
        [{ candidate_id: "candidate-09", decision: "approve" }],
        { actor: "server", attachments: [] },
      );
      expect(selectResult.status).toBe("completed");

      const state = await repository.read();
      const op = state.operations.find((o) => o.id === selectResult.operation_id)!;
      expect(op.command?.type).toBe("source_select");
      expect(op.command?.payload).toEqual({ decisions: [{ candidate_id: "candidate-09", decision: "approve" }] });

      // Reset operation status to running without domain audit marker to simulate crash window
      await repository.commit(state.revision, (s) => ({
        ...s,
        audit: s.audit.filter((a) => a.event !== "source.selection.updated"),
        operations: s.operations.map((o) => o.id === selectResult.operation_id ? { ...o, status: "running" as const } : o),
      }));

      const recovered = await runtime.recoverOperation(selectResult.operation_id!, { actor: "server", attachments: [] });
      expect(recovered.status).toBe("completed");
      expect(recovered.completed).toContain("candidate-09");
    });

    it("safely recovers legacy array payload for source_select (BUG2-09)", async () => {
      const repository = new MemoryProjectRepository("demo-legacy-array-recovery");
      const runtime = new WorkspaceRuntime(repository);

      await repository.commit(0, (state) => ({
        ...state,
        candidates: [{ id: "candidate-legacy", title: "Legacy Candidate", status: "approved" as const, content: "valid content" }],
        operations: [{
          id: "op-legacy-select",
          kind: "source" as const,
          request: "select source candidates",
          actor: "server",
          status: "running" as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          progress: [],
          command: {
            version: 1 as const,
            type: "source_select" as const,
            payload: [{ candidate_id: "candidate-legacy", decision: "approve" }], // Legacy array shape
          },
        }],
      }));

      const recovered = await runtime.recoverOperation("op-legacy-select", { actor: "server", attachments: [] });
      expect(recovered.status).toBe("completed");
      expect(recovered.completed).toContain("candidate-legacy");
    });

    it("rejects malformed source_select payload and enters needs_input diagnostic (BUG2-09)", async () => {
      const repository = new MemoryProjectRepository("demo-malformed-payload");
      const runtime = new WorkspaceRuntime(repository);

      await repository.commit(0, (state) => ({
        ...state,
        operations: [{
          id: "op-malformed-select",
          kind: "source" as const,
          request: "select source candidates",
          actor: "server",
          status: "running" as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          progress: [],
          command: {
            version: 1 as const,
            type: "source_select" as const,
            payload: { invalid_key: 123 }, // Malformed payload
          },
        }],
      }));

      const recovered = await runtime.recoverOperation("op-malformed-select", { actor: "server", attachments: [] });
      expect(recovered.status).toBe("needs_input");
      expect(recovered.summary).toContain("payload 格式無效或缺失");
    });

    it("does not duplicate side effects when replaying already completed source_select (BUG2-09)", async () => {
      const repository = new MemoryProjectRepository("demo-no-duplicate-side-effect");
      const runtime = new WorkspaceRuntime(repository);

      await repository.commit(0, (state) => ({
        ...state,
        candidates: [{ id: "candidate-dup", title: "Dup Candidate", status: "approved" as const, content: "valid content" }],
      }));

      const first = await runtime.selectSourceCandidates(
        [{ candidate_id: "candidate-dup", decision: "approve" }],
        { actor: "server", attachments: [] },
      );
      expect(first.status).toBe("completed");

      const state = await repository.read();
      // Set operation to running while keeping audit marker
      await repository.commit(state.revision, (s) => ({
        ...s,
        operations: s.operations.map((o) => o.id === first.operation_id ? { ...o, status: "running" as const } : o),
      }));

      const replayed = await runtime.recoverOperation(first.operation_id!, { actor: "server", attachments: [] });
      expect(replayed.status).toBe("completed");
    });
  });
});
