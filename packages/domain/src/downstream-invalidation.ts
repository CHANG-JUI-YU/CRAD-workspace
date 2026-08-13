import {
  artifactDependencyFingerprint,
  canonicalJson,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type BuildPlan,
  type BuildRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type CoverageResolution,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
  type PublishRecord,
  type ReviewRecord,
  type SourceRecord,
} from "@st-workspace/core";
import { buildCoverageSnapshot, coverageAssessmentFreshness, isCoverageSensitiveArtifactKind, projectActiveCoverageBindings } from "./coverage-assessment.js";
import { validateWorkflow } from "./workflow-gate.js";

export type DownstreamInvalidationSourceKind =
  | "source"
  | "fact"
  | "fact_review_run"
  | "fact_review_decision"
  | "blueprint_precheck"
  | "artifact"
  | "coverage_requirement_set"
  | "coverage_assessment"
  | "coverage_resolution"
  | "coverage_binding"
  | "build"
  | "publish";

export interface DownstreamInvalidationSource {
  kind: DownstreamInvalidationSourceKind;
  id?: string;
  revision?: string;
}

export type DownstreamInvalidationTargetKind = "artifact" | "review" | "coverage_assessment" | "build" | "publish_readiness";

export interface DownstreamInvalidationItem {
  target_kind: DownstreamInvalidationTargetKind;
  target_id: string;
  revision?: string;
  reason_code: string;
  reason: string;
  next_action: string;
}

export interface DownstreamInvalidationReport {
  invalidated: boolean;
  sources: DownstreamInvalidationSource[];
  items: DownstreamInvalidationItem[];
  publish_readiness_affected: boolean;
}

export function emptyDownstreamInvalidationReport(): DownstreamInvalidationReport {
  return { invalidated: false, sources: [], items: [], publish_readiness_affected: false };
}

interface ArtifactStaleFinding {
  code: string;
  reason: string;
  next_action: string;
}

function latestRecordedPrecheck(state: ProjectState): BlueprintPrecheckRecord | undefined {
  return [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
}

function latestAuthoritativeRun(state: ProjectState): FactReviewRunRecord | undefined {
  return [...state.fact_review_runs].reverse().find((run) => run.status !== "superseded");
}

function latestBuild(state: ProjectState): BuildRecord | undefined {
  return [...state.builds].reverse().find((build) => build.status === "previewed" || build.status === "built");
}

function sameSourceRevisions(left: readonly { source_id: string; revision: string }[], right: readonly { source_id: string; revision: string }[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a.source_id !== b.source_id || a.revision !== b.revision) return false;
  }
  return true;
}

function recordSignature(record: { id: string }, value: unknown): string {
  return contentHash(canonicalJson({ id: record.id, value }));
}

function sourceSignature(source: SourceRecord): string {
  return source.revision;
}

function factSignature(fact: FactRecord): string {
  return recordSignature(fact, {
    statement: fact.statement,
    status: fact.status,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    classification: fact.classification,
    entity_refs: fact.entity_refs,
    coverage_targets: fact.coverage_targets,
    confidence: fact.confidence,
    source_ids: fact.source_ids,
    evidence_revision: fact.evidence_revision,
    fact_revision: fact.fact_revision,
    accepted_fact_revision: fact.accepted_fact_revision,
    decision_id: fact.decision_id,
  });
}

function reviewRunSignature(run: FactReviewRunRecord): string {
  return recordSignature(run, {
    status: run.status,
    source_revisions: run.source_revisions,
    candidate_set_revision: run.candidate_set_revision,
    candidate_occurrence_ids: run.candidate_occurrence_ids,
  });
}

function reviewDecisionSignature(decision: FactReviewDecisionRecord): string {
  return recordSignature(decision, {
    decision: decision.decision,
    fact_id: decision.fact_id,
    reviewer_identity: decision.reviewer_identity,
    candidate_revision: decision.candidate_revision,
    resulting_fact_revision: decision.resulting_fact_revision,
    evidence: decision.evidence,
  });
}

function precheckSignature(precheck: BlueprintPrecheckRecord): string {
  return recordSignature(precheck, {
    status: precheck.status,
    candidate_blueprint_revision: precheck.candidate_blueprint_revision,
  });
}

