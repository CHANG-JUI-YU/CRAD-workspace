import { canonicalProjectIrSchema, type CanonicalLoreEntry } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  createApproximateTokenizer,
  createCl100kTokenizer,
  matchActivation,
  simulateTokens,
  simulateTriggers,
} from "../src/index.js";

function entry(
  id: string,
  activation: CanonicalLoreEntry["activation"],
  content: string,
  recursion: CanonicalLoreEntry["recursion"] = {
    incoming: false,
    outgoing: false,
    max_depth: 4,
    depends_on: [],
  },
  priority = 0,
): CanonicalLoreEntry {
  return {
    id,
    category: "character_detail",
    title: id,
    fragments: [{ id: `${id}.main`, title: id, content, provenance: [], extensions: {} }],
    activation,
    placement: { type: "after_character" },
    recursion,
    insertion_order: 100,
    priority,
    provenance: [],
    extensions: {},
    decisions: [],
  };
}

const keyed = (keys: string[], overrides: Partial<Extract<CanonicalLoreEntry["activation"], { type: "keyed" }>> = {}) => ({
  type: "keyed" as const,
  keys,
  secondary_keys: [],
  secondary_logic: "any" as const,
  use_regex: false,
  case_sensitive: false,
  match_whole_words: false,
  triggers: [],
  ...overrides,
});

function project(entries: CanonicalLoreEntry[]) {
  return canonicalProjectIrSchema.parse({
    schema_version: 1,
    project_id: "sim",
    title: "模擬",
    card: { name: "模擬卡", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
    characters: [{ id: "alice", display_name: "Alice", aliases: [], summary: "S", mode: "zhuji", role: "primary", extensions: {} }],
    greetings: [{ id: "primary", kind: "primary", content: "Hi", character_ids: ["alice"], provenance: [], extensions: {} }],
    entries,
    extensions: {},
  });
}

describe("Token simulator", () => {
  it("固定 tokenizer 有穩定 golden count", () => {
    expect(createCl100kTokenizer().count("hello")).toBe(1);
  });

  it("報告 constant、worst-case 與 deterministic eviction", () => {
    const report = simulateTokens(
      project([
        entry("constant", { type: "constant" }, "12345678"),
        entry("high", keyed(["high"]), "abcdefgh", undefined, 10),
        entry("low", keyed(["low"]), "abcdefgh", undefined, 0),
      ]),
      { tokenizer: createApproximateTokenizer(), budget: 9 },
    );
    expect(report.constant_tokens).toBeGreaterThan(0);
    expect(report.worst_case_tokens).toBeGreaterThan(report.constant_tokens);
    expect(report.evicted_entry_ids).toContain("low");
    expect(report.tokenizer.exact).toBe(false);
  });

  it("未設定預算時納入所有未停用條目", () => {
    const report = simulateTokens(
      project([
        entry("constant", { type: "constant" }, "12345678"),
        entry("high", keyed(["high"]), "abcdefgh", undefined, 10),
        entry("low", keyed(["low"]), "abcdefgh", undefined, 0),
      ]),
      { tokenizer: createApproximateTokenizer() },
    );
    expect(report.budget).toBeUndefined();
    expect(report.over_budget).toBe(false);
    expect(report.evicted_entry_ids).toEqual([]);
    expect(report.entries.every((item) => item.included)).toBe(true);
    expect(report.included_tokens).toBe(report.worst_case_tokens);
  });
});

describe("Trigger simulator", () => {
  it("支援主 key、secondary all、scan depth 與 generation trigger", () => {
    const result = simulateTriggers(
      project([
        entry("plain", keyed(["garden"]), "A"),
        entry(
          "secondary",
          keyed(["Alice"], { secondary_keys: ["night", "rain"], secondary_logic: "all", scan_depth: 1 }),
          "B",
        ),
        entry("continue-only", keyed(["garden"], { triggers: ["continue"] }), "C"),
      ]),
      { messages: ["old rain", "Alice walks in the night garden"], generationType: "normal" },
    );
    expect(result.report.active_entry_ids).toContain("plain");
    expect(result.report.active_entry_ids).not.toContain("secondary");
    expect(result.report.active_entry_ids).not.toContain("continue-only");
  });

  it("無效 regex 不觸發並產生 diagnostic", () => {
    const result = simulateTriggers(
      project([entry("regex", keyed(["/[broken/u"], { use_regex: true }), "A")]),
      { messages: ["broken"] },
    );
    expect(result.report.active_entry_ids).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain("TRIGGER_REGEX_INVALID");
  });

  it("遵守 outgoing、incoming 與 delay_until_recursion", () => {
    const result = simulateTriggers(
      project([
        entry(
          "source",
          { type: "constant" },
          "secret-trigger",
          { incoming: false, outgoing: true, max_depth: 4, depends_on: [] },
        ),
        entry(
          "target",
          keyed(["secret-trigger"]),
          "target",
          { incoming: true, outgoing: false, delay_until_recursion: 1, max_depth: 4, depends_on: [] },
        ),
      ]),
      { messages: ["nothing"] },
    );
    expect(result.report.active_entry_ids).toEqual(["source", "target"]);
    expect(result.report.traces.find((trace) => trace.entry_id === "target")).toMatchObject({
      reason: "recursion",
      recursion_depth: 1,
    });
  });

  it("key matcher 支援大小寫、whole-word、slash regex 與所有 secondary logic", () => {
    expect(matchActivation("Alice alice", keyed(["Alice"], { case_sensitive: true }))).toMatchObject({ matched: true });
    expect(matchActivation("malice", keyed(["alice"], { match_whole_words: true }))).toMatchObject({ matched: false });
    expect(matchActivation("Alice", keyed(["/^Alice$/u"], { use_regex: true }))).toMatchObject({ matched: true });
    expect(matchActivation("Alice", keyed(["Alice"], { use_regex: true }))).toMatchObject({
      matched: false, invalidPatterns: ["Alice"],
    });
    expect(matchActivation("Alice rain", keyed(["Alice"], { secondary_keys: ["rain", "night"], secondary_logic: "any" }))).toMatchObject({ matched: true });
    expect(matchActivation("Alice rain", keyed(["Alice"], { secondary_keys: ["rain", "night"], secondary_logic: "all" }))).toMatchObject({ matched: false });
    expect(matchActivation("Alice", keyed(["Alice"], { secondary_keys: ["rain"], secondary_logic: "not_any" }))).toMatchObject({ matched: true });
    expect(matchActivation("Alice rain", keyed(["Alice"], { secondary_keys: ["rain", "night"], secondary_logic: "not_all" }))).toMatchObject({ matched: true });
  });
});
