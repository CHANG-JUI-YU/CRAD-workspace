import { describe, expect, it } from "vitest";
import {
  coverageResearchStartScopeSchema,
  coverageResearchStartCommandPayloadSchema,
  coverageResearchRecoverCommandPayloadSchema,
} from "../src/index.js";

describe("Audit 6 Batch 3 - Core Schemas", () => {
  it("#50: validates coverageResearchStartScopeSchema for assessment scope", () => {
    const parsed = coverageResearchStartScopeSchema.safeParse({ kind: "assessment" });
    expect(parsed.success).toBe(true);
  });

  it("#50: validates coverageResearchStartScopeSchema for requirement targets scope", () => {
    const parsed = coverageResearchStartScopeSchema.safeParse({
      kind: "requirements",
      targets: [
        { requirement_id: "req.appearance", character_id: "char-1" },
        { requirement_id: "req.world_context" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("#50: rejects coverageResearchStartScopeSchema with invalid kind or empty targets", () => {
    expect(coverageResearchStartScopeSchema.safeParse({ kind: "unknown" }).success).toBe(false);
    expect(coverageResearchStartScopeSchema.safeParse({ kind: "requirements", targets: [] }).success).toBe(false);
  });

  it("#50: validates coverageResearchStartCommandPayloadSchema with optional scope", () => {
    const withScope = coverageResearchStartCommandPayloadSchema.safeParse({
      assessment_id: "assess-1",
      assessment_revision: "rev-1",
      scope: { kind: "assessment" },
    });
    expect(withScope.success).toBe(true);

    const withoutScope = coverageResearchStartCommandPayloadSchema.safeParse({
      assessment_id: "assess-1",
      assessment_revision: "rev-1",
    });
    expect(withoutScope.success).toBe(true);
  });

  it("#37: validates coverageResearchRecoverCommandPayloadSchema for all 5 recovery actions", () => {
    const reviseQuery = coverageResearchRecoverCommandPayloadSchema.safeParse({
      task_id: "task-1",
      action: "revise_query",
      query_seeds: ["new query"],
    });
    expect(reviseQuery.success).toBe(true);

    const reviseConstraints = coverageResearchRecoverCommandPayloadSchema.safeParse({
      task_id: "task-1",
      action: "revise_constraints",
      source_constraints: ["site:wiki.org"],
    });
    expect(reviseConstraints.success).toBe(true);

    const manualUrl = coverageResearchRecoverCommandPayloadSchema.safeParse({
      task_id: "task-1",
      action: "manual_url",
      url: "https://example.com/source",
    });
    expect(manualUrl.success).toBe(true);

    const supplement = coverageResearchRecoverCommandPayloadSchema.safeParse({
      task_id: "task-1",
      action: "supplement",
      text: "Supplemental text",
    });
    expect(supplement.success).toBe(true);

    const creative = coverageResearchRecoverCommandPayloadSchema.safeParse({
      task_id: "task-1",
      action: "creative_completion",
      choice: "Create personality",
      rationale: "No external source found",
    });
    expect(creative.success).toBe(true);
  });
});
