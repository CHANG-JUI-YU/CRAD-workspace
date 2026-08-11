import { describe, expect, it } from "vitest";
import {
  TEMPLATE_BINDINGS,
  TEMPLATE_GUIDES,
  buildTemplateContext,
  factCurationProposalValueSchema,
  greetingsDocumentSchema,
  htmlSourceSchema,
  paletteProposalValueSchema,
  pluginProposalValueSchema,
  relationshipsDocumentSchema,
  templateJsonSchemaFor,
  templateProposalValueSchema,
  templateSchemaFor,
} from "../src/index.js";

const wardrobeMarkdown = `# Demo 的衣櫃

## 衣櫃概況

- 總件數：10

## 上衣

| 款式 | 顏色／材質 | 數量 | 使用場合 |
| --- | --- | ---: | --- |
| 白色 T 恤 | 棉質 | 4 | 日常 |

## 內衣

| 款式 | 顏色／材質 | 數量 | 使用場合 |
| --- | --- | ---: | --- |
| 無鋼圈日常內衣 | 膚色 | 3 | 日常 |

## 內褲

| 款式 | 顏色／材質 | 數量 | 使用場合 |
| --- | --- | ---: | --- |
| 棉質基本款 | 黑色 | 3 | 日常 |

## 搭配組合

1. 使用：白色 T 恤｜日常外出

## 推導與備註

- 數量依洗衣頻率推導。
`;

const paletteModule = {
  schema_version: 1 as const,
  mode: "palette" as const,
  module: "basic_information" as const,
  title: "Basic information",
  content: "A calm and observant character.",
};

const relationshipDocument = {
  schema_version: 1 as const,
  document_id: "alice-beth-network",
  team_code: "ABC123",
  character_ids: ["alice", "beth"],
  character_summaries: [
    { character_id: "alice", summary: "Careful planner." },
    { character_id: "beth", summary: "Bold improviser." },
  ],
  perspectives: [
    { source_character_id: "alice", target_character_id: "alice", summary: "Sees herself as careful." },
    { source_character_id: "alice", target_character_id: "beth", summary: "Trusts Beth's courage." },
    { source_character_id: "beth", target_character_id: "alice", summary: "Relies on Alice's plans." },
    { source_character_id: "beth", target_character_id: "beth", summary: "Sees herself as direct." },
  ],
  summary: {
    network_character: "Complementary partners.",
    inter_group_relations: "One small team.",
    stability: "Stable with occasional friction.",
  },
};

