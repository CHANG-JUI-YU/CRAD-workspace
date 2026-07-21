import { factCandidateSchema, type FactCandidate } from "@card-workspace/schemas";
import { computeRevision } from "@card-workspace/project";

export function candidateOccurrenceId(batchId: string, rawCandidateId: string): string {
  const digest = computeRevision({ batch_id: batchId, candidate_id: rawCandidateId });
  return `candidate-occurrence-${digest.slice("sha256:".length)}`;
}

export function createCandidateOccurrence(batchId: string, candidate: FactCandidate): FactCandidate {
  return factCandidateSchema.parse({
    ...candidate,
    id: candidateOccurrenceId(batchId, candidate.id),
    extensions: {
      ...candidate.extensions,
      source_candidate_id: candidate.id,
      source_batch_id: batchId,
    },
  });
}