function artifactSignature(artifact: ArtifactRecord): string {
  return artifact.revision;
}

function requirementSetSignature(set: CoverageRequirementSet): string {
  return set.revision;
}

function assessmentSignature(assessment: CoverageAssessment): string {
  return recordSignature(assessment, {
    pass: assessment.pass,
    revision: assessment.revision,
    requirement_set_revision: assessment.requirement_set_revision,
    input_snapshot: assessment.input_snapshot,
  });
}

function resolutionSignature(resolution: CoverageResolution): string {
  return recordSignature(resolution, {
    status: resolution.status,
    mode: resolution.mode,
    supersedes: resolution.supersedes,
    assessment_revision: resolution.assessment_revision,
    requirement_id: resolution.requirement_id,
  });
}

function bindingSignature(binding: { id: string; artifact_revision: string; assessment_revision: string; input_snapshot_hash: string; resolution_ids: string[] }): string {
  return recordSignature(binding, {
    artifact_revision: binding.artifact_revision,
    assessment_revision: binding.assessment_revision,
    input_snapshot_hash: binding.input_snapshot_hash,
    resolution_ids: binding.resolution_ids,
  });
}

function buildSignature(build: BuildRecord): string {
  return recordSignature(build, {
    status: build.status,
    content_hash: build.content_hash,
    coverage_snapshot_hash: build.coverage_snapshot?.snapshot_hash,
  });
}

function publishSignature(publish: PublishRecord): string {
  return publish.content_hash ?? publish.id;
}

function diffCollections<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  signatureOf: (record: T) => string,
  kind: DownstreamInvalidationSourceKind,
): DownstreamInvalidationSource[] {
  const beforeById = new Map(before.map((item) => [item.id, signatureOf(item)] as const));
  const afterById = new Map(after.map((item) => [item.id, signatureOf(item)] as const));
  const sources: DownstreamInvalidationSource[] = [];
  for (const [id, revision] of afterById) {
    if (beforeById.get(id) !== revision) sources.push({ kind, id, revision });
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) sources.push({ kind, id });
  }
  return sources;
}

function detectMutationSources(before: ProjectState, after: ProjectState): DownstreamInvalidationSource[] {
  return [
    ...diffCollections(before.sources, after.sources, sourceSignature, "source"),
    ...diffCollections(before.facts, after.facts, factSignature, "fact"),
    ...diffCollections(before.fact_review_runs, after.fact_review_runs, reviewRunSignature, "fact_review_run"),
    ...diffCollections(before.fact_review_decisions, after.fact_review_decisions, reviewDecisionSignature, "fact_review_decision"),
    ...diffCollections(before.blueprint_prechecks, after.blueprint_prechecks, precheckSignature, "blueprint_precheck"),
    ...diffCollections(before.artifacts, after.artifacts, artifactSignature, "artifact"),
    ...diffCollections(before.coverage_requirement_sets, after.coverage_requirement_sets, requirementSetSignature, "coverage_requirement_set"),
    ...diffCollections(before.coverage_assessments, after.coverage_assessments, assessmentSignature, "coverage_assessment"),
    ...diffCollections(before.coverage_resolutions, after.coverage_resolutions, resolutionSignature, "coverage_resolution"),
    ...diffCollections(before.coverage_authoring_bindings, after.coverage_authoring_bindings, bindingSignature, "coverage_binding"),
    ...diffCollections(before.builds, after.builds, buildSignature, "build"),
    ...diffCollections(before.publishes, after.publishes, publishSignature, "publish"),
  ];
}

const BINDING_ARTIFACT_KINDS: ReadonlySet<ArtifactRecord["kind"]> = new Set([
  "character", "relationship", "world_lore", "greeting", "zhuji", "palette", "wardrobe", "plugin",
]);

