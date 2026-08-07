import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  candidateBatchSchema,
  factCandidateSchema,
  projectManifestSchema,
  type FactCandidate,
} from "@card-workspace/schemas";
import {
  canonicalJson,
  canonicalYaml,
  initializeProject,
} from "@card-workspace/project";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendJournalEvents,
  computeCandidateBatchHash,
  computeJournalEventRevision,
  listConflicts,
  projectFactEvents,
  migrateCandidateIdentity,
  queryFacts,
  readHistoricalCandidateIndex,
  readFactProjection,
  rebuildFactProjection,
  resolveConflict,
  reviewCandidate,
  reviewCandidates,
  validateResolutionDecision,
  verifyFactProjection,
  verifyJournalText,
} from "../src/index.js";

const timestamp = "2026-07-13T10:00:00.000Z";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function project() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const root = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "review-demo",
      title: "Review",
      kind: "character_card",
      card: { name: "Review" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  return root;
}

function candidate(id: string, value: string): FactCandidate {
  return factCandidateSchema.parse({
    schema_version: 1,
    id,
    subject: "alice",
    predicate: "appearance.hair",
    value,
    classification: "source_fact",
    confidence: 0.9,
    evidence: [{
      id: `evidence-${id}`,
      source_id: "novel",
      source_revision_id: `sha256:${"a".repeat(64)}`,
      chunk_set_id: "set-1",
      chunk_id: "chunk-1",
      chunk_hash: `sha256:${"b".repeat(64)}`,
      quote: value,
      normalized_character_range: [0, value.length],
      normalized_line_range: [1, 1],
    }],
    status: "pending_review",
    created_by: "curator",
    created_at: timestamp,
  });
}

async function storeCandidate(root: string, item: FactCandidate, batchId = `batch-${item.id}`): Promise<void> {
  const draft = {
    schema_version: 1 as const,
    id: batchId,
    source_id: "novel",
    source_revision_id: `sha256:${"a".repeat(64)}` as const,
    chunk_set_id: "set-1",
    chunk_id: "chunk-1",
    chunk_hash: `sha256:${"b".repeat(64)}` as const,
    job_id: "job-1",
    input_revision: `sha256:${"c".repeat(64)}` as const,
    candidates: [item],
    created_by: "curator",
    created_at: timestamp,
    extensions: {},
  };
  const normalized = candidateBatchSchema.parse({
    ...draft,
    content_hash: `sha256:${"0".repeat(64)}`,
  });
  const batch = candidateBatchSchema.parse({ ...normalized, content_hash: computeCandidateBatchHash(normalized) });
  await mkdir(path.join(root, "facts", "candidates"), { recursive: true });
  await writeFile(path.join(root, "facts", "candidates", `${batch.id}.json`), canonicalJson(batch), "utf8");
}

function reviewDecision(candidateId: string, factId: string, id: string, type: "accepted" | "rejected" = "accepted") {
  return {
    schema_version: 1 as const,
    id,
    candidate_id: candidateId,
    fact_id: factId,
    type,
    rationale: "人工審核",
    actor: "user",
    decided_at: timestamp,
  };
}

async function storeLegacyReview(root: string, rawCandidateId: string, batchId: string, decisionId: string) {
  const source = candidate(rawCandidateId, "black");
  await storeCandidate(root, source, batchId);
  const decision = reviewDecision(rawCandidateId, `fact-${decisionId}`, decisionId);
  const fact = {
    ...source,
    id: decision.fact_id,
    status: "accepted" as const,
    source_tiers: ["official" as const],
    fact_revision: 1,
    decision_id: decision.id,
    decision_ids: [decision.id],
  };
  const journal = appendJournalEvents(verifyJournalText(""), [{
    id: decision.id,
    kind: "fact.accepted",
    aggregate_id: fact.id,
    actor: decision.actor,
    timestamp: decision.decided_at,
    payload: { decision, fact },
  }]);
  const projected = projectFactEvents(journal.events, await readHistoricalCandidateIndex(root));
  await Promise.all([
    writeFile(path.join(root, "facts", "decisions.jsonl"), journal.rawText, "utf8"),
    writeFile(path.join(root, "facts", "register.yaml"), canonicalYaml(projected.register), "utf8"),
    writeFile(path.join(root, "facts", "conflicts.yaml"), canonicalYaml(projected.conflicts), "utf8"),
  ]);
  return projected;
}

