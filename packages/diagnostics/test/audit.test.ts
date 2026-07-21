import { emitCharacterCardV3 } from "@card-workspace/adapters-ccv3";
import { canonicalProjectIrSchema, policyProfileSchema } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { auditCharacterCard, renderAuditMarkdown } from "../src/index.js";

function validCard() {
  const ir = canonicalProjectIrSchema.parse({
    schema_version: 1,
    project_id: "audit",
    title: "Audit",
    card: { name: "Audit Card", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
    characters: [{ id: "alice", display_name: "Alice", aliases: [], summary: "S", mode: "zhuji", role: "primary", extensions: {} }],
    greetings: [{ id: "primary", kind: "primary", content: "Hello", character_ids: ["alice"], provenance: [], extensions: {} }],
    entries: [
      {
        id: "alice.identity",
        category: "character_identity",
        title: "Identity",
        fragments: [{ id: "alice.identity.main", title: "Identity", content: "Alice", provenance: [], extensions: {} }],
        activation: { type: "constant" },
        placement: { type: "before_character" },
        recursion: { incoming: false, outgoing: false, max_depth: 4, depends_on: [] },
        insertion_order: 1,
        priority: 0,
        provenance: [],
        extensions: {},
        decisions: [],
      },
    ],
    extensions: {},
  });
  return emitCharacterCardV3(ir);
}

describe("三層 audit", () => {
  it("有效編譯卡通過且 JSON/Markdown finding 數一致", () => {
    const report = auditCharacterCard(validCard());
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(renderAuditMarkdown(report)).toContain("Result: PASS");
  });

  it("normative 錯誤不可由 policy 關閉", () => {
    const policy = policyProfileSchema.parse({
      schema_version: 1,
      id: "test",
      rules: [{ id: "ccv3.schema", layer: "normative", severity: "off", enabled: false }],
    });
    const report = auditCharacterCard({ spec: "wrong" }, { policy });
    expect(report.blocked).toBe(true);
    expect(report.findings.every((item) => item.layer === "normative")).toBe(true);
    expect(report.findings.some((item) => item.rule_id === "ccv3.schema")).toBe(true);
  });

  it("workspace 規則可由 policy 關閉但不得改層", () => {
    const card = validCard();
    card.data.description = "不應位於主卡";
    const initial = auditCharacterCard(card);
    expect(initial.findings).toContainEqual(
      expect.objectContaining({ rule_id: "workspace.minimal.description", layer: "workspace" }),
    );
    const policy = policyProfileSchema.parse({
      schema_version: 1,
      id: "test",
      rules: [{ id: "workspace.minimal.description", layer: "workspace", severity: "off" }],
    });
    expect(auditCharacterCard(card, { policy }).findings).toEqual([]);
  });

  it("token 常駐超額會阻斷 strict audit", () => {
    const report = auditCharacterCard(validCard(), {
      tokenReport: {
        schema_version: 1,
        tokenizer: { id: "test", version: "1", exact: true },
        budget: 1,
        constant_tokens: 2,
        worst_case_tokens: 2,
        included_tokens: 2,
        over_budget: true,
        entries: [],
        evicted_entry_ids: [],
      },
    });
    expect(report.blocked).toBe(true);
    expect(report.findings.map((item) => item.rule_id)).toContain("workspace.token.constant-budget");
  });

  it("外部 workspace finding 不得冒充 normative layer", () => {
    const report = auditCharacterCard(validCard(), {
      strict: false,
      workspaceFindings: [{
        rule_id: "workspace.provenance.invalid-fact-ref",
        layer: "normative",
        severity: "error",
        message: "missing fact",
        evidence: [],
        fixability: "manual",
        overridable: false,
      }],
    });
    expect(report.findings).toContainEqual(expect.objectContaining({
      rule_id: "workspace.provenance.invalid-fact-ref",
      layer: "workspace",
      overridable: true,
    }));
  });
});