function artifactStaleFindings(state: ProjectState, plan: BuildPlan, artifact: ArtifactRecord): ArtifactStaleFinding[] {
  const findings: ArtifactStaleFinding[] = [];
  if (!plan.entries.some((entry) => entry.key === artifact.key)) return findings;
  const precheck = latestRecordedPrecheck(state);
  if (precheck !== undefined
    && BINDING_ARTIFACT_KINDS.has(artifact.kind)
    && (artifact.blueprint_precheck_id !== precheck.id || artifact.blueprint_precheck_revision !== precheck.candidate_blueprint_revision)) {
    findings.push({
      code: "BLUEPRINT_BINDING_STALE",
      reason: `Artifact ${artifact.name} was authored against blueprint precheck ${artifact.blueprint_precheck_id ?? "none"}@${artifact.blueprint_precheck_revision ?? "none"}; the current precheck is ${precheck.id}@${precheck.candidate_blueprint_revision}.`,
      next_action: "Re-author the artifact against the current Blueprint.",
    });
  }
  if (artifact.dependency_fingerprint !== undefined) {
    const expected = artifactDependencyFingerprint(state, artifact);
    if (expected !== artifact.dependency_fingerprint) {
      findings.push({
        code: "ARTIFACT_DEPENDENCY_STALE",
        reason: `Dependency fingerprint of ${artifact.name} changed; sources, facts, or Blueprint inputs moved after it was authored.`,
        next_action: "Create a new artifact revision from the current inputs.",
      });
    }
  }
  if (isCoverageSensitiveArtifactKind(artifact.kind)) {
    const binding = projectActiveCoverageBindings(state, plan).find((projected) => projected.artifact.id === artifact.id);
    if (binding !== undefined && binding.status !== "current") {
      findings.push({
        code: "COVERAGE_AUTHORING_BINDING_STALE",
        reason: binding.reason ?? `Coverage binding of ${artifact.name} is ${binding.status}.`,
        next_action: "Re-run the formal coverage assessment and re-author the artifact.",
      });
    }
  }
  return findings;
}

function coverageAssessmentStaleComponents(state: ProjectState, assessment: CoverageAssessment): string[] {
  const components: string[] = [];
  const snapshot = assessment.input_snapshot;
  const precheck = latestRecordedPrecheck(state);
  if ((precheck === undefined && snapshot.blueprint_revision !== undefined)
    || (precheck !== undefined && snapshot.blueprint_revision !== precheck.candidate_blueprint_revision)) {
    components.push("blueprint");
  }
  const run = latestAuthoritativeRun(state);
  if ((run === undefined && snapshot.fact_review_run_id !== undefined)
    || (run !== undefined && snapshot.fact_review_run_id !== run.id)) {
    components.push("fact_review_run");
  }
  const currentSources = state.sources.map((source) => ({ source_id: source.id, revision: source.revision }));
  if (!sameSourceRevisions(snapshot.source_revisions, currentSources)) components.push("sources");
  if (snapshot.fact_projection_revision !== coverageFactProjectionRevision(state)) components.push("facts");
  return components;
}

function reviewStaleReason(review: ReviewRecord, currentRevision: string): { reason: string; next_action: string } {
  return {
    reason: `Review ${review.id} was recorded against artifact revision ${review.artifact_revision}; the current revision is ${currentRevision}.`,
    next_action: "Re-run the review against the current artifact revision.",
  };
}