describe("fact review and projection", () => {
  it("accept/reject 由 decision 驅動，revision 遞增並拒絕 stale review", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    await storeCandidate(root, candidate("candidate-b", "brown"));
    const empty = await readFactProjection(root);
    const accepted = await reviewCandidate(root, {
      decision: reviewDecision("candidate-a", "fact-a", "decision-a"),
      expectedProjectionRevision: empty.register.revision,
    });
    expect(accepted.fact).toMatchObject({ status: "accepted", fact_revision: 1, decision_id: "decision-a" });
    await expect(reviewCandidate(root, {
      decision: reviewDecision("candidate-b", "fact-b", "decision-b", "rejected"),
      expectedProjectionRevision: empty.register.revision,
    })).rejects.toMatchObject({ code: "FACT_PROJECTION_STALE" });
    const rejected = await reviewCandidate(root, {
      decision: reviewDecision("candidate-b", "fact-b", "decision-b", "rejected"),
      expectedProjectionRevision: accepted.projection.register.revision,
    });
    expect(rejected.fact.status).toBe("rejected");

    await expect(reviewCandidate(root, {
      decision: reviewDecision("candidate-a", "fact-a", "decision-c"),
      expectedProjectionRevision: rejected.projection.register.revision,
      patch: { value: "blue" },
    })).rejects.toMatchObject({ code: "FACT_REVISION_STALE" });
    const revised = await reviewCandidate(root, {
      decision: reviewDecision("candidate-a", "fact-a", "decision-c"),
      expectedProjectionRevision: rejected.projection.register.revision,
      expectedFactRevision: 1,
      patch: { value: "blue" },
    });
    expect(revised.fact).toMatchObject({ value: "blue", fact_revision: 2, decision_ids: ["decision-a", "decision-c"] });
    await expect(verifyFactProjection(root)).resolves.toEqual(revised.projection);
  });

  it("batch review 單一 CAS 一次提交並回傳摘要而非完整 register", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    await storeCandidate(root, candidate("candidate-b", "brown"));
    await storeCandidate(root, candidate("candidate-c", "silver"));
    const state = await readFactProjection(root);
    const result = await reviewCandidates(root, {
      decisions: [
        reviewDecision("candidate-a", "fact-a", "decision-a"),
        reviewDecision("candidate-b", "fact-b", "decision-b"),
        reviewDecision("candidate-c", "fact-c", "decision-c", "rejected"),
      ],
      expectedProjectionRevision: state.register.revision,
    });
    expect(result.reviewed).toBe(3);
    expect(result.projection_revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts).toEqual([
      { id: "fact-a", fact_revision: 1, status: "accepted" },
      { id: "fact-b", fact_revision: 1, status: "accepted" },
      { id: "fact-c", fact_revision: 1, status: "rejected" },
    ]);
    expect(result.conflicts_opened).toHaveLength(1);
    expect(result.conflicts_opened[0]).toMatch(/^conflict-[a-f0-9]{64}$/u);
    const after = await readFactProjection(root);
    expect(after.register.facts.map((fact) => fact.id).sort()).toEqual(["fact-a", "fact-b", "fact-c"]);
    expect(after.conflicts.conflicts).toHaveLength(1);
  });

  it("batch review 拒絕空批次、重複 decision id 與重複 fact id", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    await storeCandidate(root, candidate("candidate-b", "brown"));
    const state = await readFactProjection(root);
    await expect(reviewCandidates(root, {
      decisions: [],
      expectedProjectionRevision: state.register.revision,
    })).rejects.toMatchObject({ code: "FACT_REVIEW_BATCH_EMPTY" });
    await expect(reviewCandidates(root, {
      decisions: [
        reviewDecision("candidate-a", "fact-a", "decision-a"),
        reviewDecision("candidate-b", "fact-b", "decision-a"),
      ],
      expectedProjectionRevision: state.register.revision,
    })).rejects.toMatchObject({ code: "FACT_REVIEW_BATCH_DUPLICATE_DECISION" });
    await expect(reviewCandidates(root, {
      decisions: [
        reviewDecision("candidate-a", "fact-a", "decision-a"),
        reviewDecision("candidate-b", "fact-a", "decision-b"),
      ],
      expectedProjectionRevision: state.register.revision,
    })).rejects.toMatchObject({ code: "FACT_REVIEW_BATCH_DUPLICATE_FACT" });
  });

  it("batch review 沿用 stale、品質與 fact revision 拒絕", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    await storeCandidate(root, candidate("legacy-placeholder", "placeholder"));
    const state = await readFactProjection(root);
    await expect(reviewCandidates(root, {
      decisions: [reviewDecision("candidate-a", "fact-a", "decision-a")],
      expectedProjectionRevision: `sha256:${"0".repeat(64)}`,
    })).rejects.toMatchObject({ code: "FACT_PROJECTION_STALE" });
    await expect(reviewCandidates(root, {
      decisions: [reviewDecision("legacy-placeholder", "fact-p", "decision-p")],
      expectedProjectionRevision: state.register.revision,
    })).rejects.toMatchObject({ code: "FACT_CANDIDATE_QUALITY_DENIED" });
    const accepted = await reviewCandidates(root, {
      decisions: [reviewDecision("candidate-a", "fact-a", "decision-a")],
      expectedProjectionRevision: state.register.revision,
    });
    await expect(reviewCandidates(root, {
      decisions: [reviewDecision("candidate-a", "fact-a", "decision-b")],
      expectedProjectionRevision: accepted.projection_revision,
      expectedFactRevisions: { "fact-a": 2 },
    })).rejects.toMatchObject({ code: "FACT_REVISION_STALE" });
    const revised = await reviewCandidates(root, {
      decisions: [reviewDecision("candidate-a", "fact-a", "decision-b")],
      expectedProjectionRevision: accepted.projection_revision,
      expectedFactRevisions: { "fact-a": 1 },
      patches: { "fact-a": { value: "blue" } },
    });
    expect(revised.facts).toEqual([{ id: "fact-a", fact_revision: 2, status: "accepted" }]);
    expect((await readFactProjection(root)).register.facts.find((fact) => fact.id === "fact-a")?.value).toBe("blue");
  });

  it("listConflicts 分頁回傳 exact member fact IDs 供 Director 裁決", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    await storeCandidate(root, candidate("candidate-b", "brown"));
    await storeCandidate(root, { ...candidate("candidate-d", "tall"), predicate: "appearance.height" });
    await storeCandidate(root, { ...candidate("candidate-e", "short"), predicate: "appearance.height" });
    const state = await readFactProjection(root);
    const result = await reviewCandidates(root, {
      decisions: [
        reviewDecision("candidate-a", "fact-a", "decision-a"),
        reviewDecision("candidate-b", "fact-b", "decision-b"),
        reviewDecision("candidate-d", "fact-d", "decision-d"),
        reviewDecision("candidate-e", "fact-e", "decision-e"),
      ],
      expectedProjectionRevision: state.register.revision,
    });
    expect(result.conflicts_opened).toHaveLength(2);
    const firstPage = await listConflicts(root, { limit: 1 });
    expect(firstPage.projection_revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(firstPage.conflicts).toHaveLength(1);
    expect(firstPage.next_cursor).toBe(firstPage.conflicts[0]!.id);
    expect(firstPage.conflicts[0]!.members.map((member) => member.fact_id).sort()).toEqual(["fact-a", "fact-b"]);
    const secondPage = await listConflicts(root, { limit: 1, cursor: firstPage.next_cursor });
    expect(secondPage.conflicts).toHaveLength(1);
    expect(secondPage.next_cursor).toBeUndefined();
    expect(secondPage.conflicts[0]!.members.map((member) => member.fact_id).sort()).toEqual(["fact-d", "fact-e"]);
    const both = await listConflicts(root);
    expect(both.conflicts).toHaveLength(2);
    const unknownCursor = await listConflicts(root, { cursor: "conflict-nonexistent" });
    expect(unknownCursor.conflicts).toEqual([]);
    expect(unknownCursor.next_cursor).toBeUndefined();
  });

  it("query 暴露 unresolved conflict gate，resolution 使用 fact/projection CAS", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    await storeCandidate(root, candidate("candidate-b", "white"));
    const state = await readFactProjection(root);
    const first = await reviewCandidate(root, {
      decision: reviewDecision("candidate-a", "fact-a", "decision-a"),
      expectedProjectionRevision: state.register.revision,
    });
    const second = await reviewCandidate(root, {
      decision: reviewDecision("candidate-b", "fact-b", "decision-b"),
      expectedProjectionRevision: first.projection.register.revision,
    });
    const conflict = second.projection.conflicts.conflicts[0]!;
    expect((await queryFacts(root, { gateStatus: "blocked_unresolved_conflict" })).facts).toHaveLength(2);
    const decision = {
      schema_version: 1 as const,
      id: "resolution-a",
      conflict_id: conflict.id,
      type: "choose_one" as const,
      accepted_fact_ids: ["fact-a"],
      rejected_fact_ids: ["fact-b"],
      rationale: "選擇黑髮",
      actor: "user",
      decided_at: timestamp,
    };
    await expect(resolveConflict(root, {
      decision,
      expectedProjectionRevision: second.projection.register.revision,
      expectedFactRevisions: { "fact-a": 1, "fact-b": 0 },
    })).rejects.toMatchObject({ code: "FACT_REVISION_STALE" });
    const resolved = await resolveConflict(root, {
      decision,
      expectedProjectionRevision: second.projection.register.revision,
      expectedFactRevisions: { "fact-a": 1, "fact-b": 1 },
    });
    expect(resolved.conflict.status).toBe("resolved");
    expect(resolved.projection.register.facts.find((item) => item.id === "fact-b")?.status).toBe("rejected");
    await expect(queryFacts(root, { status: "accepted", subject: "alice", predicate: "appearance.hair", classification: "source_fact", sourceId: "novel", gateStatus: "clear" })).resolves.toMatchObject({ facts: [{ fact: { id: "fact-a" } }] });
    const acceptedRows = await queryFacts(root, { status: "accepted", subject: "alice", predicate: "appearance.hair", classification: "source_fact", sourceId: "novel" });
    expect(acceptedRows.facts).toHaveLength(1);
    expect((await queryFacts(root, { status: "rejected", gateStatus: "clear" })).facts).toHaveLength(1);
    expect((await queryFacts(root, { subject: "nobody" })).facts).toEqual([]);
  });

  it("legacy placeholder candidate 可 reject 但不可 accept", async () => {
    const root = await project();
    await storeCandidate(root, candidate("legacy-placeholder", "placeholder"));
    const state = await readFactProjection(root);
    await expect(reviewCandidate(root, {
      decision: reviewDecision("legacy-placeholder", "fact-placeholder", "accept-placeholder"),
      expectedProjectionRevision: state.register.revision,
    })).rejects.toMatchObject({ code: "FACT_CANDIDATE_QUALITY_DENIED" });
    const rejected = await reviewCandidate(root, {
      decision: reviewDecision("legacy-placeholder", "fact-placeholder", "reject-placeholder", "rejected"),
      expectedProjectionRevision: state.register.revision,
    });
    expect(rejected.fact.status).toBe("rejected");
  });

  it("raw-ID review 持久化 exact occurrence，後續同 raw ID batch 不破壞 rebuild", async () => {
    const root = await project();
    const rawDecision = reviewDecision("candidate-later-collision", "fact-stable", "decision-stable");
    await storeCandidate(root, candidate("candidate-later-collision", "black"), "batch-original");
    const initial = await readFactProjection(root);

    await reviewCandidate(root, {
      decision: rawDecision,
      expectedProjectionRevision: initial.register.revision,
    });

    const journal = verifyJournalText(await readFile(path.join(root, "facts", "decisions.jsonl"), "utf8"));
    const persistedDecision = journal.events[0]!.payload.decision as { candidate_id: string };
    expect(persistedDecision.candidate_id).toMatch(/^candidate-occurrence-[a-f0-9]{64}$/u);
    expect(rawDecision.candidate_id).toBe("candidate-later-collision");

    await storeCandidate(root, candidate("candidate-later-collision", "white"), "batch-collision");
    await expect(rebuildFactProjection(root)).resolves.toMatchObject({
      register: { facts: [{ id: "fact-stable", value: "black" }] },
    });
  });

  it("historical index 僅為全歷史唯一 raw ID 建 alias，ambiguous raw event fail closed", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-unique", "black"), "batch-unique");
    await storeCandidate(root, candidate("candidate-duplicate", "brown"), "batch-duplicate-a");
    await storeCandidate(root, candidate("candidate-duplicate", "white"), "batch-duplicate-b");
    const candidates = await readHistoricalCandidateIndex(root);
    expect(candidates.has("candidate-unique")).toBe(true);
    expect(candidates.has("candidate-duplicate")).toBe(false);
    expect([...candidates.keys()].filter((id) => id.startsWith("candidate-occurrence-"))).toHaveLength(3);
    const projection = await readFactProjection(root);
    await expect(reviewCandidate(root, {
      decision: reviewDecision("candidate-duplicate", "fact-ambiguous", "decision-ambiguous-review"),
      expectedProjectionRevision: projection.register.revision,
    })).rejects.toMatchObject({ code: "FACT_CANDIDATE_NOT_ACTIVE" });

    const decision = reviewDecision("candidate-unique", "fact-unique", "decision-unique");
    const source = candidate("candidate-unique", "black");
    const fact = {
      ...source,
      id: "fact-unique",
      status: "accepted" as const,
      source_tiers: ["official" as const],
      fact_revision: 1,
      decision_id: decision.id,
      decision_ids: [decision.id],
    };
    const uniqueEvent = appendJournalEvents(verifyJournalText(""), [{
      id: decision.id,
      kind: "fact.accepted",
      aggregate_id: fact.id,
      actor: decision.actor,
      timestamp: decision.decided_at,
      payload: { decision, fact },
    }]).events;
    expect(projectFactEvents(uniqueEvent, candidates).register.facts).toHaveLength(1);

    const ambiguousDecision = { ...decision, id: "decision-ambiguous", candidate_id: "candidate-duplicate" };
    const ambiguousFact = {
      ...fact,
      decision_id: ambiguousDecision.id,
      decision_ids: [ambiguousDecision.id],
    };
    const ambiguousEvent = appendJournalEvents(verifyJournalText(""), [{
      id: ambiguousDecision.id,
      kind: "fact.accepted",
      aggregate_id: ambiguousFact.id,
      actor: ambiguousDecision.actor,
      timestamp: ambiguousDecision.decided_at,
      payload: { decision: ambiguousDecision, fact: ambiguousFact },
    }]).events;
    try {
      projectFactEvents(ambiguousEvent, candidates);
      expect.unreachable("ambiguous raw candidate ID should fail projection");
    } catch (error) {
      expect(error).toMatchObject({ code: "FACT_EVENT_DECISION_INVALID" });
    }
  });

  it("顯式 binding 唯一成功且冪等，collision 後 replay 與後續 review 保持單調", async () => {
    const root = await project();
    const legacy = await storeLegacyReview(root, "candidate-legacy", "batch-legacy", "decision-legacy");
    const migrated = await migrateCandidateIdentity(root, {
      decisionId: "decision-legacy",
      expectedProjectionRevision: legacy.register.revision,
      actor: "director",
      occurredAt: "2026-07-19T01:00:00.000Z",
    });
    expect(migrated).toMatchObject({
      idempotent: false,
      binding: {
        decision_id: "decision-legacy",
        raw_candidate_id: "candidate-legacy",
        source_batch_id: "batch-legacy",
      },
    });
    const once = await readFile(path.join(root, "facts", "decisions.jsonl"), "utf8");
    const retry = await migrateCandidateIdentity(root, {
      decisionId: "decision-legacy",
      expectedProjectionRevision: migrated.projection.register.revision,
      actor: "director",
      occurredAt: "2026-07-19T01:01:00.000Z",
    });
    expect(retry.idempotent).toBe(true);
    await expect(readFile(path.join(root, "facts", "decisions.jsonl"), "utf8")).resolves.toBe(once);

    await storeCandidate(root, candidate("candidate-legacy", "white"), "batch-later-collision");
    const rebuilt = await rebuildFactProjection(root);
    const candidates = await readHistoricalCandidateIndex(root);
    const laterOccurrenceId = [...candidates.values()].find((item) =>
      item.extensions.source_batch_id === "batch-later-collision")!.id;
    const reviewed = await reviewCandidate(root, {
      decision: reviewDecision(laterOccurrenceId, "fact-later", "decision-later"),
      expectedProjectionRevision: rebuilt.register.revision,
    });
    expect(reviewed.projection.register.facts.map((fact) => fact.id).sort())
      .toEqual(["fact-decision-legacy", "fact-later"]);
    await expect(rebuildFactProjection(root)).resolves.toEqual({
      register: reviewed.projection.register,
      conflicts: reviewed.projection.conflicts,
    });
  });

  it("顯式 binding 對歧義 legacy raw ID fail closed 且不追加 journal", async () => {
    const root = await project();
    const legacy = await storeLegacyReview(root, "candidate-ambiguous-migration", "batch-first", "decision-ambiguous-migration");
    await storeCandidate(root, candidate("candidate-ambiguous-migration", "white"), "batch-second");
    const before = await readFile(path.join(root, "facts", "decisions.jsonl"), "utf8");
    await expect(migrateCandidateIdentity(root, {
      decisionId: "decision-ambiguous-migration",
      expectedProjectionRevision: legacy.register.revision,
      actor: "director",
      occurredAt: "2026-07-19T02:00:00.000Z",
    })).rejects.toMatchObject({ code: "FACT_CANDIDATE_BINDING_AMBIGUOUS" });
    await expect(readFile(path.join(root, "facts", "decisions.jsonl"), "utf8")).resolves.toBe(before);
  });
});

