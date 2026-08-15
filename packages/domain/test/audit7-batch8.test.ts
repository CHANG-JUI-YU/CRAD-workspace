import { describe, expect, it } from "vitest";
import type {
  AuditEventRecord,
  CoverageResearchBatchRecord,
  CoverageResearchLineageRecord,
  CoverageResearchTaskRecord,
  OperationRecord,
  ProjectState,
} from "@st-workspace/core";
import {
  deriveStructuredPublishDiagnostics,
  deriveResearchMonitor,
  type WorkflowDiagnostic,
} from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";

function makeMinimalProjectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    schema_version: 1,
    project_id: "test-proj",
    revision: "rev-1",
    sources: [],
    facts: [],
    artifacts: [],
    relations: [],
    operations: [],
    source_candidates: [],
    fact_review_runs: [],
    fact_review_decisions: [],
    coverage_assessments: [],
    coverage_requirement_sets: [],
    coverage_resolutions: [],
    coverage_authoring_bindings: [],
    coverage_research_batches: [],
    coverage_research_tasks: [],
    coverage_research_lineages: [],
    issues: [],
    audit: [],
    ...overrides,
  };
}

describe("Audit 7 Batch 8: Domain Tests", () => {
  describe("Grouped Publish Diagnostics (#89 UX7-07)", () => {
    it("groups diagnostics by remediation path and affected objects deterministically", () => {
      const diagnostics: WorkflowDiagnostic[] = [
        {
          code: "FACT_SOURCE_MISSING",
          severity: "error",
          message: "Fact 1 is missing a source.",
          fact_ids: ["fact-001"],
        },
        {
          code: "FACT_REVIEW_CONTRADICTION",
          severity: "error",
          message: "Fact 1 has contradiction.",
          fact_ids: ["fact-001"],
        },
        {
          code: "ARTIFACT_REVIEW_REQUIRED",
          severity: "warning",
          message: "Artifact alpha needs review.",
          artifact_ids: ["art-alpha"],
        },
        {
          code: "SOURCE_DOMAIN_NOT_ALLOWED",
          severity: "warning",
          message: "Source domain not allowed.",
          source_ids: ["src-001"],
        },
        {
          code: "CUSTOM_UNKNOWN_BLOCKER",
          severity: "error",
          message: "An unknown system blocker.",
        },
      ];

      const structured = deriveStructuredPublishDiagnostics(diagnostics);

      // Verify Summary
      expect(structured.summary).toBeDefined();
      expect(structured.summary.total_diagnostics).toBe(5);
      expect(structured.summary.error_count).toBe(3);
      expect(structured.summary.warning_count).toBe(2);
      expect(structured.summary.affected_object_count).toBe(3); // fact:fact-001, artifact:art-alpha, source:src-001
      expect(structured.summary.remediation_group_count).toBeGreaterThanOrEqual(3);
      expect(structured.has_unknown).toBe(true);

      // Verify Groups deterministic order: error groups first, then warning groups
      const errorGroups = structured.groups.filter((g) => g.highest_severity === "error");
      const warningGroups = structured.groups.filter((g) => g.highest_severity === "warning");
      expect(structured.groups.slice(0, errorGroups.length)).toEqual(errorGroups);

      // Verify primary_next_action is present per group
      for (const group of structured.groups) {
        expect(group.primary_next_action).toBeTruthy();
        expect(group.target_count).toBeGreaterThanOrEqual(1);
      }

      // Verify affected object consolidation: fact-001 has two diagnostics
      const factGroup = structured.groups.find((g) => g.remediation_key === "facts");
      expect(factGroup).toBeDefined();
      const factObj = factGroup?.affected_objects.find((o) => o.id === "fact-001");
      expect(factObj).toBeDefined();
      expect(factObj?.diagnostics.length).toBe(1);
      expect(factObj?.diagnostics[0]?.code).toBe("FACT_SOURCE_MISSING");

      // Verify backward compatibility
      expect(structured.rows.length).toBe(5);
    });

    it("handles multi-target coverage cell diagnostics properly", () => {
      const diagnostics: WorkflowDiagnostic[] = [
        {
          code: "COVERAGE_RESOLUTION_REQUIRED",
          severity: "error",
          message: "Coverage required for core traits.",
          coverage_refs: [
            { requirement_id: "req.core", character_id: "alpha" },
            { requirement_id: "req.background" },
          ],
        },
      ];

      const structured = deriveStructuredPublishDiagnostics(diagnostics);
      expect(structured.groups.length).toBe(1);
      const covGroup = structured.groups[0]!;
      expect(covGroup.remediation_key).toBe("coverage");
      expect(covGroup.affected_objects.length).toBe(2);

      const alphaCell = covGroup.affected_objects.find((o) => o.character_id === "alpha");
      expect(alphaCell).toBeDefined();
      expect(alphaCell?.requirement_id).toBe("req.core");
      expect(alphaCell?.object_identity).toBe("coverage_cell:alpha__req.core");

      const worldCell = covGroup.affected_objects.find((o) => o.character_id === undefined);
      expect(worldCell).toBeDefined();
      expect(worldCell?.requirement_id).toBe("req.background");
      expect(worldCell?.object_identity).toBe("coverage_cell:world__req.background");
    });
  });

  describe("Research Lineage & Audit Evidence Tracking (#87 UX7-05)", () => {
    it("distinguishes in-flight vs terminal history and infers origin_kind from audit logs", () => {
      const batches: CoverageResearchBatchRecord[] = [
        {
          id: "batch-1",
          assessment_id: "assess-1",
          assessment_revision: "rev-1",
          requirement_set_id: "reqset-1",
          requirement_set_revision: "rev-1",
          status: "in_progress",
          created_by: "system",
          created_at: now,
        },
      ];

      const tasks: CoverageResearchTaskRecord[] = [
        // Task 1: Reused from existing, completed (Terminal history)
        {
          id: "task-1",
          batch_id: "batch-1",
          character_id: "alpha",
          requirement_ids: ["req.appearance"],
          dimension_paths: ["appearance.eyes"],
          query_seeds: ["eyes"],
          status: "completed",
          claim_generation: 1,
          attempt: 1,
          searched_queries: ["eyes color"],
          source_families: ["official"],
          created_at: now,
          updated_at: now,
        },
        // Task 2: Newly created, exhausted with reason (Terminal history)
        {
          id: "task-2",
          batch_id: "batch-1",
          character_id: "alpha",
          requirement_ids: ["req.background"],
          dimension_paths: ["background.origin"],
          query_seeds: ["origin"],
          status: "exhausted",
          exhausted_reason: "rate_limited",
          claim_generation: 1,
          attempt: 3,
          searched_queries: ["origin story"],
          source_families: ["fandom"],
          created_at: now,
          updated_at: now,
        },
        // Task 3: Successor recovery from Task 2, currently running (In-flight)
        {
          id: "task-3",
          batch_id: "batch-1",
          character_id: "alpha",
          requirement_ids: ["req.background"],
          dimension_paths: ["background.origin"],
          query_seeds: ["origin alternative"],
          status: "running",
          predecessor_id: "task-2",
          claim_generation: 1,
          attempt: 1,
          searched_queries: [],
          source_families: ["fandom"],
          created_at: now,
          updated_at: now,
        },
        // Task 4: Legacy task without audit record (Terminal history)
        {
          id: "task-4",
          batch_id: "batch-1",
          requirement_ids: ["req.world_core"],
          dimension_paths: ["world.setting"],
          query_seeds: ["world"],
          status: "cancelled",
          claim_generation: 0,
          attempt: 0,
          searched_queries: [],
          source_families: [],
          created_at: now,
          updated_at: now,
        },
      ];

      const lineages: CoverageResearchLineageRecord[] = [
        {
          id: "lin-1",
          task_id: "task-1",
          candidate_id: "cand-1",
          source_id: "src-1",
          created_at: now,
        },
      ];

      const audit: AuditEventRecord[] = [
        {
          id: "audit-start-1",
          event: "coverage.research.started",
          actor: "director",
          occurred_at: now,
          operation_id: "op-start-1",
          details: {
            batch_id: "batch-1",
            task_ids: ["task-2"],
            existing_task_ids: ["task-1"],
            reused: false,
          },
        },
        {
          id: "audit-recover-1",
          event: "coverage.research.recovered",
          actor: "user",
          occurred_at: now,
          operation_id: "op-recover-1",
          details: {
            task_id: "task-2",
            action: "revise_query",
            successor_task_id: "task-3",
          },
        },
      ];

      const operations: OperationRecord[] = [
        {
          id: "op-start-1",
          kind: "coverage_research_start",
          status: "succeeded",
          created_at: now,
          updated_at: now,
        },
        {
          id: "op-recover-1",
          kind: "coverage_research_recovery",
          status: "succeeded",
          created_at: now,
          updated_at: now,
        },
      ];

      const state = makeMinimalProjectState({
        coverage_research_batches: batches,
        coverage_research_tasks: tasks,
        coverage_research_lineages: lineages,
        audit,
        operations,
      });

      const monitor = deriveResearchMonitor(state, now);

      // Verify Tasks view
      const t1 = monitor.tasks.find((t) => t.id === "task-1")!;
      expect(t1.is_terminal).toBe(true);
      expect(t1.is_in_flight).toBe(false);
      expect(t1.origin_kind).toBe("reused_existing");
      expect(t1.operation_ids).toContain("op-start-1");

      const t2 = monitor.tasks.find((t) => t.id === "task-2")!;
      expect(t2.is_terminal).toBe(true); // Exhausted is terminal history
      expect(t2.is_in_flight).toBe(false);
      expect(t2.origin_kind).toBe("newly_created");
      expect(t2.recovery_action).toBe("revise_query");
      expect(t2.successor_ids).toContain("task-3");
      expect(t2.operation_ids).toContain("op-start-1");
      expect(t2.operation_ids).toContain("op-recover-1");

      const t3 = monitor.tasks.find((t) => t.id === "task-3")!;
      expect(t3.is_terminal).toBe(false);
      expect(t3.is_in_flight).toBe(true);
      expect(t3.origin_kind).toBe("successor_recovery");
      expect(t3.predecessor_id).toBe("task-2");
      expect(t3.recovery_action).toBe("revise_query");
      expect(t3.operation_ids).toContain("op-recover-1");

      const t4 = monitor.tasks.find((t) => t.id === "task-4")!;
      expect(t4.is_terminal).toBe(true);
      expect(t4.is_in_flight).toBe(false);
      expect(t4.origin_kind).toBe("legacy_unknown");

      // Verify Requirement Lineages Chains
      expect(monitor.lineages).toBeDefined();
      expect(monitor.lineages.length).toBeGreaterThanOrEqual(2);

      const backgroundLineage = monitor.lineages.find((l) => l.requirement_id === "req.background" && l.character_id === "alpha");
      expect(backgroundLineage).toBeDefined();
      expect(backgroundLineage?.chains.length).toBe(1);

      const chain = backgroundLineage?.chains[0]!;
      expect(chain.root_task_id).toBe("task-2");
      expect(chain.nodes.length).toBe(2);
      expect(chain.nodes[0]?.id).toBe("task-2");
      expect(chain.nodes[0]?.is_terminal).toBe(true);
      expect(chain.nodes[1]?.id).toBe("task-3");
      expect(chain.nodes[1]?.is_in_flight).toBe(true);
    });
  });
});
