import {
  buildFactsCoverageReport,
  diagnoseFactCandidateQuality,
  readActiveCandidateIndex,
  readFactJournal,
  resolveActiveCandidate,
  verifyFactProjection,
} from "@card-workspace/ingestion";
import type { ProjectCharacter } from "@card-workspace/schemas";

export async function readFactsReadiness(projectRoot: string, characters: readonly ProjectCharacter[]) {
  const [active, journal, projection] = await Promise.all([
    readActiveCandidateIndex(projectRoot),
    readFactJournal(projectRoot),
    verifyFactProjection(projectRoot),
  ]);
  const reviewed = new Set<string>();
  const candidateFactIds = new Map<string, string>();
  const candidateDecisionTypes = new Map<string, string>();
  for (const event of journal.events) {
    const decision = event.payload.decision;
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) continue;
    if (typeof decision.candidate_id !== "string" || typeof decision.fact_id !== "string") continue;
    const candidate = resolveActiveCandidate(active.candidates, decision.candidate_id);
    if (!candidate) continue;
    reviewed.add(candidate.id);
    candidateFactIds.set(candidate.id, decision.fact_id);
    if (typeof decision.type === "string") candidateDecisionTypes.set(candidate.id, decision.type);
  }
  const candidateIds = [...active.candidates.keys()].sort();
  const qualityDiagnostics = candidateIds.flatMap((id) => {
    const candidate = active.candidates.get(id);
    return candidate ? diagnoseFactCandidateQuality(candidate) : [];
  });
  const blockingQualityDiagnostics = qualityDiagnostics.filter((diagnostic) =>
    candidateDecisionTypes.get(diagnostic.candidate_id) !== "rejected");
  const coverage = buildFactsCoverageReport({
    characters,
    facts: projection.register.facts,
    activeCandidates: active.candidates,
    candidateFactIds,
  });
  return {
    active,
    journal,
    projection,
    reviewed,
    candidateFactIds,
    candidateIds,
    qualityDiagnostics,
    blockingQualityDiagnostics,
    coverage,
    gateReady: candidateIds.every((id) => reviewed.has(id))
      && blockingQualityDiagnostics.length === 0
      && projection.conflicts.conflicts.every((conflict) => conflict.status !== "open")
      && coverage.gate_ready,
  };
}
