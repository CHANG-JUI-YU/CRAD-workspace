import type { OperationRecord } from "@st-workspace/core";

export type AgentRole = "orchestrator" | "researcher" | "curator" | "reviewer" | "creator" | "critic" | "converter" | "importer";

export interface AgentDefinition {
  readonly id: string;
  readonly role: AgentRole;
  readonly prompt: string;
  readonly personality: string;
  readonly skills: readonly string[];
  readonly intents: readonly string[];
  readonly shared_executor?: string;
  readonly read_only?: boolean;
}

function definition(
  id: string,
  role: AgentRole,
  prompt: string,
  personality: string,
  skill: string,
  intents: readonly string[],
  options: Pick<AgentDefinition, "shared_executor" | "read_only"> = {},
): AgentDefinition {
  return { id, role, prompt, personality, skills: [skill], intents, ...options };
}

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  definition("director", "orchestrator", ".agents/agents/director.md", "director", "director-orchestration", ["route", "interview", "continue", "status"]),
  definition("source-researcher", "researcher", ".agents/agents/source-researcher.md", "source-researcher", "source-research", ["source-research", "source-verify"]),
  definition("fact-curator", "curator", ".agents/agents/fact-curator.md", "fact-curator", "fact-curation", ["fact-curation", "evidence-summary"]),
  definition("fact-reviewer-1", "reviewer", ".agents/agents/fact-reviewer.md", "fact-reviewer", "fact-review", ["fact-review"], { shared_executor: "fact-reviewer", read_only: true }),
  definition("fact-reviewer-2", "reviewer", ".agents/agents/fact-reviewer.md", "fact-reviewer", "fact-review", ["fact-review"], { shared_executor: "fact-reviewer", read_only: true }),
  definition("fact-reviewer-3", "reviewer", ".agents/agents/fact-reviewer.md", "fact-reviewer", "fact-review", ["fact-review"], { shared_executor: "fact-reviewer", read_only: true }),
  definition("zhuji-creator", "creator", ".agents/agents/zhuji-creator.md", "zhuji-creator", "zhuji-creation", ["zhuji"]),
  definition("palette-creator", "creator", ".agents/agents/palette-creator.md", "palette-creator", "palette-creation", ["palette"]),
  definition("wardrobe-creator", "creator", ".agents/agents/wardrobe-creator.md", "wardrobe-creator", "wardrobe-creation", ["wardrobe"]),
  definition("character-critic", "critic", ".agents/agents/character-critic.md", "character-critic", "character-critique", ["character-review"], { read_only: true }),
  definition("relationship-creator", "creator", ".agents/agents/relationship-creator.md", "relationship-creator", "relationship-creation", ["relationship-authoring"]),
  definition("greetings-creator", "creator", ".agents/agents/greetings-creator.md", "greetings-creator", "greetings-creation", ["greeting-authoring"]),
  definition("greetings-critic", "critic", ".agents/agents/greetings-critic.md", "greetings-critic", "greetings-critique", ["greeting-review"], { read_only: true }),
  definition("mode-conversion", "converter", ".agents/agents/mode-conversion.md", "mode-conversion", "mode-conversion", ["mode-conversion"]),
  definition("card-import-analyst", "importer", ".agents/agents/card-import-analyst.md", "card-import-analyst", "card-import-analysis", ["card-import", "legacy-analysis"]),
  definition("world-lore-creator", "creator", ".agents/agents/world-lore-creator.md", "world-lore-creator", "world-lore-creation", ["world-authoring"]),
  definition("world-lore-critic", "critic", ".agents/agents/world-lore-critic.md", "world-lore-critic", "world-lore-critique", ["world-review"], { read_only: true }),
  definition("mvu-creator", "creator", ".agents/agents/mvu-creator.md", "mvu-creator", "mvu-creation", ["plugin-authoring", "mvu"]),
  definition("mvu-critic", "critic", ".agents/agents/mvu-creator-critic.md", "mvu-creator-critic", "mvu-critique", ["plugin-review", "mvu"], { read_only: true }),
  definition("ejs-creator", "creator", ".agents/agents/ejs-creator.md", "ejs-creator", "ejs-creation", ["plugin-authoring", "ejs"]),
  definition("ejs-critic", "critic", ".agents/agents/ejs-creator-critic.md", "ejs-creator-critic", "ejs-critique", ["plugin-review", "ejs"], { read_only: true }),
  definition("html-creator", "creator", ".agents/agents/html-creator.md", "html-creator", "html-creation", ["plugin-authoring", "html"]),
  definition("html-critic", "critic", ".agents/agents/html-creator-critic.md", "html-creator-critic", "html-critique", ["plugin-review", "html"], { read_only: true }),
];

