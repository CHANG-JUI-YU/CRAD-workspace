import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash } from "@st-workspace/core";
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
      const initial = await repository.read();
      const content = JSON.stringify({ document: { schema_version: 1, id: "self-review", display_name: "Self", summary: "Character for self review test." } });
      const hash = contentHash(content);
      await repository.commit(initial.revision, (state) => ({
        ...state,
        artifacts: [...state.artifacts, {
          id: "artifact-self-review",
          key: "character:self-review",
          kind: "character",
          name: "Self",
          content,
          media_type: "application/json",
          content_hash: hash,
          revision: hash,
          status: "draft",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: "character-critic",
          operation_id: "op-self-review",
        }],
      }));

      const reviewed = await runtime.request("Review current character", { actor: "user-actor-2", attachments: [] }, { agent: "character-critic" });
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

  describe("BUG2-07-08 review findings regressions", () => {
    it("keeps the snapshot execution agent authoritative over options.agent (finding 1)", async () => {
      const repository = new MemoryProjectRepository("demo-snapshot-authoritative");
      const runtime = new WorkspaceRuntime(repository);
      await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "authority", display_name: "Authority", summary: "Document for snapshot authority test." } },
        { actor: "server", attachments: [] },
        { agent: "director" },
      );
      const reviewRes = await runtime.request("Review current character", { actor: "server", attachments: [] }, { agent: "character-critic" });
      expect(reviewRes.status).toBe("completed");

      const state = await repository.read();
      await repository.commit(state.revision, (s) => ({
        ...s,
        operations: s.operations.map((o) => o.id === reviewRes.operation_id ? { ...o, status: "running" as const } : o),
      }));

      const recovered = await runtime.recoverOperation(reviewRes.operation_id!, { actor: "server", attachments: [] }, { agent: "fact-reviewer-1" });
      expect(recovered.agent_id).toBe("character-critic");
      const after = await repository.read();
      expect(after.reviews.at(-1)?.reviewer).toBe("character-critic");
      expect(after.audit.some((event) => event.event === "recovery.identity.snapshot_authoritative")).toBe(true);
    });

    it("restores the snapshot creator for natural authoring recovery (finding 3)", async () => {
      const repository = new MemoryProjectRepository("demo-authoring-recovery");
      const runtime = new WorkspaceRuntime(repository);
      const now = new Date().toISOString();
      await repository.commit(0, (state) => ({
        ...state,
        operations: [{
          id: "op-authoring-recover",
          kind: "authoring" as const,
          request: "Draft note: Create character: Resume. Personality: calm and clear.",
          actor: "server",
          status: "running" as const,
          created_at: now,
          updated_at: now,
          progress: [],
          execution_snapshot: {
            execution_agent_id: "director",
            execution_agent_role: "orchestrator",
            initiated_by: "server",
            route_kind: "authoring",
            created_at: now,
          },
        }],
      }));

      const recovered = await runtime.recoverOperation("op-authoring-recover", { actor: "server", attachments: [] });
      expect(recovered.status).toBe("completed");
      const after = await repository.read();
      expect(after.artifacts.at(-1)?.created_by).toBe("director");
    });

    it("restores the snapshot reviewer for natural review recovery (finding 3)", async () => {
      const repository = new MemoryProjectRepository("demo-review-recovery");
      const runtime = new WorkspaceRuntime(repository);
      const now = new Date().toISOString();
      const content = JSON.stringify({ document: { schema_version: 1, id: "review-target", display_name: "ReviewTarget", summary: "Document for review recovery." } });
      const hash = contentHash(content);
      await repository.commit(0, (state) => ({
        ...state,
        artifacts: [{
          id: "artifact-review-target",
          key: "character:review-target",
          kind: "character",
          name: "ReviewTarget",
          content,
          media_type: "application/json",
          content_hash: hash,
          revision: hash,
          status: "draft",
          created_at: now,
          updated_at: now,
          created_by: "director",
          operation_id: "op-review-create",
        }],
        operations: [{
          id: "op-review-recover",
          kind: "review" as const,
          request: "Review current character",
          actor: "server",
          status: "running" as const,
          created_at: now,
          updated_at: now,
          progress: [],
          execution_snapshot: {
            execution_agent_id: "character-critic",
            execution_agent_role: "critic",
            initiated_by: "server",
            route_kind: "review",
            target_artifact_id: "artifact-review-target",
            target_artifact_kind: "character",
            created_at: now,
          },
        }],
      }));

      const recovered = await runtime.recoverOperation("op-review-recover", { actor: "server", attachments: [] });
      expect(recovered.status).toBe("completed");
      const after = await repository.read();
      expect(after.reviews.at(-1)?.reviewer).toBe("character-critic");
    });

    it("asks for identity recovery when neither snapshot nor audit agent exists (finding 2)", async () => {
      const repository = new MemoryProjectRepository("demo-identity-recovery-required");
      const runtime = new WorkspaceRuntime(repository);
      const now = new Date().toISOString();
      await repository.commit(0, (state) => ({
        ...state,
        operations: [{
          id: "op-legacy-authoring",
          kind: "authoring" as const,
          request: "Draft note: Create character: Orphan. Personality: quiet.",
          actor: "server",
          status: "running" as const,
          created_at: now,
          updated_at: now,
          progress: [],
        }],
      }));

      const recovered = await runtime.recoverOperation("op-legacy-authoring", { actor: "server", attachments: [] });
      expect(recovered.status).toBe("needs_input");
      expect(recovered.summary).toContain("EXECUTION_IDENTITY_RECOVERY_REQUIRED");
      const after = await repository.read();
      expect(after.artifacts).toHaveLength(0);
    });

    it("persists a zhuji snapshot and keeps the creator across crash recovery (finding 4)", async () => {
      const repository = new MemoryProjectRepository("demo-zhuji-snapshot");
      const runtime = new WorkspaceRuntime(repository);
      await runtime.submitTemplateProposal(
        { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", summary: "Zhuji host character." } },
        { actor: "server", attachments: [] },
        { agent: "director" },
      );
      const zhuji = await runtime.submitZhujiProposal({
        kind: "zhuji",
        character_id: "demo",
        module: {
          schema_version: 1,
          mode: "zhuji",
          module: "trait_dialogue",
          title: "特質對話",
          data: {
            人物說話節奏: "冷靜、直接，句子短而有明確停頓。",
            人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "精準詞彙", 方言痕跡: "無", 語氣助詞使用: "克制", 語言情感程度: "低調", 用詞程度選擇: "正式" },
            扮演關鍵要點: ["先觀察再回答"],
            Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["在壓力下保持清晰"], instant: ["這是一段符合語料條件、包含自然標點的角色話語。"], Results: ["對話保持角色一致"] })),
          },
        },
      }, { actor: "server", attachments: [] }, { agent: "zhuji-creator" });
      expect(zhuji.status).toBe("completed");

      const state = await repository.read();
      const op = state.operations.find((o) => o.id === zhuji.operation_id);
      expect(op?.execution_snapshot?.execution_agent_id).toBe("zhuji-creator");
      await repository.commit(state.revision, (s) => ({
        ...s,
        operations: s.operations.map((o) => o.id === zhuji.operation_id ? { ...o, status: "running" as const } : o),
      }));

      const recovered = await runtime.recoverOperation(zhuji.operation_id!, { actor: "server", attachments: [] });
      expect(recovered.agent_id).toBe("zhuji-creator");
    });

    it("routes a generic review to the world-lore critic when only a world artifact exists (finding 5)", async () => {
      const repository = new MemoryProjectRepository("demo-world-only-review");
      const runtime = new WorkspaceRuntime(repository);
      const now = new Date().toISOString();
      const content = JSON.stringify({ document: { schema_version: 1, id: "world", display_name: "World", summary: "World lore document." } });
      const hash = contentHash(content);
      await repository.commit(0, (state) => ({
        ...state,
        artifacts: [{
          id: "artifact-world",
          key: "world_lore:world",
          kind: "world_lore",
          name: "World",
          content,
          media_type: "application/json",
          content_hash: hash,
          revision: hash,
          status: "draft",
          created_at: now,
          updated_at: now,
          created_by: "director",
          operation_id: "op-world-create",
        }],
      }));

      const reviewed = await runtime.request("Review current artifact", { actor: "server", attachments: [] });
      expect(reviewed.status).toBe("completed");
      const after = await repository.read();
      expect(after.reviews.at(-1)?.reviewer).toBe("world-lore-critic");
    });

    it("selects the critic that matches each artifact kind (finding 5)", async () => {
      const cases: Array<{ key: string; kind: "greeting" | "world_lore" | "character" | "plugin"; content: string; expected: string }> = [
        { key: "greeting:g1", kind: "greeting", content: JSON.stringify({ document: { schema_version: 1, greetings: [{ id: "g1", kind: "primary", content: "Hello!", character_ids: ["c1"] }] } }), expected: "greetings-critic" },
        { key: "world_lore:w1", kind: "world_lore", content: JSON.stringify({ document: { schema_version: 1, id: "w1", display_name: "World", summary: "World lore." } }), expected: "world-lore-critic" },
        { key: "character:c1", kind: "character", content: JSON.stringify({ document: { schema_version: 1, id: "c1", display_name: "Char", summary: "Character." } }), expected: "character-critic" },
        { key: "plugin:mvu", kind: "plugin", content: JSON.stringify({ plugin_id: "official.mvu-zod", document: { schema_version: 1 } }), expected: "mvu-critic" },
        { key: "plugin:ejs", kind: "plugin", content: JSON.stringify({ plugin_id: "official.ejs", document: { schema_version: 1 } }), expected: "ejs-critic" },
        { key: "plugin:html", kind: "plugin", content: JSON.stringify({ plugin_id: "official.html", document: { schema_version: 1 } }), expected: "html-critic" },
      ];
      for (const item of cases) {
        const repository = new MemoryProjectRepository(`demo-critic-${item.key}`);
        const runtime = new WorkspaceRuntime(repository);
        const now = new Date().toISOString();
        const hash = contentHash(item.content);
        await repository.commit(0, (state) => ({
          ...state,
          artifacts: [{
            id: `artifact-${item.key}`,
            key: item.key,
            kind: item.kind,
            name: item.key,
            content: item.content,
            media_type: "application/json",
            content_hash: hash,
            revision: hash,
            status: "draft",
            created_at: now,
            updated_at: now,
            created_by: "director",
            operation_id: `op-${item.key}`,
          }],
        }));

        const reviewed = await runtime.request("Review current artifact", { actor: "server", attachments: [] });
        expect(reviewed.status).toBe("completed");
        const after = await repository.read();
        expect(after.reviews.at(-1)?.reviewer).toBe(item.expected);
      }
    });

    it("rejects an explicit critic that cannot review the target kind (finding 5)", async () => {
      const repository = new MemoryProjectRepository("demo-explicit-wrong-critic");
      const runtime = new WorkspaceRuntime(repository);
      const now = new Date().toISOString();
      const content = JSON.stringify({ document: { schema_version: 1, id: "target", display_name: "Target", summary: "Character to review." } });
      const hash = contentHash(content);
      await repository.commit(0, (state) => ({
        ...state,
        artifacts: [{
          id: "artifact-target",
          key: "character:target",
          kind: "character",
          name: "Target",
          content,
          media_type: "application/json",
          content_hash: hash,
          revision: hash,
          status: "draft",
          created_at: now,
          updated_at: now,
          created_by: "director",
          operation_id: "op-target-create",
        }],
      }));

      await expect(runtime.request("Review current character", { actor: "server", attachments: [] }, { agent: "world-lore-critic" }))
        .rejects.toMatchObject({ code: "AGENT_CAPABILITY_DENIED" });
    });

    it("asks for a specific target when a generic review is ambiguous (finding 5)", async () => {
      const repository = new MemoryProjectRepository("demo-ambiguous-multi-target");
      const runtime = new WorkspaceRuntime(repository);
      const now = new Date().toISOString();
      const character = JSON.stringify({ document: { schema_version: 1, id: "char", display_name: "Char", summary: "Character." } });
      const greeting = JSON.stringify({ document: { schema_version: 1, greetings: [{ id: "g1", kind: "primary", content: "Hello!", character_ids: ["char"] }] } });
      const hashC = contentHash(character);
      const hashG = contentHash(greeting);
      await repository.commit(0, (state) => ({
        ...state,
        artifacts: [
          { id: "artifact-char", key: "character:char", kind: "character", name: "Char", content: character, media_type: "application/json", content_hash: hashC, revision: hashC, status: "draft", created_at: now, updated_at: now, created_by: "director", operation_id: "op-char" },
          { id: "artifact-greet", key: "greeting:g1", kind: "greeting", name: "Greet", content: greeting, media_type: "application/json", content_hash: hashG, revision: hashG, status: "draft", created_at: now, updated_at: now, created_by: "director", operation_id: "op-greet" },
        ],
      }));

      const reviewed = await runtime.request("Review current artifact", { actor: "server", attachments: [] });
      expect(reviewed.status).toBe("needs_input");
      expect(reviewed.summary).toContain("審查目標不明確");
    });
  });
});
