import { describe, expect, it } from "vitest";
import { computeBuildPlan, computeProjectProjection, type FactReviewDecisionRecord, type OperationRecord, type ProjectState } from "@st-workspace/core";
import { compileProject } from "@st-workspace/compiler";
import { readCardFromPng } from "@st-workspace/adapters-png";
import { buildRequiredArtifactManifest, validateWorkflow } from "../src/index.js";
import { projectScenario } from "./project-scenario.js";

describe("project scenario invariants", () => {
  it("keeps gate plan artifact ids equal to the compiler artifact ids", async () => {
    const scenario = await projectScenario({ projectName: "Invariant A" });
    const state: ProjectState = await scenario.repository.read();
    const plan = computeBuildPlan(state, "both");
    const compiled = compileProject(state, { mode_selection: "both" });
    const planIds = plan.entries.map((entry) => entry.artifact_id).sort();
    const compilerIds = compiled.normalized.latestArtifacts.map((artifact) => artifact.id).sort();
    expect(planIds).toEqual(compilerIds);
    expect(planIds.length).toBeGreaterThan(0);
  });

  it("excludes artifacts bound to characters outside the Blueprint roster from the publish plan", async () => {
    const scenario = await projectScenario({ projectName: "Invariant B", outOfRosterCharacterId: "outsider" });
    const state: ProjectState = await scenario.repository.read();
    const plan = computeBuildPlan(state, "both");
    expect(plan.entries.some((entry) => entry.key.startsWith("zhuji:outsider/"))).toBe(false);
    const compiled = compileProject(state, { mode_selection: "both" });
    const planKeys = new Set(plan.entries.map((entry) => entry.key));
    for (const artifact of compiled.normalized.latestArtifacts) {
      if (artifact.kind === "zhuji" || artifact.kind === "palette") {
        expect(planKeys.has(artifact.key)).toBe(true);
      }
    }
  });

  it("gives every accepted fact revision a matching review decision", async () => {
    const scenario = await projectScenario({ projectName: "Invariant C" });
    const state: ProjectState = await scenario.repository.read();
    const decisions: FactReviewDecisionRecord[] = state.fact_review_decisions;
    for (const fact of state.facts.filter((item) => item.status === "accepted")) {
      const matching = decisions.find(
        (decision) =>
          decision.candidate_occurrence_id === (fact.candidate_occurrence_id ?? fact.id) &&
          decision.decision === "accepted" &&
          decision.resulting_fact_revision === fact.fact_revision,
      );
      expect(matching, `accepted fact ${fact.id} (revision ${fact.fact_revision}) has no matching decision`).toBeDefined();
    }
  });

  it("holds a valid fencing generation on operations with side effects", async () => {
    const scenario = await projectScenario({ projectName: "Invariant D", recoverableOperation: true });
    const state: ProjectState = await scenario.repository.read();
    const sideEffectOperations = state.operations.filter((operation) =>
      state.artifacts.some((artifact) => artifact.operation_id === operation.id),
    );
    expect(sideEffectOperations.length).toBeGreaterThan(0);
    for (const operation of state.operations.filter((item) => item.status === "running")) {
      expect(operation.lease_owner).toBeDefined();
      expect(operation.lease_token).toBeDefined();
      expect(operation.lease_expires_at).toBeDefined();
      expect(new Date(operation.lease_expires_at!).getTime()).toBeGreaterThan(Date.now());
    }
    const recoverable = state.operations.find((operation): operation is OperationRecord & { lease_token: string } => operation.id === "op-recover");
    expect(recoverable?.lease_token).toBe("lease-token-1");
  });

  it("compiles JSON and PNG from the same input set", async () => {
    const scenario = await projectScenario({ projectName: "Invariant E" });
    const state: ProjectState = await scenario.repository.read();
    const compiled = compileProject(state, { mode_selection: "both" });
    const card = readCardFromPng(compiled.png);
    const jsonCard = JSON.parse(compiled.json) as { data: unknown };
    expect(card.card.data).toEqual(jsonCard.data);
    expect(card.authority).toBe("ccv3");
  });

  it("uses one projection for original, source-adaptation, and primary selection", async () => {
    const original = await projectScenario({ projectName: "Original", primaryCharacterId: "c05" });
    const sourceAdaptation = await projectScenario({ projectName: "Adaptation", sourceAdaptation: true, primaryCharacterId: "c05" });
    for (const scenario of [original, sourceAdaptation]) {
      const state = await scenario.repository.read();
      const projection = computeProjectProjection(state);
      expect(projection.roster.find((character) => character.is_primary)?.id).toBe("c05");
      expect(projection.intent.primary_character_id).toBe("c05");
      expect(projection.intent.is_source_adaptation).toBe(scenario === sourceAdaptation);
    }
  });

  it("keeps the ten-character mixed-mode plan and gate scope aligned", async () => {
    const scenario = await projectScenario({ projectName: "Mixed ten", primaryCharacterId: "c07" });
    const state = await scenario.repository.read();
    const projection = computeProjectProjection(state);
    const plan = projection.publishPlan("both");
    const manifest = buildRequiredArtifactManifest(state);
    const compiled = compileProject(state, { mode_selection: "both" });
    const planIds = new Set(plan.entries.map((entry) => entry.artifact_id));
    expect(projection.roster).toHaveLength(10);
    expect(projection.roster.find((character) => character.is_primary)?.id).toBe("c07");
    expect(compiled.normalized.latestArtifacts.map((artifact) => artifact.id).sort()).toEqual([...planIds].sort());
    expect(manifest).toBeDefined();
    for (const artifactId of manifest!.in_scope_artifact_ids) expect(planIds.has(artifactId)).toBe(true);
    const gate = validateWorkflow(state, "publish", manifest);
    expect(gate.diagnostics.some((item) => item.code === "BLUEPRINT_PRIMARY_CHARACTER_FALLBACK")).toBe(false);
  });

  it("keeps same-character dual-mode variants independently selectable", async () => {
    const scenario = await projectScenario({
      projectName: "Dual mode",
      roster: [{ id: "dual", label: "Dual", mode: "zhuji" }, { id: "dual", label: "Dual", mode: "palette" }],
      primaryCharacterId: "dual",
    });
    const state = await scenario.repository.read();
    const projection = computeProjectProjection(state);
    const plan = projection.publishPlan("both");
    expect(plan.entries.filter((entry) => entry.kind === "zhuji")).toHaveLength(1);
    expect(plan.entries.filter((entry) => entry.kind === "palette")).toHaveLength(1);
    expect(new Set(plan.entries.map((entry) => entry.artifact_id)).size).toBe(plan.entries.length);
  });

  it("blocks an explicit primary excluded by the selected mode", async () => {
    const scenario = await projectScenario({
      projectName: "Primary mode boundary",
      roster: [
        { id: "palette-primary", label: "Palette Primary", mode: "palette" },
        { id: "zhuji-secondary", label: "Zhuji Secondary", mode: "zhuji" },
      ],
      primaryCharacterId: "palette-primary",
    });
    const state = await scenario.repository.read();
    const projection = computeProjectProjection(state);
    const zhujiPlan = projection.publishPlan("zhuji");
    const palettePlan = projection.publishPlan("palette");

    expect(zhujiPlan.export_roster.map((character) => character.id)).toEqual(["zhuji-secondary"]);
    expect(zhujiPlan.primary_character_id).toBeUndefined();
    expect(zhujiPlan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRIMARY_CHARACTER_EXCLUDED_BY_MODE", severity: "error" }),
    ]));
    expect(palettePlan.primary_character_id).toBe("palette-primary");
    expect(palettePlan.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRIMARY_CHARACTER_EXCLUDED_BY_MODE" }),
    ]));
  });

  it("uses exact publish scope for mode availability and deterministic primary fallback", async () => {
    const scenario = await projectScenario({
      projectName: "Exact mode scope",
      roster: [{ id: "palette-only", label: "Palette Only", mode: "palette" }],
      primaryCharacterId: null,
      outOfRosterCharacterId: "stale-zhuji",
    });
    const state = await scenario.repository.read();
    const projection = computeProjectProjection(state);
    const plan = projection.publishPlan("palette");

    expect(plan.export_roster.map((character) => character.id)).toEqual(["palette-only"]);
    expect(plan.primary_character_id).toBe("palette-only");
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRIMARY_CHARACTER_ID_FALLBACK", severity: "warning" }),
    ]));
    expect(plan.entries.some((entry) => entry.key.includes("stale-zhuji"))).toBe(false);
  });
});
