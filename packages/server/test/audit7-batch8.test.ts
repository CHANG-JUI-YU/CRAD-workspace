import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { runFormalCoverageAssessment } from "@st-workspace/domain";
import { createWorkspaceServer } from "../src/index.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";
import { DASHBOARD_PANELS_REVIEW_JS } from "../src/dashboard-panels-review.js";
import { DASHBOARD_CSS } from "../src/dashboard-css.js";

const now = "2026-08-15T00:00:00.000Z";

function makePrecheck(projectId: string): BlueprintPrecheckRecord {
  const bp = {
    schema_version: 1,
    title: "Test Blueprint",
    source_adaptation: true,
    characters: [
      { id: "alpha", label: "Alpha", is_primary: true },
    ],
    world: { enabled: true },
    relationships: { enabled: false },
  };
  const rev = contentHash(JSON.stringify(bp));
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: bp,
    candidate_blueprint_revision: rev,
    status: "recorded",
    checks: [
      {
        subject_id: "alpha",
        dimension: "character_core",
        uncertainty: "low",
        impact: "low",
        basis: "blueprint character",
        action: "preserve_explicit",
      },
    ],
    created_at: now,
    created_by: "director",
  };
}

async function createServerFixture() {
  const pc = makePrecheck("test-proj");
  const reqSet: CoverageRequirementSet = {
    id: "reqset-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [
      { character_id: "alpha", requirement_ids: ["req.appearance"] },
    ],
    world_requirement_ids: [],
    created_at: now,
    created_by: "director",
  };

  const base = createProjectState("test-proj", "Test Project");
  const initial: ProjectState = {
    ...base,
    blueprint_prechecks: [pc],
    coverage_requirement_sets: [reqSet],
  };

  const assessment = runFormalCoverageAssessment(initial, reqSet, "op-formal-1", "director");
  const readyState: ProjectState = {
    ...initial,
    coverage_assessments: [assessment],
  };

  const repo = new MemoryProjectRepository("test-proj", readyState);
  const runtime = new WorkspaceRuntime(repo);
  const server = createWorkspaceServer({
    actor: "director",
    runtime,
    autoStartWorker: false,
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected address");

  return {
    url: `http://127.0.0.1:${address.port}`,
    server: {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    },
    repo,
    assessment,
    reqSet,
  };
}

describe("Audit 7 Batch 8: Server Tests", () => {
  describe("Dashboard Panels UI & Navigation Contract (#80, #89, #86, #87)", () => {
    it("exports properly structured UI markup with no window.prompt for creative completion", () => {
      // #86 UX7-04: window.prompt should be completely removed
      expect(DASHBOARD_PANELS_COVERAGE_JS).not.toContain("window.prompt");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("openCreativeCompletionDialog");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("Creative Completion 是創作授權，不是 source-backed evidence");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("創作授權決策");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("授權理由");

      // No innerHTML in coverage panels JS
      expect(DASHBOARD_PANELS_COVERAGE_JS).not.toContain("innerHTML");

      // #80 BUG7-12: Lazy-load revealDiagnosticTarget with generation token and fallback
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("function revealDiagnosticTarget");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("currentDiagnosticNavToken");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("loadArtifactData");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("loadCoverageCenterData");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("找不到指定物件");

      // #80 & #89: Canonical data-object-kind markings
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain('data-object-kind", "operation"');
      expect(DASHBOARD_PANELS_REVIEW_JS).toContain('data-object-kind", "review_run"');

      // #89 UX7-07: Grouped publish diagnostics UI
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("diagnostic-group-card");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("diagnostic-group-header");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("diagnostic-object-list");
      expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("secondary-diagnostics");

      // #87 UX7-05: Research Lineage & Task Context
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("renderResearchLineages");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("openTaskContextModal");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("lineage-node-card");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("node-in-flight");
      expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("node-terminal");

      // CSS rules
      expect(DASHBOARD_CSS).toContain(".diagnostic-group-card");
      expect(DASHBOARD_CSS).toContain(".creative-warning-box");
      expect(DASHBOARD_CSS).toContain(".lineage-node-card");
      expect(DASHBOARD_CSS).toContain("prefers-reduced-motion");
    });
  });

  describe("Creative Completion Resolution HTTP Endpoint (#86 UX7-04)", () => {
    it("previews and confirms creative completion resolution with independent choice and rationale", async () => {
      const fixture = await createServerFixture();

      try {
        // Preview
        const previewRes = await fetch(`${fixture.url}/workspace/coverage/resolution/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assessment_id: fixture.assessment.id,
            assessment_revision: fixture.assessment.revision,
            requirement_id: "req.appearance",
            character_id: "alpha",
            action: "creative_completion",
          }),
        });
        const previewText = await previewRes.text();
        if (previewRes.status !== 200) {
          throw new Error("previewRes error " + previewRes.status + ": " + previewText);
        }
        const previewJson = JSON.parse(previewText);
        expect(previewJson.action).toBe("creative_completion");
        expect(Array.isArray(previewJson.consequences)).toBe(true);

        // Confirm
        const confirmRes = await fetch(`${fixture.url}/workspace/coverage/resolution/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assessment_id: fixture.assessment.id,
            assessment_revision: fixture.assessment.revision,
            requirement_id: "req.appearance",
            character_id: "alpha",
            action: "creative_completion",
            choice: "授權創作補全設定",
            rationale: "官方無直接外觀描述，依世界觀設定推導補全。",
            operation_id: "op-creative-001",
          }),
        });
        expect(confirmRes.status).toBe(200);
        const confirmJson = await confirmRes.json();
        expect(confirmJson.resolutions).toBeDefined();
        expect(confirmJson.resolutions.length).toBeGreaterThan(0);
        const resItem = confirmJson.resolutions[0];
        expect(resItem.mode).toBe("creative_completion");
        expect(confirmJson.decision).toBeDefined();
        expect(confirmJson.decision.choice).toBe("授權創作補全設定");
        expect(confirmJson.decision.rationale).toBe("官方無直接外觀描述，依世界觀設定推導補全。");
        expect(confirmJson.downstream_invalidation).toBeDefined();

        // Idempotent retry with same operation_id
        const retryRes = await fetch(`${fixture.url}/workspace/coverage/resolution/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assessment_id: fixture.assessment.id,
            assessment_revision: fixture.assessment.revision,
            requirement_id: "req.appearance",
            character_id: "alpha",
            action: "creative_completion",
            choice: "授權創作補全設定",
            rationale: "官方無直接外觀描述，依世界觀設定推導補全。",
            operation_id: "op-creative-001",
          }),
        });
        expect(retryRes.status).toBe(200);
        const retryJson = await retryRes.json();
        expect(retryJson.resolution_id).toBe(confirmJson.resolution_id);
      } finally {
        await fixture.server.close();
      }
    });
  });
});
