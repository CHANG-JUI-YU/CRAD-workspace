import {
  buildFactsCoverageReport,
  diagnoseFactCandidateQuality,
  readActiveCandidateIndex,
  readFactJournal,
  readHistoricalCandidateIndex,
  resolveActiveCandidate,
  verifyFactProjection,
} from "@card-workspace/ingestion";
import type { ProjectCharacter } from "@card-workspace/schemas";

export async function readFactsReadiness(projectRoot: string, characters: readonly ProjectCharacter[]) {
  const [active, journal, projection, historical] = await Promise.all([
    readActiveCandidateIndex(projectRoot),
    readFactJournal(projectRoot),
    verifyFactProjection(projectRoot),
    readHistoricalCandidateIndex(projectRoot),
  ]);
  const reviewed = new Set<string>();
  const candidateFactIds = new Map<string, string>();
  const candidateDecisionTypes = new Map<string, string>();
  for (const event of journal.events) {
    const decision = event.payload.decision;
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) continue;
    if (typeof decision.candidate_id !== "string" || typeof decision.fact_id !== "string") continue;
    const activeCandidate = resolveActiveCandidate(active.candidates, decision.candidate_id);
    const historicalCandidate = activeCandidate ?? resolveActiveCandidate(historical, decision.candidate_id);
    if (!historicalCandidate) continue;
    candidateFactIds.set(historicalCandidate.id, decision.fact_id);
    if (!activeCandidate) continue;
    reviewed.add(activeCandidate.id);
    if (typeof decision.type === "string") candidateDecisionTypes.set(activeCandidate.id, decision.type);
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
    activeCandidates: historical,
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
