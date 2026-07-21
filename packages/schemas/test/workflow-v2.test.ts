import { describe, expect, it } from "vitest";

import {
  migrateWorkflowV1ToV2,
  parseWorkflowState,
  workflowEntryKindSchema,
  workflowTaskSchema,
  workflowStageSchema,
  workflowStateSchema,
  workflowStateV1Schema,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

function validWorkflow() {
  return {
    schema_version: 2 as const,
    project_id: "demo",
    workflow_definition_id: "original-v1",
    entry_kind: "original" as const,
    stage: "intake" as const,
    revision: 0,
    artifacts: [],
    gates: [],
    tasks: [],
    decisions: [],
    extensions: {},
  };
}

describe("Workflow v2", () => {
  it("固定四種入口與二十一階段 vocabulary", () => {
    expect(workflowEntryKindSchema.options).toEqual([
      "original",
      "source_adaptation",
      "card_import",
      "mode_conversion",
    ]);
    expect(workflowStageSchema.options).toHaveLength(21);
    expect(workflowStageSchema.options).toContain("pre_world_review");
    expect(workflowStageSchema.options).toContain("post_world_review");
    expect(workflowStageSchema.options).toContain("greetings_authoring");
    expect(workflowStageSchema.options).toContain("plugin_mvu_authoring");
    expect(workflowStageSchema.options).toContain("plugin_html_review");
    expect(workflowStateSchema.safeParse({ ...validWorkflow(), stage: "unknown" }).success).toBe(false);
  });

  it("接受完整 gate、task、lease、artifact、decision 與 journal revision", () => {
    const parsed = workflowStateSchema.parse({
      ...validWorkflow(),
      revision: 4,
      artifacts: [{ id: "blueprint", status: "approved", revision: hash, updated_at: "2026-07-14T10:00:00Z", contract: "blueprint@1" }],
      gates: [{ id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision: hash }] }],
      tasks: [{
        id: "task-1",
        kind: "draft-zhuji",
        status: "claimed",
        assigned_agent: "zhuji-creator",
        capabilities: ["character.propose"],
        input_artifacts: [{ id: "blueprint", revision: hash, contract: "blueprint@1" }],
        output_contract: "proposal@1",
        dependencies: [],
        lease: { id: "lease-1", owner: "zhuji-creator", claimed_at: "2026-07-14T10:00:00Z", expires_at: "2026-07-14T10:05:00Z" },
        attempt: 1,
        max_attempts: 2,
      }],
      decisions: [{ id: "decision-1", kind: "gate-approval", actor: "user", decided_at: "2026-07-14T10:00:00Z", summary: "批准藍圖" }],
      journal_revision: hash,
    });
    expect(parsed.gates[0]?.status).toBe("approved");
    expect(parsed.tasks[0]?.lease?.id).toBe("lease-1");
  });

  it("strict、revision 非負且各 collection ID 唯一", () => {
    expect(workflowStateSchema.safeParse({ ...validWorkflow(), revision: -1 }).success).toBe(false);
    expect(workflowStateSchema.safeParse({ ...validWorkflow(), surprise: true }).success).toBe(false);
    const gate = { id: "facts" as const, status: "pending" as const };
    expect(workflowStateSchema.safeParse({ ...validWorkflow(), gates: [gate, gate] }).success).toBe(false);
  });

  it("保存 typed Blueprint 預檢並拒絕高不確定高影響的自行補完", () => {
    const baseTask = {
      id: "create-blueprint", kind: "create-blueprint", status: "claimed", assigned_agent: "director",
      capabilities: ["blueprint.propose"], input_artifacts: [], output_contract: "proposal@1",
      dependencies: [], attempt: 1, max_attempts: 3,
      blueprint_precheck: {
        schema_version: 1,
        candidate_blueprint_revision: hash,
        recorded_at: "2026-07-14T10:00:00Z",
        checks: [{
          subject_id: "alice", dimension: "character_core", uncertainty: "high", impact: "high",
          basis: "使用者已明確選定", action: "user_confirmed", user_answer: "採用守序將軍核心",
        }],
      },
    };
    expect(workflowTaskSchema.safeParse(baseTask).success).toBe(true);
    expect(workflowTaskSchema.safeParse({
      ...baseTask,
      blueprint_precheck: {
        ...baseTask.blueprint_precheck,
        checks: [{ ...baseTask.blueprint_precheck.checks[0], action: "safe_extension", user_answer: undefined }],
      },
    }).success).toBe(false);
  });

  it("models a typed closed workflow outcome without adding a global stage", () => {
    const parsed = workflowStateSchema.parse({
      ...validWorkflow(),
      stage: "blueprint",
      outcome: {
        status: "closed",
        kind: "report_retained",
        closed_at: "2026-07-16T00:00:00Z",
        decision_id: "retain-choice",
      },
    });
    expect(parsed).toMatchObject({ stage: "blueprint", outcome: { status: "closed", kind: "report_retained" } });
    expect(workflowStateSchema.safeParse({ ...validWorkflow(), outcome: { status: "open" } }).success).toBe(false);
  });
});

describe("Workflow v1 migration", () => {
  const legacy = {
    schema_version: 1 as const,
    project_id: "demo",
    stage: "review" as const,
    revision: 3,
    artifacts: {
      blueprint: { status: "approved" as const, revision: hash, updated_at: "2026-07-14T10:00:00Z" },
    },
    gates: {
      blueprint: { status: "approved" as const, decided_at: "2026-07-14T10:00:00Z", note: "ok" },
      custom: { status: "pending" as const },
    },
    metadata: { source: "legacy" },
  };

  it("保留 v1 reader，但一般 parse 只接受 v2", () => {
    expect(workflowStateV1Schema.parse(legacy).schema_version).toBe(1);
    expect(() => parseWorkflowState(legacy)).toThrow();
  });

  it("相同 v1 bytes 產生相同 state 與 report，且警告不可無損欄位", () => {
    const bytes = JSON.stringify(legacy);
    const first = migrateWorkflowV1ToV2(JSON.parse(bytes));
    const second = migrateWorkflowV1ToV2(JSON.parse(bytes));
    expect(first).toEqual(second);
    expect(first.state.stage).toBe("semantic_review");
    expect(first.state.extensions).toEqual({ legacy_metadata: { source: "legacy" } });
    expect(first.report.warnings.map((warning) => warning.code)).toEqual([
      "legacy_entry_kind_defaulted",
      "legacy_definition_defaulted",
      "legacy_gate_details",
      "legacy_gate_unmapped",
      "legacy_metadata_preserved",
    ]);
  });
});
