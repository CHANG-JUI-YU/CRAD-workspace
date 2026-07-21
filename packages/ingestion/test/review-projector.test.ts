import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  projectFactEvents,
  migrateCandidateIdentity,
  queryFacts,
  readHistoricalCandidateIndex,
  readFactProjection,
  rebuildFactProjection,
  resolveConflict,
  reviewCandidate,
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
});