export function deriveDownstreamInvalidation(before: ProjectState, after: ProjectState): DownstreamInvalidationReport {
  const sources = detectMutationSources(before, after);
  if (sources.length === 0) return emptyDownstreamInvalidationReport();

  const report: DownstreamInvalidationReport = {
    invalidated: false,
    sources,
    items: [],
    publish_readiness_affected: false,
  };
  const beforeProjection = computeProjectProjection(before);
  const afterProjection = computeProjectProjection(after);
  const beforePlan = beforeProjection.publishPlan();
  const afterPlan = afterProjection.publishPlan();
  const beforeArtifactById = new Map(before.artifacts.map((artifact) => [artifact.id, artifact]));
  const afterArtifactById = new Map(after.artifacts.map((artifact) => [artifact.id, artifact]));
  const afterEntryByArtifact = new Map(afterPlan.entries.map((entry) => [entry.artifact_id, entry]));
  const beforeEntryByArtifact = new Map(beforePlan.entries.map((entry) => [entry.artifact_id, entry]));

  for (const entry of afterPlan.entries) {
    const artifact = afterArtifactById.get(entry.artifact_id);
    if (artifact === undefined) continue;
    const beforeArtifact = beforeArtifactById.get(entry.artifact_id);
    const beforeFindings = beforeArtifact === undefined ? [] : artifactStaleFindings(before, beforePlan, beforeArtifact);
    for (const finding of artifactStaleFindings(after, afterPlan, artifact)) {
      if (beforeFindings.some((previous) => previous.code === finding.code)) continue;
      report.items.push({
        target_kind: "artifact",
        target_id: artifact.id,
        revision: artifact.revision,
        reason_code: finding.code,
        reason: finding.reason,
        next_action: finding.next_action,
      });
      report.invalidated = true;
    }
  }

  for (const review of after.reviews) {
    const entry = afterEntryByArtifact.get(review.artifact_id);
    if (entry === undefined || review.artifact_revision === entry.revision) continue;
    const beforeEntry = beforeEntryByArtifact.get(review.artifact_id);
    const beforeReview = before.reviews.find((previous) => previous.id === review.id);
    if (beforeReview !== undefined && beforeEntry !== undefined && beforeReview.artifact_revision !== beforeEntry.revision) continue;
    const details = reviewStaleReason(review, entry.revision);
    report.items.push({
      target_kind: "review",
      target_id: review.id,
      revision: entry.revision,
      reason_code: "REVIEW_REVISION_STALE",
      reason: details.reason,
      next_action: details.next_action,
    });
    report.invalidated = true;
  }

  for (const assessment of [...after.coverage_assessments].reverse()) {
    const beforeAssessment = before.coverage_assessments.find((previous) => previous.id === assessment.id);
    if (beforeAssessment === undefined) continue;
    if (coverageAssessmentFreshness(after, assessment)) continue;
    if (coverageAssessmentFreshness(before, beforeAssessment)) {
      const components = coverageAssessmentStaleComponents(after, assessment);
      report.items.push({
        target_kind: "coverage_assessment",
        target_id: assessment.id,
        revision: assessment.revision,
        reason_code: "COVERAGE_ASSESSMENT_STALE",
        reason: `Coverage assessment ${assessment.id} is stale: ${components.join(", ") || "inputs"} changed after it was recorded.`,
        next_action: "Re-run the formal coverage assessment against current inputs.",
      });
      report.invalidated = true;
    }
  }

  const lastBuild = latestBuild(after);
  if (lastBuild?.coverage_snapshot !== undefined) {
    const latestAssessment = after.coverage_assessments.at(-1);
    if (latestAssessment !== undefined) {
      const expectedSnapshot = buildCoverageSnapshot(after, latestAssessment, afterPlan);
      if (lastBuild.coverage_snapshot.snapshot_hash !== expectedSnapshot.snapshot_hash) {
        let wasStale = false;
        const beforeBuild = before.builds.find((previous) => previous.id === lastBuild.id);
        const beforeLatestAssessment = before.coverage_assessments.at(-1);
        if (beforeBuild?.coverage_snapshot !== undefined && beforeLatestAssessment !== undefined) {
          const beforeExpected = buildCoverageSnapshot(before, beforeLatestAssessment, beforePlan);
          wasStale = beforeBuild.coverage_snapshot.snapshot_hash !== beforeExpected.snapshot_hash;
        }
        if (!wasStale) {
          report.items.push({
            target_kind: "build",
            target_id: lastBuild.id,
            revision: lastBuild.coverage_snapshot.snapshot_hash,
            reason_code: "COVERAGE_PUBLISH_SNAPSHOT_STALE",
            reason: `Build ${lastBuild.id} carries a coverage snapshot (${lastBuild.coverage_snapshot.snapshot_hash.slice(0, 12)}) that no longer matches current assessment, facts, or sources.`,
            next_action: "Re-run the build preview to refresh the publish snapshot.",
          });
          report.invalidated = true;
        }
      }
    }
  }

  const beforeGate = validateWorkflow(before, "publish");
  const afterGate = validateWorkflow(after, "publish");
  if (beforeGate.ok && !afterGate.ok) {
    const codes = [...new Set(afterGate.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code))];
    report.items.push({
      target_kind: "publish_readiness",
      target_id: after.project_id,
      reason_code: "PUBLISH_READINESS_BLOCKED",
      reason: `Publish readiness regressed: ${codes.join(", ") || "publish gate diagnostics"} block publishing.`,
      next_action: "Resolve the publish gate diagnostics before publishing.",
    });
    report.publish_readiness_affected = true;
    report.invalidated = true;
  }
  return report;
}