export const AGENT_ALIASES: Readonly<Record<string, string>> = {
  director: "director",
  "source-research": "source-researcher",
  "source-researcher": "source-researcher",
  "fact-curator": "fact-curator",
  "fact-reviewer": "fact-reviewer-1",
  "fact-reviewer-1": "fact-reviewer-1",
  "fact-reviewer-2": "fact-reviewer-2",
  "fact-reviewer-3": "fact-reviewer-3",
  zhuji: "zhuji-creator",
  "zhuji-creator": "zhuji-creator",
  palette: "palette-creator",
  "palette-creator": "palette-creator",
  wardrobe: "wardrobe-creator",
  "wardrobe-creator": "wardrobe-creator",
  "character-critic": "character-critic",
  relationship: "relationship-creator",
  "relationship-creator": "relationship-creator",
  greetings: "greetings-creator",
  "greetings-creator": "greetings-creator",
  "greetings-critic": "greetings-critic",
  "mode-conversion": "mode-conversion",
  "card-import": "card-import-analyst",
  "card-import-analyst": "card-import-analyst",
  "world-lore": "world-lore-creator",
  "world-lore-creator": "world-lore-creator",
  "world-lore-critic": "world-lore-critic",
  mvu: "mvu-creator",
  "mvu-creator": "mvu-creator",
  "mvu-creator-critic": "mvu-critic",
  "mvu-critic": "mvu-critic",
  ejs: "ejs-creator",
  "ejs-creator": "ejs-creator",
  "ejs-creator-critic": "ejs-critic",
  "ejs-critic": "ejs-critic",
  html: "html-creator",
  "html-creator": "html-creator",
  "html-creator-critic": "html-critic",
  "html-critic": "html-critic",
};

export class AgentRegistry {
  private readonly definitions: ReadonlyMap<string, AgentDefinition>;
  private readonly aliases: ReadonlyMap<string, string>;

  constructor(
    definitions: readonly AgentDefinition[] = AGENT_DEFINITIONS,
    aliases: Readonly<Record<string, string>> = AGENT_ALIASES,
  ) {
    const definitionMap = new Map<string, AgentDefinition>();
    for (const item of definitions) {
      if (definitionMap.has(item.id)) throw new Error("Duplicate agent definition: " + item.id);
      definitionMap.set(item.id, item);
    }
    for (const item of definitions) {
      if (item.skills.length === 0 || item.intents.length === 0) throw new Error("Agent " + item.id + " must declare a skill and intent");
    }
    const aliasMap = new Map<string, string>();
    for (const [alias, target] of Object.entries(aliases)) {
      if (!definitionMap.has(target)) throw new Error("Alias " + alias + " targets unknown agent " + target);
      aliasMap.set(alias.trim().toLocaleLowerCase(), target);
    }
    this.definitions = definitionMap;
    this.aliases = aliasMap;
  }

  get(id: string): AgentDefinition | undefined {
    return this.definitions.get(id);
  }

  resolve(value: string | undefined): AgentDefinition | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLocaleLowerCase();
    const target = this.aliases.get(normalized) ?? normalized;
    return this.definitions.get(target);
  }

  list(): readonly AgentDefinition[] {
    return [...this.definitions.values()];
  }

  aliasEntries(): ReadonlyMap<string, string> {
    return this.aliases;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  /**
   * Return whether an execution agent is allowed to submit a typed proposal.
   * The registry is the trusted capability boundary for model-facing template
   * endpoints; natural-language routing remains intentionally more permissive.
   */
  canSubmitProposal(agentId: string, kind: string, capability?: string): boolean {
    const agent = this.definitions.get(agentId);
    if (agent === undefined) return false;
    if (kind === "plugin") {
      const expected = capability === "official.mvu-zod" ? "mvu-creator" : capability === "official.ejs" ? "ejs-creator" : capability === "official.html" ? "html-creator" : undefined;
      return expected !== undefined && agent.id === expected;
    }
    if (kind === "review") {
      const target = capability?.toLocaleLowerCase() ?? "";
      const expected = /world|lore/iu.test(target) ? "world-lore-critic"
        : /greeting/iu.test(target) ? "greetings-critic"
          : /mvu/iu.test(target) ? "mvu-critic"
            : /ejs/iu.test(target) ? "ejs-critic"
              : /html/iu.test(target) ? "html-critic"
                : "character-critic";
      return agent.id === expected;
    }
    if (kind === "fact_review") return /^fact-reviewer-[123]$/u.test(agent.id) || agent.id === "director";
    const expected: Readonly<Record<string, string>> = {
      character: "director",
      zhuji: "zhuji-creator",
      palette: "palette-creator",
      wardrobe: "wardrobe-creator",
      greetings: "greetings-creator",
      relationships: "relationship-creator",
      world: "world-lore-creator",
      conversion: "mode-conversion",
      import_analysis: "card-import-analyst",
      source_research: "source-researcher",
      fact_curation: "fact-curator",
      director_routing: "director",
    };
    return expected[kind] === agent.id;
  }

  /** Issue mutations are Director/orchestrator decisions, not creator actions. */
  canUpdateIssue(agentId: string): boolean {
    return this.definitions.get(agentId)?.role === "orchestrator";
  }
}

export type RoutedKind = OperationRecord["kind"];
