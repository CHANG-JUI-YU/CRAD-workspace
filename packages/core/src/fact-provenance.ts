import type { FactRecord, SourceRecord } from "./index.js";

export interface FactReferenceFinding {
  code: "FACT_REFERENCE_MISSING" | "FACT_REFERENCE_NOT_ACCEPTED" | "FACT_SOURCE_MISSING" | "FACT_EVIDENCE_MISSING" | "FACT_PROVENANCE_MISSING" | "FACT_REFERENCE_CONFLICT";
  severity: "error";
  path: string;
  fact_id?: string;
  message: string;
}

interface FactReference {
  id: string;
  path: string;
  requiresSingleValue: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function pathFor(parent: string, key: string | number): string {
  return `${parent}/${String(key).replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
}

function semanticKey(fact: Pick<FactRecord, "statement" | "subject" | "predicate" | "value">): string {
  return [fact.subject, fact.predicate].filter((item): item is string => item !== undefined).join("|").trim().toLocaleLowerCase()
    || fact.statement.trim().toLocaleLowerCase();
}

function collectReferences(value: unknown, path: string, output: FactReference[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, pathFor(path, index), output));
    return;
  }
  const object = record(value);
  if (object === undefined) return;

  const provenance = object.provenance;
  if (Array.isArray(provenance)) {
    provenance.forEach((item, index) => {
      const entry = record(item);
      if (entry?.kind !== "fact" || typeof entry.ref !== "string" || entry.ref.trim().length === 0) return;
      output.push({
        id: entry.ref,
        path: pathFor(pathFor(path, "provenance"), index),
        requiresSingleValue: entry.requires_single_value === true,
      });
    });
  }

  const factRefs = object.fact_refs;
  if (Array.isArray(factRefs)) {
    factRefs.forEach((item, index) => {
      if (typeof item !== "string" || item.trim().length === 0) return;
      output.push({ id: item, path: pathFor(pathFor(path, "fact_refs"), index), requiresSingleValue: false });
    });
  }

  Object.entries(object).forEach(([key, item]) => {
    if (key === "provenance" || key === "fact_refs") return;
    collectReferences(item, pathFor(path, key), output);
  });
}

export function collectFactReferences(value: unknown): ReadonlyArray<{ id: string; path: string; requires_single_value: boolean }> {
  const references: FactReference[] = [];
  collectReferences(value, "", references);
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.id}:${reference.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((reference) => ({ id: reference.id, path: reference.path || "/", requires_single_value: reference.requiresSingleValue }));
}

export function validateFactReferences(value: unknown, facts: readonly FactRecord[], sources: readonly SourceRecord[]): FactReferenceFinding[] {
  const references = collectFactReferences(value);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const sourceIds = new Set(sources.map((source) => source.id));
  const findings: FactReferenceFinding[] = [];
  const unresolvedConflictKeys = new Set(facts.filter((fact) => fact.status === "conflict").map(semanticKey));

  for (const reference of references) {
    const fact = byId.get(reference.id);
    if (fact === undefined) {
      findings.push({ code: "FACT_REFERENCE_MISSING", severity: "error", path: reference.path, fact_id: reference.id, message: `Fact ${reference.id} does not exist in this project.` });
      continue;
    }
    if (fact.status !== "accepted") {
      findings.push({ code: "FACT_REFERENCE_NOT_ACCEPTED", severity: "error", path: reference.path, fact_id: fact.id, message: `Fact ${fact.id} is ${fact.status}; only accepted facts may be referenced.` });
      continue;
    }
    const missingSourceIds = fact.source_ids.filter((sourceId) => !sourceIds.has(sourceId));
    if (missingSourceIds.length > 0) {
      findings.push({ code: "FACT_SOURCE_MISSING", severity: "error", path: reference.path, fact_id: fact.id, message: `Fact ${fact.id} refers to missing source(s): ${missingSourceIds.join(", ")}.` });
    }
    if (fact.source_ids.length > 0 && fact.evidence.length === 0) {
      findings.push({ code: "FACT_EVIDENCE_MISSING", severity: "error", path: reference.path, fact_id: fact.id, message: `Source-derived fact ${fact.id} has no evidence.` });
    }
    if (fact.source_ids.length === 0 && fact.evidence.length === 0) {
      findings.push({ code: "FACT_PROVENANCE_MISSING", severity: "error", path: reference.path, fact_id: fact.id, message: `Fact ${fact.id} has neither source evidence nor user-provided evidence.` });
    }
    if (reference.requires_single_value && unresolvedConflictKeys.has(semanticKey(fact))) {
      findings.push({ code: "FACT_REFERENCE_CONFLICT", severity: "error", path: reference.path, fact_id: fact.id, message: `Fact ${fact.id} has an unresolved conflicting fact and cannot satisfy a single-value reference.` });
    }
  }
  return findings;
}
