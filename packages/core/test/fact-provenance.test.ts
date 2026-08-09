import { describe, expect, it } from "vitest";
import { contentHash, validateFactReferences, type FactRecord, type SourceRecord } from "../src/index.js";

const source: SourceRecord = {
  id: "source-official",
  candidate_id: "candidate-official",
  title: "Official page",
  canonical_text: "Official source text.",
  original_hash: contentHash("Official source text."),
  revision: contentHash("Official source text."),
  media_type: "text/plain",
  created_at: new Date().toISOString(),
};

function fact(overrides: Partial<FactRecord> = {}): FactRecord {
  const timestamp = new Date().toISOString();
  return {
    id: "fact-1",
    statement: "Yukino has_trait calm",
    subject: "Yukino",
    predicate: "has_trait",
    value: "calm",
    classification: "trait",
    status: "accepted",
    confidence: 0.9,
    source_ids: [source.id],
    evidence: ["Official page — Yukino is calm."],
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "fact-reviewer-1",
    ...overrides,
  };
}

describe("fact provenance validation", () => {
  it("accepts an accepted source-backed fact reference", () => {
    expect(validateFactReferences({ document: { provenance: [{ kind: "fact", ref: "fact-1" }] } }, [fact()], [source])).toEqual([]);
  });

  it("rejects missing and non-accepted facts", () => {
    const findings = validateFactReferences({ fact_refs: ["fact-pending", "fact-missing"] }, [fact({ id: "fact-pending", status: "candidate" })], [source]);
    expect(findings.map((finding) => finding.code)).toEqual(["FACT_REFERENCE_NOT_ACCEPTED", "FACT_REFERENCE_MISSING"]);
  });

  it("only blocks a reference with an explicit single-value requirement when facts conflict", () => {
    const conflict = fact({ id: "fact-conflict", value: "reserved", status: "conflict" });
    expect(validateFactReferences({ provenance: [{ kind: "fact", ref: "fact-1" }] }, [fact(), conflict], [source])).toEqual([]);
    expect(validateFactReferences({ provenance: [{ kind: "fact", ref: "fact-1", requires_single_value: true }] }, [fact(), conflict], [source]).map((finding) => finding.code)).toEqual(["FACT_REFERENCE_CONFLICT"]);
  });
});
