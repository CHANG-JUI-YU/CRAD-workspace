import {
  canonicalJson,
  contentHash,
  CoreError,
  computeProjectProjection,
  createEntityMatcher,
  coverageRequirementIdForDimension,
  isCoverageRequirementId,
  isFactCoverageDimension,
  type FactClassification,
  type FactClaim,
  type FactDecision,
  type FactEvidenceReference,
  type FactRecord,
  type KnowledgeChunk,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";

export const FACT_REVIEW_POLICY_REVISION = contentHash("fact-review-strict-v1");

export function suggestedTargetsForCoverage(coverage: readonly string[] | undefined): string[] {
  const targets: string[] = [];
  for (const dimension of coverage ?? []) {
    const id = coverageRequirementIdForDimension(dimension);
    if (id !== undefined && !targets.includes(id)) targets.push(id);
  }
  return targets;
}

export function assertCoverageTargetsValid(targets: readonly string[] | undefined, field: string): void {
  if (targets === undefined) return;
  for (const target of targets) {
    if (!isCoverageRequirementId(target)) {
      throw new CoreError("COVERAGE_TARGET_INVALID", `${field} contains unknown coverage requirement id "${target}".`, true);
    }
  }
}

export function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function coverageForClassification(classification: FactClassification): string[] {
  switch (classification) {
    case "identity": return ["identity"];
    case "trait": return ["personality"];
    case "relationship": return ["relationships"];
    case "event": return ["background"];
    case "world": return ["world_context"];
    default: return [];
  }
}

function likelyUrl(value: string): boolean {
  return /^(?:https?:\/\/|ftp:\/\/|www\.)/iu.test(value.trim());
}

function looksLikeMarkupOrCode(value: string): boolean {
  return /<\s*\/?\s*(?:html|head|body|script|style|nav|footer|template|div|span|table|thead|tbody|tr|th|td)\b/iu.test(value)
    || /(?:^|[\n{}])\s*(?:html|body|\.\w+|#\w+)\s*\{[\s\S]*\}/u.test(value)
    || /\b(?:function|const|let|var)\s+[A-Za-z_$][\w$]*\s*[=(]/u.test(value);
}

export interface FactQualityOptions {
  matcher?: ReturnType<typeof createEntityMatcher>;
  strictEntity?: boolean;
  strictCoverage?: boolean;
  strictQuality?: boolean;
}

/** Predicates which do not by themselves identify a contested attribute. */
export const GENERIC_PREDICATES = new Set([
  "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "是", "為", "是", "有",
]);

export function inferClassification(predicate: string): FactClassification {
  const normalized = predicate.toLocaleLowerCase();
  if (/name|identity|姓名|名字/u.test(normalized)) return "identity";
  if (/trait|personality|性格|特質|特征|喜歡|厭惡|has/u.test(normalized)) return "trait";
  if (/relationship|friend|enemy|關係|关系|belongs/u.test(normalized)) return "relationship";
  if (/event|born|died|happened|comes from|出生|死亡|事件/u.test(normalized)) return "event";
  if (/world|location|place|located|lives in|世界|地點|地点|位於|位于/u.test(normalized)) return "world";
  return "other";
}

export function structureSentence(sourceTitle: string, statement: string): Pick<FactRecord, "subject" | "predicate" | "value" | "classification"> {
  const english = statement.match(/^(.{1,120}?)\s+(is|are|has|have|likes|comes from|belongs to|born|died|located in|lives in)\s+(.+)$/iu);
  const chinese = statement.match(/^(.{1,120}?)(是|為|为|有|喜歡|喜欢|來自|来自|出生於|出生于|位於|位于)(.+)$/u);
  const match = english ?? chinese;
  if (match !== null) {
    const subject = match[1]?.trim() || sourceTitle;
    const verb = match[2]?.trim() || "described_by";
    const value = match[3]?.trim() || statement;
    const predicate = ["is", "是", "為", "为"].includes(verb.toLocaleLowerCase()) ? "has_property" : verb.toLocaleLowerCase();
    return { subject, predicate, value, classification: inferClassification(predicate) };
  }
  return { subject: sourceTitle, predicate: "described_by", value: statement, classification: "other" };
}

export function evidenceText(evidence: { source: string; quote?: string | undefined; locator?: string | undefined }): string {
  return [evidence.source, evidence.quote, evidence.locator].filter((item): item is string => item !== undefined && item.trim().length > 0).join(" — ");
}

export function sourceMatches(source: SourceRecord, reference: string): boolean {
  const value = reference.trim().toLocaleLowerCase();
  return [source.id, source.candidate_id, source.title, source.original_name]
    .filter((item): item is string => item !== undefined)
    .some((item) => item.toLocaleLowerCase() === value);
}

export function factCandidateRevision(fact: FactRecord, sources: readonly SourceRecord[]): string {
  return contentHash(canonicalJson({
    candidate_occurrence_id: fact.candidate_occurrence_id ?? fact.id,
    statement: fact.statement,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    classification: fact.classification,
    entity_refs: fact.entity_refs,
    coverage: fact.coverage,
    source_ids: fact.source_ids,
    source_revisions: sources.filter((source) => fact.source_ids.includes(source.id)).map((source) => ({ id: source.id, revision: source.revision })),
    evidence: fact.evidence,
    evidence_refs: fact.evidence_refs,
    evidence_revision: fact.evidence_revision,
  }));
}

export function evidenceRevision(fact: Pick<FactRecord, "source_ids" | "evidence_refs" | "evidence">, sources: readonly SourceRecord[]): string {
  return contentHash(canonicalJson({
    source_revisions: sources.filter((source) => fact.source_ids.includes(source.id)).map((source) => ({ id: source.id, revision: source.revision })).sort((a, b) => a.id.localeCompare(b.id)),
    evidence_refs: fact.evidence_refs ?? [],
    evidence: fact.evidence,
  }));
}

export function acceptedFactRevision(fact: FactRecord): string {
  return contentHash(canonicalJson({
    statement: fact.statement,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    classification: fact.classification,
    entity_refs: fact.entity_refs,
    coverage: fact.coverage,
    evidence_revision: fact.evidence_revision,
    fact_revision: fact.fact_revision,
  }));
}

export function contradictingAcceptedFacts(facts: readonly FactRecord[]): Array<{ left: FactRecord; right: FactRecord }> {
  const accepted = facts.filter((fact) => fact.status === "accepted" && fact.subject !== undefined && fact.predicate !== undefined && fact.value !== undefined);
  const pairs: Array<{ left: FactRecord; right: FactRecord }> = [];
  for (let i = 0; i < accepted.length; i += 1) {
    for (let j = i + 1; j < accepted.length; j += 1) {
      const left = accepted[i]!;
      const right = accepted[j]!;
      const predicate = normalize(left.predicate!);
      if (GENERIC_PREDICATES.has(predicate)) continue;
      if (normalize(left.subject!) === normalize(right.subject!) && predicate === normalize(right.predicate!) && normalize(left.value!) !== normalize(right.value!)) pairs.push({ left, right });
    }
  }
  return pairs;
}

export function assertStrictFactQuality(fact: FactRecord, options: FactQualityOptions = {}): void {
  const strictQuality = options.strictQuality === true || options.strictEntity === true || options.strictCoverage === true;
  if (fact.subject === undefined || fact.predicate === undefined || fact.value === undefined || fact.classification === undefined) {
    throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Accepted fact ${fact.id} must have subject, predicate, value and classification.`, true);
  }
  if ((fact.coverage ?? []).length === 0) throw new CoreError("FACT_REVIEW_COVERAGE_MISSING", `Accepted fact ${fact.id} must declare at least one coverage dimension.`, true);
  if (strictQuality && likelyUrl(fact.subject)) throw new CoreError("FACT_REVIEW_SUBJECT_INVALID", `Fact ${fact.id} cannot use a URL as its subject.`, true);
  if (strictQuality && (looksLikeMarkupOrCode(fact.statement) || looksLikeMarkupOrCode(fact.value))) throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Fact ${fact.id} contains HTML, CSS, JavaScript or template text.`, true);
  if (/(?:placeholder|dummy|fixture|lorem ipsum|test fact)/iu.test(fact.statement)) throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Accepted fact ${fact.id} contains placeholder or test content.`, true);
  if (strictQuality && ["described_by", "describedby", "fallback"].includes(normalize(fact.predicate))) {
    throw new CoreError("FACT_REVIEW_PREDICATE_INVALID", `Fact ${fact.id} uses a fallback predicate and cannot be accepted.`, true);
  }
  if (options.strictCoverage) {
    const coverage = fact.coverage ?? [];
    if (coverage.some((dimension) => !isFactCoverageDimension(dimension))) {
      throw new CoreError("FACT_REVIEW_COVERAGE_INVALID", `Fact ${fact.id} contains an unknown or legacy coverage value.`, true);
    }
    const required = coverageForClassification(fact.classification)[0];
    if (required !== undefined && !coverage.includes(required)) {
      throw new CoreError("FACT_REVIEW_COVERAGE_MISMATCH", `Fact ${fact.id} classification ${fact.classification} requires coverage ${required}.`, true);
    }
    if (fact.classification === "other") {
      throw new CoreError("FACT_REVIEW_CLASSIFICATION_INVALID", `Fact ${fact.id} must use a typed classification before acceptance.`, true);
    }
    if (options.matcher !== undefined && coverage.some((dimension) => options.matcher!.candidates(dimension).length > 0)) {
      throw new CoreError("FACT_REVIEW_COVERAGE_ENTITY_INVALID", `Fact ${fact.id} places a character name in coverage; use entity_refs instead.`, true);
    }
  }
  if (options.strictEntity && options.matcher !== undefined) {
    const refs = fact.entity_refs ?? [];
    for (const ref of refs) {
      const matches = options.matcher.candidates(ref);
      if (matches.length !== 1 || matches[0]?.id !== ref) {
        throw new CoreError("FACT_REVIEW_ENTITY_INVALID", `Fact ${fact.id} refers to an unknown Blueprint entity ${ref}.`, true);
      }
    }
    if (fact.classification !== "world" && refs.length === 0) {
      throw new CoreError("FACT_REVIEW_ENTITY_REQUIRED", `Fact ${fact.id} must reference at least one Blueprint character.`, true);
    }
    if (fact.classification === "world" && refs.length === 0 && !(fact.coverage ?? []).includes("world_context")) {
      throw new CoreError("FACT_REVIEW_WORLD_COVERAGE_REQUIRED", `World fact ${fact.id} must use world_context coverage.`, true);
    }
  }
}

function resolveEntityRef(raw: string, matcher: ReturnType<typeof createEntityMatcher>, field: string): string {
  const matches = matcher.candidates(raw);
  if (matches.length === 0) throw new CoreError("FACT_CURATION_ENTITY_UNKNOWN", `Cannot resolve ${field} '${raw}' against the Blueprint roster.`, true);
  if (matches.length > 1) throw new CoreError("FACT_CURATION_ENTITY_AMBIGUOUS", `The ${field} '${raw}' matches more than one Blueprint entity.`, true);
  return matches[0]!.id;
}

export function normalizeFactEntityRefs(
  state: ProjectState,
  rawRefs: readonly string[],
  subject: string | undefined,
  classification: FactClassification | undefined,
): string[] {
  const matcher = createEntityMatcher(state);
  const strictEntity = state.interview.flow === "source_adaptation" || computeProjectProjection(state).intent.is_source_adaptation || matcher.entities.length > 0;
  const refs = [...new Set(rawRefs.map((ref) => resolveEntityRef(ref, matcher, "entity_refs")))];
  if (strictEntity && refs.length === 0 && classification !== "world") {
    if (subject === undefined) throw new CoreError("FACT_CURATION_ENTITY_REQUIRED", "A character fact must include a resolvable subject or entity_refs.", true);
    refs.push(resolveEntityRef(subject, matcher, "subject"));
  }
  return refs;
}

/** Validate and canonicalize a typed curation claim before any state mutation. */
export function normalizeFactClaim(claim: FactClaim, state: ProjectState): FactClaim {
  const matcher = createEntityMatcher(state);
  const strictEntity = matcher.entities.length > 0;
  const sourceAdaptation = state.interview.flow === "source_adaptation" || computeProjectProjection(state).intent.is_source_adaptation || strictEntity;
  const coverage = [...new Set(claim.coverage ?? [])];
  const entityRefs = normalizeFactEntityRefs(state, claim.entity_refs ?? [], claim.subject, claim.classification);
  if (sourceAdaptation) {
    if (claim.classification === "other") throw new CoreError("FACT_CURATION_CLASSIFICATION_INVALID", "Source-adaptation curation requires a typed classification.", true);
    const required = coverageForClassification(claim.classification)[0];
    if (required !== undefined && !coverage.includes(required)) throw new CoreError("FACT_CURATION_COVERAGE_MISMATCH", `Classification ${claim.classification} requires coverage ${required}.`, true);
    if (coverage.some((dimension) => !isFactCoverageDimension(dimension))) throw new CoreError("FACT_CURATION_COVERAGE_INVALID", "Source-adaptation curation accepts only canonical coverage dimensions.", true);
    if (coverage.some((dimension) => matcher.candidates(dimension).length > 0)) throw new CoreError("FACT_CURATION_COVERAGE_ENTITY_INVALID", "Character names belong in entity_refs, not coverage.", true);
    if (claim.classification === "world" && !coverage.includes("world_context")) throw new CoreError("FACT_CURATION_WORLD_COVERAGE_REQUIRED", "World claims require world_context coverage.", true);
  }
  for (const evidence of claim.evidence) {
    const source = state.sources.find((candidate) => sourceMatches(candidate, evidence.source));
    if (source === undefined) {
      if (sourceAdaptation) throw new CoreError("FACT_CURATION_SOURCE_INVALID", `Evidence source '${evidence.source}' is not an ingested project source.`, true);
      continue;
    }
    if (evidence.source_revision_id !== undefined && evidence.source_revision_id !== source.revision) {
      throw new CoreError("FACT_CURATION_EVIDENCE_STALE", `Evidence for source ${source.id} does not match its current revision.`, true);
    }
    if (sourceAdaptation && (evidence.quote === undefined || !source.canonical_text.includes(evidence.quote))) {
      throw new CoreError("FACT_CURATION_EVIDENCE_INVALID", `Evidence quote for source ${source.id} cannot be located in the current source revision.`, true);
    }
  }
  if (sourceAdaptation && claim.evidence.every((evidence) => evidence.quote === undefined)) {
    throw new CoreError("FACT_CURATION_EVIDENCE_INVALID", "Source-adaptation claims require quote-level evidence.", true);
  }
  const normalized = { ...claim, ...(entityRefs.length === 0 ? {} : { entity_refs: entityRefs }), coverage };
  const candidate: FactRecord = {
    id: "validation",
    statement: `${claim.subject} ${claim.predicate} ${claim.value}`.trim(),
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.value,
    classification: claim.classification,
    entity_refs: entityRefs,
    coverage,
    status: "candidate",
    confidence: claim.confidence,
    source_ids: [],
    evidence: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    created_by: "validation",
  };
  assertStrictFactQuality(candidate, { matcher, strictEntity, strictCoverage: sourceAdaptation, strictQuality: sourceAdaptation || strictEntity });
  return normalized;
}

export function strictEvidenceReferences(
  decision: FactDecision,
  fact: FactRecord,
  sources: readonly SourceRecord[],
  chunks: readonly KnowledgeChunk[],
  strict: boolean,
): FactEvidenceReference[] {
  const explicit = ((decision as unknown as { evidence_refs?: FactEvidenceReference[] }).evidence_refs ?? []);
  const references: FactEvidenceReference[] = explicit.length > 0
    ? explicit.map((item) => ({ ...item }))
    : decision.evidence.flatMap((item) => {
      const source = sources.find((candidate) => sourceMatches(candidate, item.source));
      if (source === undefined || item.quote === undefined) return [];
      const chunk = chunks.find((candidate) => candidate.source_id === source.id && candidate.text.includes(item.quote!));
      if (chunk === undefined) return [];
      return [{ source_id: source.id, source_revision_id: source.revision, chunk_id: chunk.id, chunk_hash: chunk.hash, quote: item.quote, ...(item.locator === undefined ? {} : { locator: item.locator }) }];
    });
  const valid = references.filter((reference) => {
    const source = sources.find((candidate) => candidate.id === reference.source_id);
    if (source === undefined || source.revision !== reference.source_revision_id || !fact.source_ids.includes(source.id)) return false;
    if (reference.quote.trim().length === 0 || !source.canonical_text.includes(reference.quote)) return false;
    if (reference.chunk_id === undefined) return !strict;
    const chunk = chunks.find((candidate) => candidate.id === reference.chunk_id);
    return chunk !== undefined && chunk.source_id === source.id && (reference.chunk_hash === undefined || chunk.hash === reference.chunk_hash) && chunk.text.includes(reference.quote);
  });
  if (strict && (valid.length === 0 || valid.length !== references.length)) throw new CoreError("FACT_REVIEW_EVIDENCE_INVALID", `Accepted fact ${fact.id} requires evidence that matches the current source and chunk revision.`, true);
  return valid;
}
