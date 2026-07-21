import { describe, expect, it } from "vitest";

import { advanceWorkflow, getWorkflowDefinition, WORKFLOW_STAGE_ORDER } from "../src/index.js";
import { makeState, REVISION_A } from "./helpers.js";

describe("workflow definitions and state machine", () => {
  it("四種入口有 deterministic stage plan", () => {
    for (const kind of ["original", "source_adaptation", "card_import", "mode_conversion"] as const) {
      expect(getWorkflowDefinition(kind).stages).toEqual(WORKFLOW_STAGE_ORDER);
      expect(getWorkflowDefinition(kind)).toEqual(getWorkflowDefinition(kind));
    }
  });

  it("只允許具 capability 的相鄰前進與 expected revision", () => {
    const state = makeState();
    const event = {
      kind: "stage.advance" as const,
      expectedRevision: 0,
      target: "source_processing" as const,
      actor: "director",
      actorCapabilities: ["workflow.advance"],
    };
    expect(advanceWorkflow(state, event)).toMatchObject({ stage: "source_processing", revision: 1 });
    expect(state).toMatchObject({ stage: "intake", revision: 0 });
    expect(() => advanceWorkflow(state, { ...event, target: "blueprint" })).toThrow(/只能/u);
    expect(() => advanceWorkflow(state, { ...event, expectedRevision: 1 })).toThrow(/revision/u);
    expect(() => advanceWorkflow(state, { ...event, actorCapabilities: [] })).toThrow(/capability/u);
  });

  it("檢查 gate、artifact、task 與 diagnostics preconditions", () => {
    const blueprint = makeState({
      stage: "blueprint",
      gates: makeState().gates.map((gate) => gate.id === "blueprint" ? { ...gate, status: "approved" } : gate),
      artifacts: [{ id: "blueprint", status: "approved", revision: REVISION_A, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
    });
    const event = { kind: "stage.advance" as const, expectedRevision: 0, target: "pre_world_authoring" as const, actor: "director", actorCapabilities: ["workflow.advance"] };
    expect(advanceWorkflow(blueprint, event).stage).toBe("pre_world_authoring");
    expect(() => advanceWorkflow({ ...blueprint, artifacts: [] }, event)).toThrow(/artifact/u);
    expect(() => advanceWorkflow({ ...blueprint, gates: makeState().gates }, event)).toThrow(/gate/u);
    expect(() => advanceWorkflow({ ...blueprint, tasks: [{
      id: "task-a", kind: "create", status: "pending", assigned_agent: "creator", capabilities: [], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 3, extensions: {},
    }] }, event)).toThrow(/task/u);
    expect(() => advanceWorkflow(blueprint, { ...event, diagnostics: [{ code: "schema", severity: "error" }] })).toThrow(/diagnostic/u);
  });

  it("禁止重複 publish", () => {
    const state = makeState({ stage: "published" });
    expect(() => advanceWorkflow(state, { kind: "stage.advance", expectedRevision: 0, target: "published", actor: "director", actorCapabilities: ["workflow.advance"] })).toThrow(/不可再次/u);
  });
});
