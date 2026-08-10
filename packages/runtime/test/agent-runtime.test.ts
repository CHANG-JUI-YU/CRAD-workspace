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
    const result = await adapter.request({ request: "Create character: Adapter. Personality: calm.", context: { actor: "writer", attachments: [] } });
    expect(result.status).toBe("completed");
    expect((await repository.read()).audit.find((event) => event.event === "operation.created")?.details).toMatchObject({ agent_id: "director" });
    expect(adapter.list().find((agent) => agent.id === "director")).toMatchObject({ role: "orchestrator", prompt: ".agents/agents/director.md" });
  });
});