export function deriveProjectInvalidations(state: ProjectState): DownstreamInvalidationReport {
  const report: DownstreamInvalidationReport = {
    invalidated: false,
    sources: [],
    items: [],
    publish_readiness_affected: false,
  };
  const projection = computeProjectProjection(state);
  const plan = projection.publishPlan();
  const artifactById = new Map(state.artifacts.map((artifact) => [artifact.id, artifact]));
  const entryByArtifact = new Map(plan.entries.map((entry) => [entry.artifact_id, entry]));

  for (const entry of plan.entries) {
    const artifact = artifactById.get(entry.artifact_id);
    if (artifact === undefined) continue;
    for (const finding of artifactStaleFindings(state, plan, artifact)) {
      report.items.push({
        target_kind: "artifact",
        target_id: artifact.id,
        revision: artifact.revision,
        reason_code: finding.code,
        reason: finding.reason,
        next_action: finding.next_action,
      });
      report.invalidated = true;
    }
  }

  for (const review of state.reviews) {
    const entry = entryByArtifact.get(review.artifact_id);
    if (entry === undefined || review.artifact_revision === entry.revision) continue;
    const details = reviewStaleReason(review, entry.revision);
    report.items.push({
      target_kind: "review",
      target_id: review.id,
      revision: entry.revision,
      reason_code: "REVIEW_REVISION_STALE",
      reason: details.reason,
      next_action: details.next_action,
    });
    report.invalidated = true;
  }

  for (const assessment of [...state.coverage_assessments].reverse()) {
    if (coverageAssessmentFreshness(state, assessment)) continue;
    const components = coverageAssessmentStaleComponents(state, assessment);
    report.items.push({
      target_kind: "coverage_assessment",
      target_id: assessment.id,
      revision: assessment.revision,
      reason_code: "COVERAGE_ASSESSMENT_STALE",
      reason: `Coverage assessment ${assessment.id} is stale: ${components.join(", ") || "inputs"} changed after it was recorded.`,
      next_action: "Re-run the formal coverage assessment against current inputs.",
    });
    report.invalidated = true;
  }

  const lastBuild = latestBuild(state);
  if (lastBuild?.coverage_snapshot !== undefined) {
    const latestAssessment = state.coverage_assessments.at(-1);
    if (latestAssessment !== undefined) {
      const expectedSnapshot = buildCoverageSnapshot(state, latestAssessment, plan);
      if (lastBuild.coverage_snapshot.snapshot_hash !== expectedSnapshot.snapshot_hash) {
        report.items.push({
          target_kind: "build",
          target_id: lastBuild.id,
          revision: lastBuild.coverage_snapshot.snapshot_hash,
          reason_code: "COVERAGE_PUBLISH_SNAPSHOT_STALE",
          reason: `Build ${lastBuild.id} carries a coverage snapshot (${lastBuild.coverage_snapshot.snapshot_hash.slice(0, 12)}) that no longer matches current assessment, facts, or sources.`,
          next_action: "Re-run the build preview to refresh the publish snapshot.",
        });
        report.invalidated = true;
      }
    }
  }

  const gate = validateWorkflow(state, "publish");
  if (!gate.ok) {
    const codes = [...new Set(gate.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code))];
    report.items.push({
      target_kind: "publish_readiness",
      target_id: state.project_id,
      reason_code: "PUBLISH_READINESS_BLOCKED",
      reason: `Publish readiness is blocked: ${codes.join(", ") || "publish gate diagnostics"}.`,
      next_action: "Resolve the publish gate diagnostics before publishing.",
    });
    report.publish_readiness_affected = true;
    report.invalidated = true;
  }
  return report;
}
