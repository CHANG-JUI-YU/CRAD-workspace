import {
  canonicalJson,
  contentHash,
  CoreError,
  type FactClassification,
  type FactDecision,
  type FactEvidenceReference,
  type FactRecord,
  type KnowledgeChunk,
  type SourceRecord,
} from "@st-workspace/core";

export const FACT_REVIEW_POLICY_REVISION = contentHash("fact-review-strict-v1");

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
    coverage: fact.coverage,
    source_ids: fact.source_ids,
    source_revisions: sources.filter((source) => fact.source_ids.includes(source.id)).map((source) => ({ id: source.id, revision: source.revision })),
    evidence: fact.evidence,
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

export function assertStrictFactQuality(fact: FactRecord): void {
  if (fact.subject === undefined || fact.predicate === undefined || fact.value === undefined || fact.classification === undefined) {
    throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Accepted fact ${fact.id} must have subject, predicate, value and classification.`, true);
  }
  if ((fact.coverage ?? []).length === 0) throw new CoreError("FACT_REVIEW_COVERAGE_MISSING", `Accepted fact ${fact.id} must declare at least one coverage dimension.`, true);
  if (/(?:placeholder|dummy|fixture|lorem ipsum|test fact)/iu.test(fact.statement)) throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Accepted fact ${fact.id} contains placeholder or test content.`, true);
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
