import {
  tokenSimulationReportSchema,
  type CanonicalLoreEntry,
  type CanonicalProjectIr,
  type TokenSimulationReport,
} from "@card-workspace/schemas";

import type { Tokenizer } from "./tokenizer.js";

export interface TokenSimulationOptions {
  tokenizer: Tokenizer;
  budget?: number;
}

export function entryPromptText(entry: CanonicalLoreEntry): string {
  return entry.fragments.map((fragment) => `${fragment.title}\n${fragment.content}`).join("\n");
}

export function simulateTokens(
  project: CanonicalProjectIr,
  options: TokenSimulationOptions,
): TokenSimulationReport {
  if (options.budget !== undefined && (!Number.isInteger(options.budget) || options.budget <= 0)) {
    throw new Error("Token budget 必須是正整數");
  }
  const counted = project.entries.map((entry) => ({
    entry,
    tokens: options.tokenizer.count(entryPromptText(entry)),
    constant: entry.activation.type === "constant",
  }));
  const constants = counted.filter((item) => item.constant && item.entry.activation.type !== "disabled");
  const optional = counted
    .filter((item) => !item.constant && item.entry.activation.type !== "disabled")
    .sort(
      (left, right) =>
        right.entry.priority - left.entry.priority ||
        right.entry.insertion_order - left.entry.insertion_order ||
        (left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0),
    );
  let includedTokens = constants.reduce((total, item) => total + item.tokens, 0);
  const included = new Set(constants.map((item) => item.entry.id));
  for (const item of optional) {
    if (options.budget !== undefined && includedTokens + item.tokens > options.budget) continue;
    included.add(item.entry.id);
    includedTokens += item.tokens;
  }
  const evicted = counted
    .filter((item) => item.entry.activation.type !== "disabled" && !included.has(item.entry.id))
    .map((item) => item.entry.id);
  return tokenSimulationReportSchema.parse({
    schema_version: 1,
    tokenizer: { id: options.tokenizer.id, version: options.tokenizer.version, exact: options.tokenizer.exact },
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    constant_tokens: constants.reduce((total, item) => total + item.tokens, 0),
    worst_case_tokens: counted.reduce(
      (total, item) => total + (item.entry.activation.type === "disabled" ? 0 : item.tokens),
      0,
    ),
    included_tokens: includedTokens,
    over_budget: options.budget !== undefined && constants.reduce((total, item) => total + item.tokens, 0) > options.budget,
    entries: counted.map((item) => ({
      entry_id: item.entry.id,
      tokens: item.tokens,
      constant: item.constant,
      included: included.has(item.entry.id),
      evicted: item.entry.activation.type !== "disabled" && !included.has(item.entry.id),
    })),
    evicted_entry_ids: evicted,
  });
}
