import { describe, expect, it } from "vitest";

import { pluginArtifactSchema } from "@card-workspace/schemas";

import { createRejectedGateSuccessor, decideGate, deriveCurrentContentSnapshot, deriveGateSnapshot, recordInterviewAnswer, supersedeStaleGates, supersedeStalePluginEvidence, WORKFLOW_GATE_ORDER } from "../src/index.js";
import { makeState, REVISION_A, REVISION_B } from "./helpers.js";

const gateInput = (gateId: "facts" | "blueprint" | "content" | "publish", action: "approve" | "reject" | "not_required" = "approve") => ({
  decisionId: `${gateId}-decision`, gateId, action, actor: "user-a", actorRole: "user" as const, decidedAt: "2026-07-14T00:00:00.000Z", inputRevisions: [{ id: `${gateId}-input`, revision: REVISION_A }], summary: `${action} ${gateId}`,
});

describe("interview, decisions and gates", () => {
  it("四 gate 順序固定，Director 不可批准", () => {
    expect(WORKFLOW_GATE_ORDER).toEqual(["facts", "blueprint", "content", "publish"]);
    expect(() => decideGate(makeState(), gateInput("blueprint"))).toThrow(/facts/u);
    expect(() => decideGate(makeState(), { ...gateInput("facts"), actorRole: "director" })).toThrow(/Director/u);
    expect(recordInterviewAnswer({ questionId: "purpose", actor: "director", answer: "原創角色", inputRevisions: [], answeredAt: "2026-07-14T00:00:00.000Z" }).answer).toBe("原創角色");
  });

  it("原創 Facts not_required 需要顯式 user decision", () => {
    const result = decideGate(makeState(), gateInput("facts", "not_required"));
    expect(result.state.gates[0]).toMatchObject({ status: "not_required", decision_id: "facts-decision" });
    expect(result.decision).toMatchObject({ actor: "user-a", input_revisions: gateInput("facts").inputRevisions });
    expect(result.decision).not.toHaveProperty("option");
    expect(() => decideGate(makeState({ entry_kind: "source_adaptation" }), gateInput("facts", "not_required"))).toThrow(/不可/u);
  });

  it("不可覆寫 normative/schema/provenance；workspace override 保存理由", () => {
    const finding = { id: "finding-a", category: "schema" as const, severity: "error" as const, overridable: true };
    expect(() => decideGate(makeState(), { ...gateInput("facts"), findings: [finding] })).toThrow(/不可覆寫/u);
    const workspace = { ...finding, category: "workspace" as const };
    expect(() => decideGate(makeState(), { ...gateInput("facts"), findings: [workspace] })).toThrow(/理由/u);
    const result = decideGate(makeState(), { ...gateInput("facts"), findings: [workspace], overrideReason: "使用者接受此文風風險" });
    expect(result.decision.impact).toBe("使用者接受此文風風險");
  });

  it("input revision 改變使 approval superseded", () => {
    const approved = decideGate(makeState(), gateInput("facts")).state;
    const unchanged = supersedeStaleGates(approved, new Map([["facts", gateInput("facts").inputRevisions]]));
    expect(unchanged).toBe(approved);
    const stale = supersedeStaleGates(approved, new Map([["facts", [{ id: "facts-input", revision: REVISION_B }]]]));
    expect(stale.gates[0]?.status).toBe("superseded");
    expect(stale.revision).toBe(approved.revision + 1);
  });

  it("rejected gate 只建立下一合法 task", () => {
    const rejected = decideGate(makeState(), { ...gateInput("facts", "reject"), rejectionRoute: "facts_recuration" });
    const task = createRejectedGateSuccessor(rejected.state.gates[0]!, { id: "task-revise-facts", kind: "revise-facts", assignedAgent: "fact-curator", capabilities: ["facts.propose"], inputArtifacts: [], outputContract: "fact-proposal@1", dependencies: [], maxAttempts: 3 });
    expect(task).toMatchObject({ status: "pending", assigned_agent: "fact-curator" });
  });

  it("由 engine 推導 exact snapshot 並拒絕空、stale 與錯誤 stage", () => {
    const state = makeState({
      stage: "blueprint",
      gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "pending", input_revisions: [], extensions: {} },
        { id: "content", status: "pending", input_revisions: [], extensions: {} },
        { id: "publish", status: "pending", input_revisions: [], extensions: {} },
      ],
      artifacts: [{ id: "blueprint", status: "draft", revision: REVISION_A, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
    });
    expect(deriveGateSnapshot(state, "blueprint")).toEqual([{ id: "blueprint", revision: REVISION_A }]);
    expect(() => decideGate(state, { ...gateInput("blueprint"), inputRevisions: [{ id: "blueprint", revision: REVISION_B }] })).toThrow(/stale|exact/u);
    expect(() => deriveGateSnapshot(makeState({ stage: "blueprint" }), "blueprint")).toThrow(/snapshot/u);
    expect(() => deriveGateSnapshot(makeState({ stage: "content_review" }), "blueprint")).toThrow(/stage/u);
  });

  it("拒絕 Content 與 Publish 必須保存唯一明確 route", () => {
    const content = makeState({
      stage: "content_review",
      artifacts: [{ id: "author-greetings.yaml", status: "reviewed", revision: REVISION_A, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
      gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "approved", input_revisions: [{ id: "blueprint", revision: REVISION_A }], extensions: {} },
        { id: "content", status: "pending", input_revisions: [], extensions: {} },
        { id: "publish", status: "pending", input_revisions: [], extensions: {} },
      ],
    });
    const contentInput = { ...gateInput("content", "reject"), inputRevisions: [{ id: "author-greetings.yaml", revision: REVISION_A }] };
    expect(() => decideGate(content, contentInput)).toThrow(/scope/u);
    const rejected = decideGate(content, { ...contentInput, rejectionRoute: "content_revision", revisionScope: ["greetings"] });
    expect(rejected.state.extensions.needs_revision_scope).toEqual(["greetings"]);

    const publish = makeState({
      stage: "publish_review",
      artifacts: [{ id: "preview-current", status: "reviewed", revision: REVISION_A, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }],
      gates: content.gates.map((gate) => gate.id === "content" ? { ...gate, status: "approved" as const } : gate),
    });
    expect(() => decideGate(publish, { ...gateInput("publish", "reject"), inputRevisions: [{ id: "preview-current", revision: REVISION_A }] })).toThrow(/repreview|content_revision|cancel/u);
  });

  it("plugin input drift 會使 plugin artifact、preview 與 Content/Publish evidence 失效", () => {
    const plugin = pluginArtifactSchema.parse({
      id: "plugin-official.mvu-zod",
      plugin_id: "official.mvu-zod",
      revision: REVISION_A,
      source_revision: REVISION_A,
      resolved_source_hash: REVISION_A,
      implementation: {
        version: "1.0.0",
        digest: REVISION_A,
        asset_manifest_id: "sillytavern-assets",
        asset_manifest_revision: REVISION_A,
        asset_manifest_hash: REVISION_A,
      },
      generated_at: "2026-07-14T00:00:00.000Z",
      status: "approved",
    });
    const state = makeState({
      stage: "compile_preview",
      revision: 10,
      artifacts: [
        { id: plugin.id, status: "approved", revision: plugin.revision, updated_at: plugin.generated_at, contract: "plugin-artifact@1", extensions: {} },
        { id: "preview-current", status: "reviewed", revision: REVISION_B, updated_at: plugin.generated_at, extensions: {} },
      ],
      gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [{ id: plugin.id, revision: plugin.revision, contract: "plugin-artifact@1" }], extensions: {} },
        { id: "publish", status: "approved", input_revisions: [{ id: "preview-current", revision: REVISION_B }], extensions: {} },
      ],
      extensions: { plugin_selection_revision: REVISION_A },
    });
    expect(supersedeStalePluginEvidence(state, [plugin], REVISION_A)).toBe(state);

    const changed = { ...plugin, revision: REVISION_B };
    const stale = supersedeStalePluginEvidence({ ...state }, [changed], REVISION_B);
    expect(stale.revision).toBe(state.revision + 1);
    expect(stale.artifacts.find((item) => item.id === plugin.id)?.status).toBe("stale");
    expect(stale.artifacts.find((item) => item.id === "preview-current")?.status).toBe("stale");
    expect(stale.gates.find((gate) => gate.id === "content")?.status).toBe("superseded");
    expect(stale.gates.find((gate) => gate.id === "publish")?.status).toBe("superseded");
    expect(deriveCurrentContentSnapshot(stale)).toEqual([]);
  });

  it("保留已標記的相依 stale evidence，不會把新批准的 plugin artifact 再次失效", () => {
    const mvu = pluginArtifactSchema.parse({
      id: "plugin-official.mvu-zod",
      plugin_id: "official.mvu-zod",
      revision: REVISION_A,
      source_revision: REVISION_A,
      resolved_source_hash: REVISION_A,
      implementation: {
        version: "1.0.0",
        digest: REVISION_A,
        asset_manifest_id: "sillytavern-assets",
        asset_manifest_revision: REVISION_A,
        asset_manifest_hash: REVISION_A,
      },
      generated_at: "2026-07-14T00:00:00.000Z",
      status: "approved",
    });
    const ejs = { ...mvu, id: "plugin-official.ejs" as const, plugin_id: "official.ejs" as const, status: "stale" as const };
    const state = makeState({
      stage: "plugin_ejs_authoring",
      artifacts: [
        { id: mvu.id, status: "approved", revision: REVISION_A, updated_at: mvu.generated_at, contract: "plugin-artifact@1", extensions: {} },
        { id: ejs.id, status: "stale", revision: ejs.revision, updated_at: ejs.generated_at, contract: "plugin-artifact@1", extensions: {} },
      ],
      extensions: { plugin_selection_revision: REVISION_A },
    });

    expect(supersedeStalePluginEvidence(state, [mvu, { ...ejs, status: "approved" }], REVISION_A)).toBe(state);
  });
});