describe("structured template contracts", () => {
  it("registers every active skill with a template guide", () => {
    expect(Object.keys(TEMPLATE_BINDINGS)).toHaveLength(21);
    for (const [skill, kinds] of Object.entries(TEMPLATE_BINDINGS)) {
      expect(kinds.length).toBeGreaterThan(0);
      for (const kind of kinds) expect(TEMPLATE_GUIDES[kind]).toBeDefined();
      expect(skill).toContain("-");
    }
  });

  it("validates the fixed authoring and research families", () => {
    const values = [
      { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", summary: "A complete character." } },
      { kind: "palette", character_id: "demo", module: paletteModule },
      { kind: "wardrobe", character_id: "demo", content: wardrobeMarkdown },
      { kind: "greetings", document: { schema_version: 1, greetings: [{ id: "arrival", kind: "primary", content: "Hello.", character_ids: ["demo"] }] } },
      { kind: "relationships", document: relationshipDocument },
      { kind: "world", document_id: "harbor-world", entries: [{ schema_version: 1, id: "harbor", category: "geography", title: "Harbor", content: "A coastal city." }] },
      { kind: "conversion", character_id: "demo", source_mode: "zhuji", target_mode: "palette", modules: [paletteModule], mappings: [{ source: "appearance", target: "basic_information", summary: "Maps appearance." }] },
      { kind: "import_analysis", mappings: [{ source_field: "/name", target_contract: "character", target_field: "/display_name", summary: "Direct mapping." }] },
      { kind: "review", target: { kind: "character", name: "Demo" }, findings: [], summary: "No findings." },
      { kind: "source_research", query: "official page", candidates: [{ title: "Official", url: "https://example.test" }] },
      { kind: "fact_curation", claims: [{ subject: "demo", predicate: "has_trait", value: "calm", classification: "trait", confidence: 0.9, evidence: [{ source: "official" }] }] },
      { kind: "fact_review", decisions: [{ fact_id: "demo", claim: "demo is calm", decision: "accept", reason: "Supported." }], summary: "Accepted." },
      { kind: "director_routing", phase: "authoring", next_action: "Draft the selected template." },
    ];
    for (const value of values) expect(templateProposalValueSchema.safeParse(value).success, value.kind).toBe(true);
    expect(templateProposalValueSchema.safeParse({
      kind: "review",
      target: { kind: "character", name: "Demo" },
      findings: [{ id: "critical", severity: "critical", summary: "Critical issue.", evidence: [{ source: "test" }] }],
      summary: "Critical finding is representable.",
    }).success).toBe(true);
    expect(paletteProposalValueSchema.safeParse(values[1]).success).toBe(true);
    expect(factCurationProposalValueSchema.safeParse(values[10]).success).toBe(true);
  });

  it("enforces primary greetings and complete relationship perspectives", () => {
    expect(greetingsDocumentSchema.safeParse({ schema_version: 1, greetings: [{ id: "a", kind: "alternate", content: "Hi", character_ids: ["demo"] }] }).success).toBe(false);
    expect(greetingsDocumentSchema.safeParse({ schema_version: 1, greetings: [
      { id: "a", kind: "primary", content: "Hi", character_ids: ["demo"] },
      { id: "a", kind: "primary", content: "Again", character_ids: ["demo"] },
    ] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...relationshipDocument, perspectives: relationshipDocument.perspectives.slice(0, 3) }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...relationshipDocument, character_ids: ["alice", "alice"], character_summaries: [] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...relationshipDocument, character_summaries: [{ character_id: "unknown", summary: "No participant." }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...relationshipDocument, perspectives: [...relationshipDocument.perspectives, { source_character_id: "alice", target_character_id: "beth", summary: "Duplicate." }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...relationshipDocument, groups: [{ id: "g", name: "Group", member_ids: ["alice", "alice"], formation_cause: "Cause", operating_pattern: "Pattern", exclusivity: "Open", joining_conditions: "Invite" }, { id: "g", name: "Group 2", member_ids: ["unknown", "beth"], formation_cause: "Cause", operating_pattern: "Pattern", exclusivity: "Open", joining_conditions: "Invite" }] }).success).toBe(false);
  });

  it("validates a complete cross-mode wardrobe Markdown proposal", async () => {
    const { parseWardrobeMarkdown, wardrobeProposalValueSchema } = await import("../src/index.js");
    const parsed = parseWardrobeMarkdown(wardrobeMarkdown);
    expect(parsed.ok).toBe(true);
    expect(parsed.document.counted_items).toBe(10);
    expect(parsed.document.categories.map((item) => item.name)).toEqual(["上衣", "內衣", "內褲"]);
    expect(wardrobeProposalValueSchema.safeParse({ kind: "wardrobe", character_id: "demo", content: wardrobeMarkdown }).success).toBe(true);
    expect(wardrobeProposalValueSchema.safeParse({ kind: "wardrobe", character_id: "demo", content: wardrobeMarkdown.replace("總件數：10", "總件數：11") }).success).toBe(false);
    expect(wardrobeProposalValueSchema.safeParse({ kind: "wardrobe", character_id: "demo", content: wardrobeMarkdown.replace("白色 T 恤", "不存在款式") }).success).toBe(false);
  });

  it("rejects duplicate character relationships and review findings", async () => {
    const { characterDocumentTemplateSchema, reviewReportSchema } = await import("../src/index.js");
    expect(characterDocumentTemplateSchema.safeParse({ schema_version: 1, id: "demo", display_name: "Demo", summary: "Summary", relationships: [
      { target_id: "alice", summary: "One" },
      { target_id: "alice", summary: "Two" },
    ] }).success).toBe(false);
    expect(reviewReportSchema.safeParse({ schema_version: 1, id: "review", reviewer: "critic", target_id: "demo", target_revision: "hash", findings: [
      { id: "f", severity: "warning", summary: "One", evidence: [{ source: "context" }] },
      { id: "f", severity: "warning", summary: "Two", evidence: [{ source: "context" }] },
    ], summary: "Duplicate finding." }).success).toBe(false);
  });

  it("validates typed plugin safety rules and exposes JSON schemas", () => {
    const html = { plugin_id: "official.html" as const, features: ["status_bar" as const], components: [{ id: "status", feature: "status_bar" as const, tag: "div" as const, label: "Status" }] };
    expect(htmlSourceSchema.safeParse(html).success).toBe(true);
    expect(pluginProposalValueSchema.safeParse({ kind: "plugin", plugin_id: "official.html", source: html }).success).toBe(true);
    expect(pluginProposalValueSchema.safeParse({ kind: "plugin", plugin_id: "official.html", source: { ...html, components: [{ ...html.components[0], feature: "greeting_selector" }] } }).success).toBe(false);
    expect(pluginProposalValueSchema.safeParse({ kind: "plugin", plugin_id: "official.mvu-zod", source: { plugin_id: "official.mvu-zod", variables: [{ id: "count", label: "Count", kind: "integer", default: 1 }] }, capabilities: ["ejs"] }).success).toBe(false);
    expect(pluginProposalValueSchema.safeParse({ kind: "plugin", plugin_id: "official.ejs", source: { plugin_id: "official.ejs", entries: [{ id: "entry", when: { path: "/enabled", operator: "truthy" }, content: "<% unsafe %>" }] } }).success).toBe(false);
    expect(pluginProposalValueSchema.safeParse({ kind: "plugin", plugin_id: "official.ejs", source: { plugin_id: "official.ejs" } }).success).toBe(false);
    expect(pluginProposalValueSchema.safeParse({ kind: "plugin", plugin_id: "official.html", source: { plugin_id: "official.html", features: ["status_bar"], components: [{ id: "same", feature: "status_bar", tag: "input", label: "Input", text: [{ kind: "text", value: "not allowed" }] }, { id: "same", feature: "status_bar", tag: "div", label: "Duplicate" }] } }).success).toBe(false);
    expect(paletteProposalValueSchema.safeParse({ kind: "palette", character_id: "", module: paletteModule }).success).toBe(false);
    expect(templateProposalValueSchema.safeParse({ kind: "conversion", character_id: "demo", source_mode: "zhuji", target_mode: "zhuji", modules: [paletteModule], mappings: [{ source: "a", target: "b", summary: "same" }] }).success).toBe(false);
    expect(templateProposalValueSchema.safeParse({ kind: "conversion", character_id: "demo", source_mode: "palette", target_mode: "zhuji", modules: [paletteModule], mappings: [{ source: "a", target: "b", summary: "wrong mode" }] }).success).toBe(false);
    for (const kind of Object.keys(TEMPLATE_GUIDES) as Array<keyof typeof TEMPLATE_GUIDES>) {
      expect(templateSchemaFor(kind)).toBeDefined();
      expect(templateJsonSchemaFor(kind)).toHaveProperty("$schema");
    }
    expect(JSON.stringify(templateJsonSchemaFor("plugin"))).not.toMatch(/revision|file_path|bytes_base64/iu);
  });

  it("includes examples and fixed schema in context", () => {
    const context = buildTemplateContext("palette", [{ kind: "palette", name: "demo/basic_information", value: { kind: "palette" } }]);
    expect(context.contract_version).toBe(1);
    expect(context.guide.skill).toBe("palette-creation");
    expect(context.existing).toHaveLength(1);
    expect(JSON.stringify(context.schema)).toContain("personality_palette");
  });
});
