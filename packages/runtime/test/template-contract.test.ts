import { describe, expect, it } from "vitest";
import { TEMPLATE_BINDINGS, TEMPLATE_GUIDES, type TemplateKind } from "@st-workspace/core";
import { AgentRegistry } from "../src/index.js";

const GUIDE_SKILLS: Readonly<Record<TemplateKind, readonly string[]>> = {
  character: ["director-orchestration"],
  zhuji: ["zhuji-creation"],
  palette: ["palette-creation"],
  wardrobe: ["wardrobe-creation"],
  greetings: ["greetings-creation"],
  relationships: ["relationship-creation"],
  world: ["world-lore-creation"],
  conversion: ["mode-conversion"],
  import_analysis: ["card-import-analysis"],
  review: ["character-critique", "greetings-critique", "world-lore-critique", "mvu-critique", "ejs-critique", "html-critique"],
  source_research: ["source-research"],
  fact_curation: ["fact-curation"],
  fact_review: ["fact-review"],
  plugin: ["mvu-creation", "ejs-creation", "html-creation"],
  director_routing: ["director-orchestration"],
};

const SKILL_CAPABILITY: Readonly<Record<string, string | undefined>> = {
  "character-critique": "character",
  "greetings-critique": "greetings",
  "world-lore-critique": "world",
  "mvu-critique": "plugin official.mvu-zod",
  "ejs-critique": "plugin official.ejs",
  "html-critique": "plugin official.html",
  "mvu-creation": "official.mvu-zod",
  "ejs-creation": "official.ejs",
  "html-creation": "official.html",
};

describe("template guide ownership contract", () => {
  it("resolves every TemplateKind guide to a bound trusted agent with proposal authority", () => {
    const registry = new AgentRegistry();
    const kinds = Object.keys(TEMPLATE_GUIDES) as TemplateKind[];

    for (const kind of kinds) {
      const guide = TEMPLATE_GUIDES[kind];
      const skills = GUIDE_SKILLS[kind];
      expect(skills.length).toBeGreaterThan(0);

      if (guide.skill === "*-critique") {
        expect(skills.every((skill) => skill.endsWith("-critique"))).toBe(true);
      } else if (guide.skill === "mvu/ejs/html-creation") {
        expect(skills).toEqual(["mvu-creation", "ejs-creation", "html-creation"]);
      } else {
        expect(skills).toEqual([guide.skill]);
      }

      for (const skill of skills) {
        expect(TEMPLATE_BINDINGS[skill], `${kind} guide skill ${skill} must have a template binding`).toContain(kind);
        const owners = registry.list().filter((agent) =>
          agent.skills.includes(skill) && registry.canSubmitProposal(agent.id, kind, SKILL_CAPABILITY[skill]),
        );
        expect(owners.length, `${kind} guide skill ${skill} must resolve to a trusted proposal owner`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps final Character document ownership on Director aggregation", () => {
    const registry = new AgentRegistry();
    expect(TEMPLATE_GUIDES.character.skill).toBe("director-orchestration");
    expect(TEMPLATE_BINDINGS["director-orchestration"]).toContain("character");
    expect(registry.canSubmitProposal("director", "character")).toBe(true);

    for (const specialistId of ["zhuji-creator", "palette-creator", "wardrobe-creator"]) {
      const specialist = registry.get(specialistId);
      expect(specialist?.intents).not.toContain("character-authoring");
      expect(registry.canSubmitProposal(specialistId, "character")).toBe(false);
    }
  });
});