describe("resolution and immutable journal", () => {
  const member = (id: string) => ({
    fact_id: id,
    source_id: "novel",
    source_revision_id: `sha256:${"a".repeat(64)}` as const,
    value: id,
  });
  const conflict = {
    schema_version: 1 as const,
    id: "conflict-a",
    subject: "alice",
    predicate: "appearance.hair",
    scope: { character_ids: [], extensions: {} },
    valid_time: { extensions: {} },
    members: [member("fact-a"), member("fact-b")],
    status: "open" as const,
    opened_at: timestamp,
    updated_at: timestamp,
    extensions: {},
  };
  const base = {
    schema_version: 1 as const,
    id: "resolution-a",
    conflict_id: "conflict-a",
    rationale: "人工裁決",
    actor: "user",
    decided_at: timestamp,
  };

  it("驗證六種 resolution payload 並拒絕型別不符欄位", () => {
    const cases = [
      { ...base, type: "choose_one", accepted_fact_ids: ["fact-a"], rejected_fact_ids: ["fact-b"] },
      { ...base, type: "coexist", accepted_fact_ids: ["fact-a", "fact-b"] },
      { ...base, type: "temporal", temporal_assignments: [
        { fact_id: "fact-a", valid_time: { start: "1", end: "2" } },
        { fact_id: "fact-b", valid_time: { start: "3", end: "4" } },
      ] },
      { ...base, type: "scope_split", scope_assignments: [
        { fact_id: "fact-a", scope: { timeline: "one" } },
        { fact_id: "fact-b", scope: { timeline: "two" } },
      ] },
      { ...base, type: "unresolved" },
      { ...base, type: "supersede", accepted_fact_ids: ["fact-a"], rejected_fact_ids: ["fact-b"] },
    ];
    for (const item of cases) expect(validateResolutionDecision(item, conflict).type).toBe(item.type);
    expect(() => validateResolutionDecision({ ...base, type: "unresolved", accepted_fact_ids: ["fact-a"] }, conflict))
      .toThrowError();
  });

  it("covers resolution decision member, assignment, and overlap guards", () => {
    expect(() => validateResolutionDecision({ ...base, conflict_id: "other", type: "unresolved" }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "choose_one", accepted_fact_ids: [], rejected_fact_ids: ["fact-a", "fact-b"] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "supersede", accepted_fact_ids: ["fact-a", "fact-b"], rejected_fact_ids: [] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "choose_one", accepted_fact_ids: ["fact-a"], rejected_fact_ids: [] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "coexist", accepted_fact_ids: ["fact-a"], rejected_fact_ids: [] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "choose_one", accepted_fact_ids: ["fact-c"], rejected_fact_ids: ["fact-a"] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "temporal", temporal_assignments: [
      { fact_id: "fact-a", valid_time: { start: "1", end: "3" } },
      { fact_id: "fact-a", valid_time: { start: "4", end: "5" } },
    ] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "temporal", temporal_assignments: [
      { fact_id: "fact-a", valid_time: { start: "1", end: "3" } },
      { fact_id: "fact-b", valid_time: { start: "2", end: "4" } },
    ] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "scope_split", scope_assignments: [
      { fact_id: "fact-a", scope: { character_ids: ["alice"] } },
      { fact_id: "fact-a", scope: { character_ids: ["bob"] } },
    ] }, conflict)).toThrowError();
    expect(() => validateResolutionDecision({ ...base, type: "scope_split", scope_assignments: [
      { fact_id: "fact-a", scope: { character_ids: ["alice"] } },
      { fact_id: "fact-b", scope: { character_ids: ["alice"] } },
    ] }, conflict)).toThrowError();
    const candidateConflict = { ...conflict, members: [{ candidate_id: "candidate-a" }, { candidate_id: "candidate-b" }] };
    expect(() => validateResolutionDecision({ ...base, type: "choose_one", accepted_fact_ids: [], rejected_fact_ids: [] }, candidateConflict)).toThrowError();
  });
  it("檢查 canonical lines、sequence/prior/hash/duplicate，timestamp 不進 semantic event revision", () => {
    const empty = verifyJournalText("");
    const first = appendJournalEvents(empty, [{
      id: "event-a", kind: "candidate.validated", aggregate_id: "candidate-a", actor: "user", timestamp,
      payload: { candidate_id: "candidate-a" },
    }]);
    const second = appendJournalEvents(first, [{
      id: "event-b", kind: "candidate.validated", aggregate_id: "candidate-a", actor: "user", timestamp,
      payload: { candidate_id: "candidate-a" },
    }]);
    expect(second.rawText.trim().split("\n")).toHaveLength(2);
    expect(() => verifyJournalText(second.rawText.replace('"sequence":2', '"sequence":3'))).toThrow();
    expect(() => verifyJournalText(second.rawText.replace('"prior_revision":"sha256:', '"prior_revision":"sha256:f'))).toThrow();
    expect(() => verifyJournalText(second.rawText.replace('"event-b"', '"event-a"'))).toThrow();
    expect(() => verifyJournalText(second.rawText.replace('"candidate-a"}', '"candidate-x"}'))).toThrow();
    const event = first.events[0]!;
    expect(computeJournalEventRevision({ ...event, timestamp: "2030-01-01T00:00:00.000Z" }))
      .toBe(computeJournalEventRevision(event));
  });

  it("rebuild canonical 等價；journal 壞損時不修改既有 projections", async () => {
    const root = await project();
    await storeCandidate(root, candidate("candidate-a", "black"));
    const initial = await readFactProjection(root);
    await reviewCandidate(root, {
      decision: reviewDecision("candidate-a", "fact-a", "decision-a"),
      expectedProjectionRevision: initial.register.revision,
    });
    const before = await readFactProjection(root);
    const rebuilt = await rebuildFactProjection(root);
    expect(canonicalJson(rebuilt)).toBe(canonicalJson({ register: before.register, conflicts: before.conflicts }));
    const journalPath = path.join(root, "facts", "decisions.jsonl");
    await writeFile(journalPath, `${await readFile(journalPath, "utf8")}not-json\n`, "utf8");
    const registerBefore = await readFile(path.join(root, "facts", "register.yaml"), "utf8");
    const conflictsBefore = await readFile(path.join(root, "facts", "conflicts.yaml"), "utf8");
    await expect(rebuildFactProjection(root)).rejects.toMatchObject({ code: "FACT_JOURNAL_LINE_INVALID" });
    await expect(readFile(path.join(root, "facts", "register.yaml"), "utf8")).resolves.toBe(registerBefore);
    await expect(readFile(path.join(root, "facts", "conflicts.yaml"), "utf8")).resolves.toBe(conflictsBefore);
  });
  it("covers projection event rejection branches", async () => {
    const root = await project();
    const candidates = new Map<string, FactCandidate>();
    let eventNumber = 0;
    const make = (kind: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => appendJournalEvents(verifyJournalText(""), [{
      id: `event-${++eventNumber}`,
      kind,
      aggregate_id: "fact-x",
      actor: "user",
      timestamp,
      payload,
      ...extra,
    } as never]).events;
    expect(() => projectFactEvents(make("source.created"), candidates)).toThrow("不支援");
    expect(() => projectFactEvents(make("candidate.submitted"), candidates)).toThrow("不存在");
    expect(() => projectFactEvents(make("conflict.opened", { conflict: {} } as never), candidates)).toThrow();
    expect(() => projectFactEvents(make("conflict.resolved", { decision: {}, conflict: {} } as never), candidates)).toThrow();
    expect(() => projectFactEvents(make("fact.accepted", {}), candidates)).toThrow();
    const source = candidate("candidate-projection", "black");
    candidates.set(source.id, source);
    const decision = reviewDecision(source.id, "fact-projection", "decision-projection");
    const fact = { ...source, id: "fact-projection", status: "accepted" as const, source_tiers: ["official" as const], fact_revision: 1, decision_id: decision.id, decision_ids: [decision.id] };
    const valid = make("fact.accepted", { decision, fact });
    expect(() => projectFactEvents(valid.map((event) => ({ ...event, aggregate_id: "wrong" })), candidates)).toThrow();
    expect(() => projectFactEvents(valid.map((event) => ({ ...event, actor: "other" })), candidates)).toThrow();
    expect(() => projectFactEvents(valid.map((event) => ({ ...event, payload: { decision, fact: { ...fact, fact_revision: 2 } } })), candidates)).toThrow();
    expect(() => projectFactEvents(valid.map((event) => ({ ...event, payload: { decision: { ...decision, fact_id: "other" }, fact } })), candidates)).toThrow();
    const opened = make("conflict.opened", { conflict: { ...conflict, id: "conflict-x" } }, { aggregate_id: "conflict-x" });
    const openedProjection = projectFactEvents(opened, candidates);
    expect(openedProjection.conflicts.conflicts).toHaveLength(1);
    const resolved = make("conflict.resolved", { decision: { schema_version: 1, id: "resolve-x", conflict_id: "conflict-x", type: "unresolved", rationale: "x", actor: "user", decided_at: timestamp }, conflict: { ...conflict, id: "conflict-x", resolution_decision_id: "resolve-x" } }, { aggregate_id: "conflict-x", id: "resolve-x" });
    expect(() => projectFactEvents([...opened, ...resolved], candidates)).not.toThrow();
    await expect(readHistoricalCandidateIndex(root)).resolves.toBeInstanceOf(Map);
  });
});

