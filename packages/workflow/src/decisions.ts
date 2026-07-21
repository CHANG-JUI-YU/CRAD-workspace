import { workflowDecisionSchema, type ArtifactReference, type WorkflowDecision } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";

export interface DecisionInput {
  id: string;
  kind: string;
  actor: string;
  actorRole: "user" | "director" | "engine";
  decidedAt: string;
  inputRevisions: ArtifactReference[];
  summary: string;
  option?: string;
  impact?: string;
}

export function createDecision(input: DecisionInput): WorkflowDecision {
  if (input.actorRole === "director" && input.kind.startsWith("gate.")) {
    workflowFail("GATE_ACTOR_DENIED", "Director 不可代替使用者作 gate decision");
  }
  return workflowDecisionSchema.parse({
    id: input.id,
    kind: input.kind,
    actor: input.actor,
    decided_at: input.decidedAt,
    input_revisions: input.inputRevisions,
    summary: input.summary,
    ...(input.option === undefined ? {} : { option: input.option }),
    ...(input.impact === undefined ? {} : { impact: input.impact }),
    extensions: {},
  });
}
