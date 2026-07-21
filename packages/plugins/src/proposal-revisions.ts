import { createHash } from "node:crypto";

import type { PluginProposalEnvelope, Revision } from "@card-workspace/schemas";

import { canonicalJson } from "./canonical.js";

/**
 * Proposal hashes are calculated over a payload with its derived hashes blanked.
 * This avoids the impossible self-referential hash that would result from
 * hashing an envelope containing its own pending-result revision.
 */
export function proposalHashPayload(proposal: PluginProposalEnvelope): Omit<PluginProposalEnvelope, "proposal_revision" | "pending_result_revision"> & {
  proposal_revision: "";
  pending_result_revision: "";
} {
  return {
    ...proposal,
    proposal_revision: "",
    pending_result_revision: "",
  };
}

export function proposalRevisionFor(proposal: PluginProposalEnvelope): Revision {
  return revisionForCanonical(proposalHashPayload(proposal));
}

export function pendingResultRevisionFor(proposal: PluginProposalEnvelope): Revision {
  return revisionForCanonical({
    ...proposal,
    pending_result_revision: "",
  });
}

export function proposalResultText(proposal: PluginProposalEnvelope): string {
  return `${canonicalJson(proposal)}\n`;
}

function revisionForCanonical(value: unknown): Revision {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