it("covers review identity guards and supersede/unresolved resolution branches", async () => {
  const root = await project();
  await storeCandidate(root, candidate("candidate-a", "black"));
  await storeCandidate(root, candidate("candidate-b", "white"));
  const initial = await readFactProjection(root);
  const first = await reviewCandidate(root, {
    decision: reviewDecision("candidate-a", "fact-a", "decision-a"),
    expectedProjectionRevision: initial.register.revision,
  });
  const second = await reviewCandidate(root, {
    decision: reviewDecision("candidate-b", "fact-b", "decision-b"),
    expectedProjectionRevision: first.projection.register.revision,
  });
  const conflict = second.projection.conflicts.conflicts[0]!;
  await expect(resolveConflict(root, {
    decision: { schema_version: 1, id: "missing-conflict", conflict_id: "missing", type: "unresolved", rationale: "missing", actor: "user", decided_at: timestamp },
    expectedProjectionRevision: second.projection.register.revision,
  })).rejects.toMatchObject({ code: "CONFLICT_NOT_FOUND" });
  const superseded = await resolveConflict(root, {
    decision: {
      schema_version: 1,
      id: "supersede-resolution",
      conflict_id: conflict.id,
      type: "supersede",
      accepted_fact_ids: ["fact-a"],
      rejected_fact_ids: ["fact-b"],
      rationale: "prefer exact source",
      actor: "user",
      decided_at: timestamp,
    },
    expectedProjectionRevision: second.projection.register.revision,
    expectedFactRevisions: { "fact-a": 1, "fact-b": 1 },
  });
  expect(superseded.projection.register.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "fact-a", status: "accepted", supersedes: ["fact-b"] }),
    expect.objectContaining({ id: "fact-b", status: "superseded", superseded_by: "fact-a" }),
  ]));
  await expect(resolveConflict(root, {
    decision: {
      schema_version: 1,
      id: "resolved-again",
      conflict_id: conflict.id,
      type: "unresolved",
      rationale: "already resolved",
      actor: "user",
      decided_at: timestamp,
    },
    expectedProjectionRevision: superseded.projection.register.revision,
  })).rejects.toMatchObject({ code: "CONFLICT_ALREADY_RESOLVED" });

  const legacyRoot = await project();
  await storeCandidate(legacyRoot, candidate("candidate-legacy-only", "black"));
  const legacyProjection = await readFactProjection(legacyRoot);
  await expect(migrateCandidateIdentity(legacyRoot, {
    decisionId: "missing-decision",
    expectedProjectionRevision: legacyProjection.register.revision,
    actor: "director",
    occurredAt: timestamp,
  })).rejects.toMatchObject({ code: "FACT_CANDIDATE_BINDING_DECISION_NOT_FOUND" });
  const reviewed = await reviewCandidate(legacyRoot, {
    decision: reviewDecision("candidate-legacy-only", "fact-legacy-only", "decision-legacy-only"),
    expectedProjectionRevision: legacyProjection.register.revision,
  });
  await expect(migrateCandidateIdentity(legacyRoot, {
    decisionId: "decision-legacy-only",
    expectedProjectionRevision: reviewed.projection.register.revision,
    actor: "director",
    occurredAt: timestamp,
  })).rejects.toMatchObject({ code: "FACT_CANDIDATE_IDENTITY_ALREADY_CANONICAL" });
});

