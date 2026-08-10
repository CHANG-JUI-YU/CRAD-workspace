import { parseWardrobeMarkdown, type ArtifactRecord, type FactReviewDecisionRecord, type IssueSeverity, type ProjectState } from "@st-workspace/core";
import { buildRequiredArtifactManifest, type RequiredArtifactManifest } from "./required-artifacts.js";

export type WorkflowGatePhase = "draft" | "publish";

export interface WorkflowDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning";
  artifact_ids?: string[];
  fact_ids?: string[];
  source_ids?: string[];
}

export interface WorkflowGateResult {
  ok: boolean;
  diagnostics: WorkflowDiagnostic[];
}

const contentKinds = new Set<ArtifactRecord["kind"]>([
  "character", "relationship", "world_lore", "greeting", "zhuji", "palette", "wardrobe", "plugin",
]);

function parseJson(content: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function latestArtifacts(state: ProjectState): ArtifactRecord[] {
  const latest = new Map<string, ArtifactRecord>();
  for (const artifact of state.artifacts) latest.set(artifact.key, artifact);
  return [...latest.values()];
}

function managedProject(state: ProjectState): boolean {
  return state.project_status !== "uninitialized"
    || state.interview.status !== "idle"
    || state.blueprint_prechecks.length > 0;
}

function severityRank(value: IssueSeverity): number {
  return { info: 0, warning: 1, error: 2, critical: 3 }[value];
}

function blockingRank(value: IssueSeverity | "none"): number {
  return value === "none" ? Number.POSITIVE_INFINITY : severityRank(value);
}

function add(diagnostics: WorkflowDiagnostic[], diagnostic: WorkflowDiagnostic): void {
  diagnostics.push(diagnostic);
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function userProvidedEvidence(value: string): boolean {
  return /(?:^|[\s:])(?:user|manual|creator|provided)(?:$|[\s:])/iu.test(value);
}

function candidateLooksOfficial(value: Record<string, unknown>): boolean {
  if (value.official === true) return true;
  return /official|公式|官方/iu.test([value.title, value.snippet, value.domain, value.url].filter((item): item is string => typeof item === "string").join(" "));
}

function candidateHostname(value: Record<string, unknown>): string | undefined {
  if (typeof value.domain === "string" && value.domain.trim().length > 0) return value.domain.trim().toLocaleLowerCase();
  if (typeof value.url !== "string") return undefined;
  try { return new URL(value.url).hostname.toLocaleLowerCase(); } catch { return undefined; }
}

function allowedDomain(hostname: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0 || hostname === undefined) return true;
  return allowed.some((value) => {
    const domain = value.replace(/^https?:\/\//u, "").replace(/\/.*$/u, "").toLocaleLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

function reportSourceResearch(state: ProjectState, artifacts: ArtifactRecord[], diagnostics: WorkflowDiagnostic[]): void {
  for (const artifact of artifacts.filter((item) => item.kind === "source_research")) {
    const parsed = parseJson(artifact.content);
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates.map(record).filter((item): item is Record<string, unknown> => item !== undefined) : [];
    if (candidates.length === 0) continue;
    const allowed = strings(parsed?.allowed_domains).map((item) => item.toLocaleLowerCase());
    const sourceCandidateIds = new Set(state.sources.map((source) => source.candidate_id));
    const unresolved = candidates.filter((candidate) => {
      const match = state.candidates.find((item) => (typeof candidate.url === "string" && item.url === candidate.url) || (typeof candidate.title === "string" && item.title === candidate.title));
      return match === undefined || !sourceCandidateIds.has(match.id);
    });
    if (unresolved.length > 0) {
      add(diagnostics, {
        code: "SOURCE_RESEARCH_NOT_INGESTED",
        message: `${unresolved.length} source-research candidate(s) are not ingested yet.`,
        severity: "error",
        artifact_ids: [artifact.id],
      });
    }
    const official = candidates.filter(candidateLooksOfficial);
    const officialIngested = official.some((candidate) => {
      const match = state.candidates.find((item) => (typeof candidate.url === "string" && item.url === candidate.url) || (typeof candidate.title === "string" && item.title === candidate.title));
      return match !== undefined && sourceCandidateIds.has(match.id);
    });
    if (official.length > 0 && !officialIngested) {
      add(diagnostics, { code: "SOURCE_RESEARCH_OFFICIAL_REQUIRED", message: "At least one official source-research candidate must be ingested before publishing.", severity: "error", artifact_ids: [artifact.id] });
    }
    const outOfPolicy = candidates.filter((candidate) => !allowedDomain(candidateHostname(candidate), allowed));
    if (outOfPolicy.length > 0) {
      add(diagnostics, { code: "SOURCE_DOMAIN_NOT_ALLOWED", message: `${outOfPolicy.length} source-research candidate(s) are outside the allowed domain policy.`, severity: "error", artifact_ids: [artifact.id] });
    }
  }
}

function referenceSet(artifacts: ArtifactRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const artifact of artifacts.filter((item) => item.kind === "character")) {
    ids.add(normalized(artifact.name));
    ids.add(normalized(artifact.key.split(":").slice(1).join(":")));
    const parsed = parseJson(artifact.content);
    const document = record(parsed?.document);
    for (const value of [document?.id, document?.display_name, ...(Array.isArray(document?.aliases) ? document.aliases : [])]) {
      if (typeof value === "string" && value.trim().length > 0) ids.add(normalized(value));
    }
  }
  return ids;
}

function inScopeArtifacts(artifacts: ArtifactRecord[], manifest: RequiredArtifactManifest | undefined): ArtifactRecord[] {
  if (manifest === undefined) return artifacts;
  const scoped = new Set(manifest.in_scope_artifact_ids);
  return artifacts.filter((artifact) => scoped.has(artifact.id));
}

function reportMissingReferences(state: ProjectState, artifacts: ArtifactRecord[], diagnostics: WorkflowDiagnostic[], manifest?: RequiredArtifactManifest): void {
  artifacts = inScopeArtifacts(artifacts, manifest);
  const characters = referenceSet(artifacts);
  const worldIds = new Set<string>();
  for (const artifact of artifacts.filter((item) => item.kind === "world_lore")) {
    const parsed = parseJson(artifact.content);
    for (const entry of Array.isArray(parsed?.entries) ? parsed.entries : []) {
      const item = record(entry);
      if (typeof item?.id === "string") worldIds.add(normalized(item.id));
    }
  }
  const factIds = new Set(state.facts.map((fact) => normalized(fact.id)));
  const missing: Array<{ artifact: ArtifactRecord; refs: string[] }> = [];
  for (const artifact of artifacts) {
    const parsed = parseJson(artifact.content);
    const refs: string[] = [];
    if (artifact.kind === "character") {
      const document = record(parsed?.document);
      for (const relationship of Array.isArray(document?.relationships) ? document.relationships : []) {
        const item = record(relationship);
        if (typeof item?.target_id === "string" && !characters.has(normalized(item.target_id))) refs.push(item.target_id);
      }
    } else if (artifact.kind === "relationship") {
      const document = record(parsed?.document);
      for (const id of strings(document?.character_ids)) if (!characters.has(normalized(id))) refs.push(id);
      for (const summary of Array.isArray(document?.character_summaries) ? document.character_summaries : []) {
        const item = record(summary);
        if (typeof item?.character_id === "string" && !characters.has(normalized(item.character_id))) refs.push(item.character_id);
      }
      for (const perspective of Array.isArray(document?.perspectives) ? document.perspectives : []) {
        const item = record(perspective);
        for (const id of [item?.source_character_id, item?.target_character_id]) {
          if (typeof id === "string" && !characters.has(normalized(id))) refs.push(id);
        }
      }
      for (const group of Array.isArray(document?.groups) ? document.groups : []) {
        const item = record(group);
        for (const id of strings(item?.member_ids)) if (!characters.has(normalized(id))) refs.push(id);
      }
    } else if (artifact.kind === "greeting") {
      const document = record(parsed?.document);
      for (const greeting of Array.isArray(document?.greetings) ? document.greetings : []) {
        const item = record(greeting);
        for (const id of strings(item?.character_ids)) if (!characters.has(normalized(id))) refs.push(id);
      }
    } else if (artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe" || artifact.kind === "conversion") {
      const id = typeof parsed?.character_id === "string" ? parsed.character_id : undefined;
      const fallbackId = artifact.kind === "wardrobe" ? artifact.name.split("/")[0]?.trim() : undefined;
      const characterId = id ?? (fallbackId !== undefined && fallbackId.length > 0 ? fallbackId : undefined);
      if (characterId !== undefined && !characters.has(normalized(characterId))) refs.push(characterId);
    } else if (artifact.kind === "world_lore") {
      for (const entry of Array.isArray(parsed?.entries) ? parsed.entries : []) {
        const item = record(entry);
        for (const id of strings(item?.related_ids)) if (!worldIds.has(normalized(id))) refs.push(id);
        for (const id of strings(item?.fact_refs)) if (!factIds.has(normalized(id))) refs.push(id);
      }
    }
    if (refs.length > 0) missing.push({ artifact, refs: [...new Set(refs)] });
  }
  for (const item of missing) {
    add(diagnostics, {
      code: "ARTIFACT_REFERENCE_MISSING",
      message: `${item.artifact.name} refers to missing project objects: ${item.refs.join(", ")}.`,
      severity: "error",
      artifact_ids: [item.artifact.id],
    });
  }
}

function reportReviews(state: ProjectState, artifacts: ArtifactRecord[], diagnostics: WorkflowDiagnostic[], manifest?: RequiredArtifactManifest): void {
  const reviewable = inScopeArtifacts(artifacts, manifest).filter((artifact) => contentKinds.has(artifact.kind));
  for (const artifact of reviewable) {
    const reviewed = state.reviews.some((review) => review.artifact_id === artifact.id && review.artifact_revision === artifact.revision);
    if (!reviewed) {
      add(diagnostics, {
        code: "ARTIFACT_REVIEW_REQUIRED",
        message: `${artifact.name} must have a completed review for revision ${artifact.revision.slice(0, 12)} before publishing.`,
        severity: "error",
        artifact_ids: [artifact.id],
      });
    }
  }
}

function currentEffectiveSeverity(state: ProjectState, issue: ProjectState["issues"][number]): IssueSeverity {
  const baseline = state.quality_profile.overrides[issue.code] ?? state.quality_profile.overrides[issue.id] ?? issue.severity;
  const override = issue.override;
  if (override === undefined || severityRank(baseline) > severityRank(override.against_effective_severity)) return baseline;
  const target = override.severity ?? issue.effective_severity;
  return severityRank(target) < severityRank(baseline) ? target : baseline;
}

function reportBlockingIssues(state: ProjectState, content: ArtifactRecord[], diagnostics: WorkflowDiagnostic[], manifest?: RequiredArtifactManifest): void {
  const artifactIds = new Set(inScopeArtifacts(content, manifest).map((artifact) => artifact.id));
  const blockingIssues = state.issues.filter((issue) => issue.status === "open" && artifactIds.has(issue.artifact_id) && severityRank(currentEffectiveSeverity(state, issue)) >= blockingRank(state.quality_profile.blocking_severity));
  if (blockingIssues.length > 0) {
    add(diagnostics, {
      code: "PUBLISH_BLOCKING_ISSUES",
      message: `${blockingIssues.length} blocking review issue(s) remain open.`,
      severity: "error",
      artifact_ids: [...new Set(blockingIssues.map((issue) => issue.artifact_id))],
    });
  }
}

function reportWardrobe(artifacts: ArtifactRecord[], diagnostics: WorkflowDiagnostic[], manifest?: RequiredArtifactManifest): void {
  for (const artifact of inScopeArtifacts(artifacts, manifest).filter((item) => item.kind === "wardrobe")) {
    const parsed = parseWardrobeMarkdown(artifact.content);
    for (const error of parsed.errors) {
      add(diagnostics, {
        code: error.code,
        message: `${artifact.name}: ${error.message}`,
        severity: "error",
        artifact_ids: [artifact.id],
      });
    }
  }
}

function reportFacts(state: ProjectState, diagnostics: WorkflowDiagnostic[]): void {
  const accepted = state.facts.filter((fact) => fact.status === "accepted");
  const sourceIds = new Set(state.sources.map((source) => source.id));
  const sourceById = new Map(state.sources.map((source) => [source.id, source]));
  const chunkById = new Map(state.knowledge_chunks.map((chunk) => [chunk.id, chunk]));
  const missingSources = accepted.filter((fact) => fact.source_ids.some((id) => !sourceIds.has(id)));
  if (missingSources.length > 0) {
    add(diagnostics, {
      code: "FACT_SOURCE_MISSING",
      message: `${missingSources.length} accepted fact(s) refer to sources that are not in the project.`,
      severity: "error",
      fact_ids: missingSources.map((fact) => fact.id),
      source_ids: [...new Set(missingSources.flatMap((fact) => fact.source_ids.filter((id) => !sourceIds.has(id))))],
    });
  }
  const unproven = accepted.filter((fact) => {
    if (fact.source_ids.length === 0 && !fact.evidence.some(userProvidedEvidence)) return true;
    const references = fact.evidence_refs ?? [];
    if (references.length === 0) return true;
    return references.some((reference) => {
      const source = sourceById.get(reference.source_id);
      const chunk = reference.chunk_id === undefined ? undefined : chunkById.get(reference.chunk_id);
      return source === undefined
        || source.revision !== reference.source_revision_id
        || reference.quote.trim().length === 0
        || !source.canonical_text.includes(reference.quote)
        || (chunk !== undefined && (chunk.source_id !== source.id || (reference.chunk_hash !== undefined && chunk.hash !== reference.chunk_hash) || !chunk.text.includes(reference.quote)))
        || (reference.chunk_id !== undefined && chunk === undefined);
    });
  });
  if (unproven.length > 0) {
    add(diagnostics, {
      code: "FACT_PROVENANCE_MISSING",
      message: `${unproven.length} accepted fact(s) have no current, quote-level source evidence.`,
      severity: "error",
      fact_ids: unproven.map((fact) => fact.id),
    });
  }
  const requiresStrictReview = state.interview.flow === "source_adaptation"
    || state.fact_review_runs.length > 0
    || state.facts.some((fact) => fact.source_ids.length > 0);
  if (!requiresStrictReview) return;
  if (state.facts.length === 0) {
    add(diagnostics, { code: "FACT_REVIEW_RUN_MISSING", message: "Source-adaptation facts have not been curated for review.", severity: "error" });
    return;
  }

  const run = [...state.fact_review_runs].reverse().find((candidate) => candidate.status !== "superseded");
  if (run === undefined) {
    add(diagnostics, {
      code: "FACT_REVIEW_RUN_MISSING",
      message: "Fact candidates require a completed strict Review Run before publishing; legacy review_pass records do not satisfy this gate.",
      severity: "error",
      fact_ids: state.facts.map((fact) => fact.id),
    });
    return;
  }

  const latest = new Map<string, FactReviewDecisionRecord>();
  for (const decision of state.fact_review_decisions) {
    if (decision.review_run_id === run.id) latest.set(decision.candidate_occurrence_id, decision);
  }
  const occurrenceFor = (fact: ProjectState["facts"][number]): string => fact.candidate_occurrence_id ?? fact.id;
  const missing = run.candidate_occurrence_ids.filter((occurrenceId) => {
    const decision = latest.get(occurrenceId);
    return decision === undefined || (decision.decision !== "accepted" && decision.decision !== "rejected");
  });
  if (missing.length > 0) {
    add(diagnostics, {
      code: "FACT_REVIEW_COVERAGE_INCOMPLETE",
      message: `The current Review Run has unresolved candidate occurrences: ${missing.join(", ")}.`,
      severity: "error",
      fact_ids: state.facts.filter((fact) => missing.includes(occurrenceFor(fact))).map((fact) => fact.id),
    });
  }
  const blocked = [...latest.values()].filter((decision) => decision.decision === "needs_evidence" || decision.decision === "conflict");
  if (blocked.length > 0 || run.status !== "completed") {
    const needsEvidence = blocked.filter((decision) => decision.decision === "needs_evidence");
    const conflicts = blocked.filter((decision) => decision.decision === "conflict");
    if (needsEvidence.length > 0) {
      add(diagnostics, {
        code: "FACT_REVIEW_NEEDS_EVIDENCE",
        message: `Fact review is waiting for evidence for ${needsEvidence.length} candidate(s).`,
        severity: "error",
        fact_ids: needsEvidence.flatMap((decision) => decision.fact_id === undefined ? [] : [decision.fact_id]),
      });
    }
    if (conflicts.length > 0) {
      add(diagnostics, {
        code: "FACT_REVIEW_CONFLICT",
        message: `Fact review has ${conflicts.length} unresolved conflict(s); Director resolution is required.`,
        severity: "error",
        fact_ids: conflicts.flatMap((decision) => decision.fact_id === undefined ? [] : [decision.fact_id]),
      });
    }
    if (run.status !== "completed" && blocked.length === 0) {
      add(diagnostics, {
        code: "FACT_REVIEW_RUN_INCOMPLETE",
        message: `The current Review Run is ${run.status} and is not publishable.`,
        severity: "error",
        fact_ids: state.facts.map((fact) => fact.id),
      });
    }
  }

  const referencedRunIds = new Set(accepted.map((fact) => fact.review_run_id).filter((value): value is string => value !== undefined));
  const runsToCheck = [
    run,
    ...state.fact_review_runs.filter((candidate) => referencedRunIds.has(candidate.id) && candidate.id !== run.id),
  ];
  const staleSources = runsToCheck.flatMap((candidateRun) => candidateRun.source_revisions.filter((expected) => sourceById.get(expected.source_id)?.revision !== expected.revision));
  if (staleSources.length > 0) {
    add(diagnostics, {
      code: "FACT_REVIEW_SOURCE_STALE",
      message: `Source revisions changed after the Review Run: ${staleSources.map((item) => item.source_id).join(", ")}. Re-curate and review again.`,
      severity: "error",
      source_ids: [...new Set(staleSources.map((item) => item.source_id))],
    });
  }

  const acceptedOutsideRun = accepted.filter((fact) => {
    if (fact.review_run_id === run.id) return latest.get(occurrenceFor(fact))?.decision !== "accepted";
    if (fact.review_run_id === undefined) return true;
    const owningRun = state.fact_review_runs.find((candidate) => candidate.id === fact.review_run_id && candidate.status === "completed");
    if (owningRun === undefined) return true;
    return [...state.fact_review_decisions].reverse().find((decision) => decision.review_run_id === owningRun.id && decision.candidate_occurrence_id === occurrenceFor(fact))?.decision !== "accepted";
  });
  if (acceptedOutsideRun.length > 0) {
    add(diagnostics, {
      code: "FACT_REVIEW_DECISION_MISSING",
      message: `${acceptedOutsideRun.length} accepted fact(s) are not backed by an accepted decision in the current Review Run.`,
      severity: "error",
      fact_ids: acceptedOutsideRun.map((fact) => fact.id),
    });
  }

  // Coverage is only a source-adaptation obligation.  Original-character
  // projects may intentionally have no source-derived coverage register.
  if (state.interview.flow === "source_adaptation") {
    const blueprint = [...latestArtifacts(state)].reverse().find((artifact) => artifact.kind === "blueprint");
    const parsedBlueprint = blueprint === undefined ? undefined : parseJson(blueprint.content);
    const subjects = Array.isArray(parsedBlueprint?.characters)
      ? parsedBlueprint.characters.map(record).flatMap((item) => {
        if (item === undefined || typeof item.id !== "string") return [];
        return [{ id: item.id, label: typeof item.label === "string" ? item.label : item.id }];
      })
      : [];
    if (subjects.length > 0) {
      const acceptedFacts = accepted;
      const requiredPrimary = ["identity", "personality", "speech", "habits", "background", "relationships"];
      const optionalPrimary = ["appearance", "goals", "abilities", "world_context"];
      const requiredSupporting = ["identity", "personality", "relationships"];
      const missingCoverage: string[] = [];
      subjects.forEach((subject, index) => {
        const subjectFacts = acceptedFacts.filter((fact) => {
          const factSubject = fact.subject ?? fact.statement;
          return normalized(factSubject) === normalized(subject.id) || normalized(factSubject) === normalized(subject.label);
        });
        const covered = new Set(subjectFacts.flatMap((fact) => (fact.coverage ?? []).map(normalized)));
        const required = index === 0 ? requiredPrimary : requiredSupporting;
        for (const dimension of required) if (!covered.has(normalized(dimension))) missingCoverage.push(`${subject.id}/${dimension}`);
        if (index === 0 && !optionalPrimary.some((dimension) => covered.has(normalized(dimension)))) missingCoverage.push(`${subject.id}/one-of-${optionalPrimary.join("|")}`);
      });
      if (missingCoverage.length > 0) {
        add(diagnostics, {
          code: "FACT_COVERAGE_INCOMPLETE",
          message: `Source-derived fact coverage is incomplete: ${missingCoverage.join(", ")}.`,
          severity: "error",
          fact_ids: accepted.map((fact) => fact.id),
        });
      }
    }
  }
}

function reportDerivedLinks(state: ProjectState, artifacts: ArtifactRecord[], diagnostics: WorkflowDiagnostic[]): void {
  const characters = referenceSet(artifacts);
  const mvuPaths = new Set<string>();
  for (const artifact of artifacts.filter((item) => item.kind === "plugin")) {
    const parsed = parseJson(artifact.content);
    if (parsed?.plugin_id === "official.mvu-zod") {
      const source = record(parsed.source);
      for (const variable of Array.isArray(source?.variables) ? source.variables : []) {
        const item = record(variable);
        if (typeof item?.id === "string") mvuPaths.add(`/${item.id}`);
      }
    }
  }
  for (const artifact of artifacts) {
    const parsed = parseJson(artifact.content);
    if (artifact.kind === "conversion") {
      const characterId = typeof parsed?.character_id === "string" ? parsed.character_id : undefined;
      if (characterId !== undefined && !characters.has(normalized(characterId))) {
        add(diagnostics, { code: "CONVERSION_TARGET_MISSING", message: `Conversion ${artifact.name} refers to missing character ${characterId}.`, severity: "error", artifact_ids: [artifact.id] });
      }
      const targetKind = parsed?.target_mode === "zhuji" ? "zhuji" : parsed?.target_mode === "palette" ? "palette" : undefined;
      if (targetKind !== undefined && characterId !== undefined && !artifacts.some((candidate) => candidate.kind === targetKind && normalized(candidate.name).startsWith(`${normalized(characterId)}/`))) {
        add(diagnostics, { code: "CONVERSION_TARGET_MISSING", message: `Conversion ${artifact.name} has no ${targetKind} target module for ${characterId}.`, severity: "error", artifact_ids: [artifact.id] });
      }
    }
    if (artifact.kind === "import_analysis" && state.imports.length === 0 && !artifacts.some((candidate) => candidate.kind === "character" && candidate.operation_id === artifact.operation_id)) {
      add(diagnostics, { code: "IMPORT_ANALYSIS_LINK_MISSING", message: `Import analysis ${artifact.name} has no corresponding imported artifact.`, severity: "error", artifact_ids: [artifact.id] });
    }
    if (artifact.kind === "plugin" && parsed?.plugin_id === "official.html" && mvuPaths.size > 0) {
      const source = record(parsed.source);
      const invalid = (Array.isArray(source?.components) ? source.components : []).flatMap((component) => strings(record(component)?.binding_paths)).filter((path) => !mvuPaths.has(path));
      if (invalid.length > 0) add(diagnostics, { code: "PLUGIN_BINDING_MISSING", message: `HTML plugin ${artifact.name} refers to missing MVU paths: ${[...new Set(invalid)].join(", ")}.`, severity: "error", artifact_ids: [artifact.id] });
    }
  }
}

export function validateWorkflow(state: ProjectState, phase: WorkflowGatePhase): WorkflowGateResult {
  const diagnostics: WorkflowDiagnostic[] = [];
  const managed = managedProject(state);
  if (managed) {
    const pendingPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (pendingPrecheck !== undefined) {
      add(diagnostics, {
        code: "BLUEPRINT_PRECHECK_REQUIRED",
        message: "The blueprint precheck still needs a short user confirmation before authoring or publishing can continue.",
        severity: "error",
      });
    }
  }
  if (phase === "draft") return { ok: diagnostics.length === 0, diagnostics };
  const artifacts = latestArtifacts(state);
  const content = artifacts.filter((artifact) => contentKinds.has(artifact.kind));
  const manifest = buildRequiredArtifactManifest(state);
  if (managed) {
    if (state.project_status === "interviewing" || state.interview.status === "active") {
      add(diagnostics, { code: "INTERVIEW_REQUIRED", message: "The project interview must be complete before publishing.", severity: "error" });
    }
    if (content.length === 0) add(diagnostics, { code: "PUBLISH_NO_CONTENT", message: "Publish requires at least one character, world, greeting, relationship, module, or plugin artifact.", severity: "error" });
    if (manifest === undefined && state.interview.flow === "world" && !artifacts.some((artifact) => artifact.kind === "world_lore")) {
      add(diagnostics, { code: "REQUIRED_WORLD_ARTIFACT_MISSING", message: "The world interview path requires at least one world-lore artifact before publishing.", severity: "error" });
    }
    if (manifest !== undefined) {
      for (const item of manifest.diagnostics) {
        if (item.severity !== "error") continue;
        add(diagnostics, { code: item.code, message: item.message, severity: item.severity });
      }
    }
    reportReviews(state, artifacts, diagnostics, manifest);
  }
  reportWardrobe(artifacts, diagnostics, manifest);
  reportSourceResearch(state, artifacts, diagnostics);
  reportMissingReferences(state, artifacts, diagnostics, manifest);
  reportFacts(state, diagnostics);
  reportDerivedLinks(state, artifacts, diagnostics);
  reportBlockingIssues(state, content, diagnostics, manifest);
  return { ok: diagnostics.length === 0, diagnostics };
}
