import { describe, expect, it } from "vitest";
import { computeBuildPlan, type FactReviewDecisionRecord, type OperationRecord, type ProjectState } from "@st-workspace/core";
import { compileProject } from "@st-workspace/compiler";
import { readCardFromPng } from "@st-workspace/adapters-png";
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
});
