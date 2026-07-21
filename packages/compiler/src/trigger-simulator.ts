import {
  triggerSimulationReportSchema,
  type CanonicalLoreEntry,
  type CanonicalProjectIr,
  type Diagnostic,
  type TriggerSimulationReport,
} from "@card-workspace/schemas";

import { entryPromptText } from "./token-simulator.js";
import { matchActivation } from "./key-matcher.js";

type GenerationType = TriggerSimulationReport["generation_type"];

export interface TriggerSimulationOptions {
  messages: string[];
  profile?: string;
  generationType?: GenerationType;
  defaultScanDepth?: number;
  budgetIncludedEntryIds?: string[];
}

export interface TriggerSimulationResult {
  report: TriggerSimulationReport;
  diagnostics: Diagnostic[];
}

function scanText(entry: CanonicalLoreEntry, messages: string[], defaultDepth: number): string {
  const depth = entry.activation.type === "keyed" ? (entry.activation.scan_depth ?? defaultDepth) : defaultDepth;
  return messages.slice(-depth).join("\n");
}

export function simulateTriggers(
  project: CanonicalProjectIr,
  options: TriggerSimulationOptions,
): TriggerSimulationResult {
  const generationType = options.generationType ?? "normal";
  const defaultDepth = options.defaultScanDepth ?? 2;
  const budgetIncluded = options.budgetIncludedEntryIds ? new Set(options.budgetIncludedEntryIds) : undefined;
  const diagnostics: Diagnostic[] = [];
  const active = new Set<string>();
  const traces = new Map<string, TriggerSimulationReport["traces"][number]>();
  for (const entry of project.entries) {
    if (budgetIncluded && !budgetIncluded.has(entry.id)) {
      traces.set(entry.id, { entry_id: entry.id, active: false, reason: "budget_evicted", matched_keys: [] });
      continue;
    }
    if (entry.activation.type === "disabled") {
      traces.set(entry.id, { entry_id: entry.id, active: false, reason: "disabled", matched_keys: [] });
      continue;
    }
    if (entry.recursion.delay_until_recursion !== undefined) {
      traces.set(entry.id, { entry_id: entry.id, active: false, reason: "not_matched", matched_keys: [] });
      continue;
    }
    if (entry.activation.type === "constant") {
      active.add(entry.id);
      traces.set(entry.id, { entry_id: entry.id, active: true, reason: "constant", matched_keys: [] });
      continue;
    }
    if (entry.activation.type === "conditional") {
      traces.set(entry.id, { entry_id: entry.id, active: false, reason: "condition_unsupported", matched_keys: [] });
      continue;
    }
    if (entry.activation.triggers.length > 0 && !entry.activation.triggers.includes(generationType)) {
      traces.set(entry.id, { entry_id: entry.id, active: false, reason: "not_matched", matched_keys: [] });
      continue;
    }
    const match = matchActivation(scanText(entry, options.messages, defaultDepth), entry.activation);
    for (const pattern of match.invalidPatterns) {
      diagnostics.push({
        code: "TRIGGER_REGEX_INVALID",
        severity: "warning",
        message: `無效或非 slash-delimited regex：${pattern}`,
        location: { file: ".build/ir.json", path: ["entries", entry.id, "activation", "keys"] },
        evidence: [{ source: "activation.keys", excerpt: pattern }],
        fixability: "manual",
      });
    }
    if (match.matched) active.add(entry.id);
    traces.set(entry.id, {
      entry_id: entry.id,
      active: match.matched,
      reason: match.matched ? "key" : "not_matched",
      matched_keys: match.matchedKeys,
    });
  }

  const groups = new Map<string, CanonicalLoreEntry[]>();
  for (const entry of project.entries) {
    if (!active.has(entry.id) || entry.activation.type !== "keyed" || !entry.activation.group) continue;
    groups.set(entry.activation.group, [...(groups.get(entry.activation.group) ?? []), entry]);
  }
  for (const entries of groups.values()) {
    const winner = [...entries].sort(
      (left, right) => right.priority - left.priority
        || right.insertion_order - left.insertion_order
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )[0];
    for (const entry of entries) {
      if (entry.id === winner?.id) continue;
      active.delete(entry.id);
      traces.set(entry.id, { entry_id: entry.id, active: false, reason: "group_evicted", matched_keys: [] });
    }
  }

  const maxDepth = Math.max(0, ...project.entries.map((entry) => entry.recursion.max_depth));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const recursionText = project.entries
      .filter((entry) => active.has(entry.id) && entry.recursion.outgoing)
      .map(entryPromptText)
      .join("\n");
    if (!recursionText) break;
    let changed = false;
    for (const entry of project.entries) {
      if (active.has(entry.id) || !entry.recursion.incoming || entry.activation.type !== "keyed") continue;
      if ((entry.recursion.delay_until_recursion ?? 1) > depth) continue;
      const match = matchActivation(recursionText, entry.activation);
      if (!match.matched) continue;
      active.add(entry.id);
      changed = true;
      traces.set(entry.id, {
        entry_id: entry.id,
        active: true,
        reason: "recursion",
        matched_keys: match.matchedKeys,
        recursion_depth: depth,
      });
    }
    if (!changed) break;
  }

  return {
    report: triggerSimulationReportSchema.parse({
      schema_version: 1,
      profile: options.profile ?? "generic-ccv3",
      generation_type: generationType,
      active_entry_ids: project.entries.filter((entry) => active.has(entry.id)).map((entry) => entry.id),
      traces: project.entries.map((entry) =>
        traces.get(entry.id) ?? { entry_id: entry.id, active: false, reason: "not_matched", matched_keys: [] },
      ),
    }),
    diagnostics,
  };
}
