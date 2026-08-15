import { describe, expect, it } from "vitest";
import {
  COVERAGE_COMMAND_IDENTITY_VERSION,
  attachmentRefIdentities,
  canonicalCoverageCommandIdentity,
  computeCoverageAttachmentIdentities,
} from "../src/index.js";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function supplementPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assessment_id: "assess-1",
    assessment_revision: "rev-1",
    requirement_id: "req.personality",
    choice: "source-backed",
    rationale: "reason",
    text: "補充",
    ...overrides,
  };
}

const attachment = (name: string, content: string, mediaType?: string) => ({ name, content: bytes(content), ...(mediaType === undefined ? {} : { media_type: mediaType }) });

describe("#103 coverage command identity", () => {
  it("ignores object key order when computing the digest", () => {
    const identityA = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), []);
    const identityB = canonicalCoverageCommandIdentity("coverage_supplement", { requirement_id: "req.personality", rationale: "reason", text: "補充", choice: "source-backed", assessment_revision: "rev-1", assessment_id: "assess-1" }, []);
    expect(identityA.digest).toBe(identityB.digest);
    expect(identityA.version).toBe(COVERAGE_COMMAND_IDENTITY_VERSION);
  });

  it("distinguishes missing, null, empty string, empty array and false", () => {
    const base = supplementPayload();
    const withNull = canonicalCoverageCommandIdentity("coverage_supplement", { ...base, choice: null }, []);
    const missing = canonicalCoverageCommandIdentity("coverage_supplement", { ...base, choice: undefined }, []);
    const emptyString = canonicalCoverageCommandIdentity("coverage_supplement", { ...base, choice: "" }, []);
    const emptyArray = canonicalCoverageCommandIdentity("coverage_supplement", { ...base, query_seeds: [] }, []);
    const withFalse = canonicalCoverageCommandIdentity("coverage_supplement", { ...base, confirmed: false }, []);
    expect(withNull.digest).not.toBe(missing.digest);
    expect(missing.digest).not.toBe(emptyString.digest);
    expect(emptyString.digest).not.toBe(emptyArray.digest);
    expect(emptyArray.digest).not.toBe(withFalse.digest);
  });

  it("changes the digest when the requirement id differs", () => {
    const withRequirement = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), []);
    const withoutRequirement = canonicalCoverageCommandIdentity("coverage_supplement", { ...supplementPayload(), requirement_id: undefined }, []);
    const otherRequirement = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload({ requirement_id: "req.identity" }), []);
    expect(withRequirement.digest).not.toBe(withoutRequirement.digest);
    expect(withRequirement.digest).not.toBe(otherRequirement.digest);
  });

  it("changes the digest when assessment, task, batch or action fields change", () => {
    const base = canonicalCoverageCommandIdentity("coverage_research_recover", { task_id: "task-1", action: "manual_url", url: "https://example.com" }, []);
    expect(base.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_research_recover", { task_id: "task-2", action: "manual_url", url: "https://example.com" }, []).digest);
    expect(base.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_research_recover", { task_id: "task-1", action: "revise_query", url: "https://example.com" }, []).digest);
    expect(base.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_research_recover", { task_id: "task-1", action: "manual_url", url: "https://other.example" }, []).digest);
    const supplement = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), []);
    expect(supplement.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload({ text: "其他文字" }), []).digest);
    expect(supplement.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload({ rationale: "other" }), []).digest);
    expect(supplement.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload({ query_seeds: ["a"] }), []).digest);
    expect(supplement.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload({ assessment_id: "assess-2" }), []).digest);
    expect(supplement.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload({ assessment_revision: "rev-2" }), []).digest);
    const claim = canonicalCoverageCommandIdentity("coverage_research_claim", { batch_id: "batch-1", lease_duration_ms: 60000 }, []);
    expect(claim.digest).not.toBe(canonicalCoverageCommandIdentity("coverage_research_claim", { batch_id: "batch-2", lease_duration_ms: 60000 }, []).digest);
  });

  it("changes the digest when attachment name, media type or content bytes change", () => {
    const refs = [attachment("a.txt", "hello", "text/plain")];
    const base = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities(refs));
    const renamed = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities([attachment("b.txt", "hello", "text/plain")]));
    const reTyped = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities([attachment("a.txt", "hello", "application/json")]));
    const reContent = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities([attachment("a.txt", "hello world", "text/plain")]));
    expect(base.digest).not.toBe(renamed.digest);
    expect(base.digest).not.toBe(reTyped.digest);
    expect(base.digest).not.toBe(reContent.digest);
  });

  it("keeps the digest stable when attachment order changes", () => {
    const first = [attachment("a.txt", "one"), attachment("b.txt", "two")];
    const second = [attachment("b.txt", "two"), attachment("a.txt", "one")];
    expect(computeCoverageAttachmentIdentities(first)).not.toEqual(computeCoverageAttachmentIdentities(second));
    const identityA = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities(first));
    const identityB = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities(second));
    expect(identityA.digest).toBe(identityB.digest);
  });

  it("detects attachment addition and removal", () => {
    const none = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), []);
    const one = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities([attachment("a.txt", "x")]));
    const two = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), computeCoverageAttachmentIdentities([attachment("a.txt", "x"), attachment("b.txt", "y")]));
    expect(none.digest).not.toBe(one.digest);
    expect(one.digest).not.toBe(two.digest);
  });

  it("excludes random attachment ids from the payload before hashing", () => {
    const withRefs = canonicalCoverageCommandIdentity("coverage_supplement", { ...supplementPayload(), attachment_refs: [{ id: "random-id-1", name: "a.txt", content_hash: "hash" }] }, []);
    const withoutRefs = canonicalCoverageCommandIdentity("coverage_supplement", supplementPayload(), []);
    expect(withRefs.digest).toBe(withoutRefs.digest);
  });

  it("computes attachment content hashes from bytes without writing anything", () => {
    const identities = computeCoverageAttachmentIdentities([attachment("a.txt", "hello", "text/plain")]);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.name).toBe("a.txt");
    expect(identities[0]?.media_type).toBe("text/plain");
    expect(identities[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/u);
    const different = computeCoverageAttachmentIdentities([attachment("a.txt", "hello!", "text/plain")]);
    expect(different[0]?.content_hash).not.toBe(identities[0]?.content_hash);
  });

  it("derives ref identities from stored refs with an explicit marker when content hash is missing", () => {
    const refs = attachmentRefIdentities([{ id: "abc", name: "a.txt", media_type: "text/plain", content_hash: "h1" }]);
    expect(refs).toEqual([{ name: "a.txt", media_type: "text/plain", content_hash: "h1" }]);
    const legacy = attachmentRefIdentities([{ id: "abc", name: "a.txt" }]);
    expect(legacy[0]?.content_hash).toBe("");
  });
});