it("covers projector missing files, revision integrity, and binding guards", async () => {
  const root = await project();
  await rm(path.join(root, "facts", "candidates"), { recursive: true, force: true });
  await expect(readHistoricalCandidateIndex(root)).resolves.toEqual(new Map());
  await rm(path.join(root, "facts", "register.yaml"), { force: true });
  await expect(readFactProjection(root)).rejects.toMatchObject({ code: "FACT_PROJECTION_INVALID" });

  const integrityRoot = await project();
  const initial = await readFactProjection(integrityRoot);
  await writeFile(path.join(integrityRoot, "facts", "register.yaml"), canonicalYaml({
    ...initial.register,
    revision: `sha256:${"0".repeat(64)}`,
  }), "utf8");
  await expect(verifyFactProjection(integrityRoot)).rejects.toMatchObject({ code: "FACT_PROJECTION_REVISION_MISMATCH" });

  const source = candidate("candidate-binding-guard", "black");
  const candidates = new Map([[source.id, source]]);
  const invalidBinding = appendJournalEvents(verifyJournalText(""), [{
    id: "candidate-identity-binding-invalid",
    kind: "candidate.identity_bound",
    aggregate_id: "decision-invalid",
    actor: "director",
    timestamp,
    payload: { binding: {} },
  } as never]).events;
  expect(() => projectFactEvents(invalidBinding, candidates)).toThrow("binding");

  const unresolved = appendJournalEvents(verifyJournalText(""), [{
    id: "resolve-without-open",
    kind: "conflict.resolved",
    aggregate_id: "conflict-never-opened",
    actor: "user",
    timestamp,
    payload: {
      decision: { schema_version: 1, id: "resolve-without-open", conflict_id: "conflict-never-opened", type: "unresolved", rationale: "keep open", actor: "user", decided_at: timestamp },
      conflict: {
        schema_version: 1,
        id: "conflict-never-opened",
        subject: "alice",
        predicate: "appearance.hair",
        scope: { character_ids: [], extensions: {} },
        valid_time: { extensions: {} },
        members: [],
        status: "open",
        opened_at: timestamp,
        updated_at: timestamp,
        resolution_decision_id: "resolve-without-open",
        extensions: {},
      },
    },
  } as never]).events;
  expect(() => projectFactEvents(unresolved, candidates)).toThrow("conflict.resolved");
});