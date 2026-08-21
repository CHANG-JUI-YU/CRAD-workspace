import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type FactReviewDecisionRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const NOW = "2026-08-21T00:00:00.000Z";

function recordedPrecheck(projectId: string): BlueprintPrecheckRecord {
  const candidateBlueprint = {
    schema_version: 1,
    project_id: projectId,
    flow: "character",
    primary_character_id: "a",
    world: { enabled: true, authoring_timing: "after_characters" },
    characters: [
      { id: "a", label: "Alice", aliases: ["Alicia"], ordinal: 1, mode: "zhuji" },
      { id: "b", label: "Bob", aliases: ["Bobby"], ordinal: 2, mode: "zhuji" },
      { id: "c", label: "Carol", aliases: [], ordinal: 3, mode: "zhuji" },
    ],
    relationships: { enabled: true },
  };
  return {
    id: `precheck-${projectId}`,
    schema_version: 1,
    project_id: projectId,
    operation_id: "audit14-issue225",
    collaboration_mode: "assisted",
    candidate_blueprint: candidateBlueprint,
    candidate_blueprint_revision: contentHash(JSON.stringify(candidateBlueprint)),
    checks: [{
      subject_id: "a",
      dimension: "character_core",
      uncertainty: "low",
      impact: "low",
      basis: "Explicit roster for unresolved fact context regression.",
      action: "preserve_explicit",
    }],
    status: "recorded",
    created_at: NOW,
    created_by: "director",
  };
}

function fact(
  id: string,
  status: FactRecord["status"],
  entityRefs: string[],
  classification: FactRecord["classification"] = "trait",
  coverage: string[] = ["personality"],
): FactRecord {
  return {
    id,
    candidate_occurrence_id: `occ-${id}`,
    statement: `${id} statement`,
    subject: entityRefs[0],
    predicate: "has_property",
    value: id,
    classification,
    entity_refs: entityRefs,
    coverage,
    status,
    confidence: 0.8,
    source_ids: [],
    evidence: [],
    created_at: NOW,
    updated_at: NOW,
    created_by: "fact-curator",
  };
}

function decision(
  id: string,
  factId: string,
  value: FactReviewDecisionRecord["decision"],
  reason: string,
): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id,
    operation_id: `op-${id}`,
    review_run_id: "run-issue225",
    candidate_occurrence_id: `occ-${factId}`,
    fact_id: factId,
    reviewer_identity: "fact-reviewer-1",
    decision: value,
    reason,
    evidence: [],
    candidate_revision: contentHash(`${factId}:candidate`),
    expected_projection_revision: contentHash(`${factId}:projection`),
    created_at: NOW,
  };
}

async function seededRuntime() {
  const repository = new MemoryProjectRepository("issue225-runtime");
  await repository.commit(0, (state) => ({
    ...state,
    blueprint_prechecks: [recordedPrecheck("issue225-runtime")],
    facts: [
      fact("accepted-a", "accepted", ["a"]),
      fact("candidate-a", "candidate", ["a"]),
      fact("needs-a", "candidate", ["a"]),
      fact("conflict-a", "conflict", ["a"]),
      fact("rejected-a", "rejected", ["a"]),
      fact("candidate-b", "candidate", ["b"]),
      fact("candidate-c", "candidate", ["c"]),
      fact("world-open", "candidate", [], "world", ["world_context"]),
    ],
    fact_review_decisions: [
      decision("decision-needs-old", "needs-a", "conflict", "Older review state."),
      decision("decision-needs-latest", "needs-a", "needs_evidence", "Need a primary source quote."),
    ],
  }));
  return { repository, runtime: new WorkspaceRuntime(repository) };
}

function ids(items: readonly FactRecord[] | undefined): string[] {
  return (items ?? []).map((item) => item.id);
}

describe("#225 unresolved facts in Creator context", () => {
  it("partitions accepted, unresolved, and rejected facts and traces latest needs_evidence", async () => {
    const { repository, runtime } = await seededRuntime();
    const first = (await runtime.templateContext("director_routing")).context.knowledge!;

    expect(ids(first.accepted_facts)).toEqual(["accepted-a"]);
    expect(ids(first.unresolved_facts)).toEqual(["candidate-a", "needs-a", "conflict-a", "candidate-b", "candidate-c", "world-open"]);
    expect(ids(first.unresolved_facts)).not.toContain("rejected-a");
    expect(first.unresolved_fact_reviews).toEqual([
      { fact_id: "candidate-a", candidate_occurrence_id: "occ-candidate-a", state: "pending_review" },
      {
        fact_id: "needs-a",
        candidate_occurrence_id: "occ-needs-a",
        state: "needs_evidence",
        latest_decision: {
          id: "decision-needs-latest",
          review_run_id: "run-issue225",
          reviewer_identity: "fact-reviewer-1",
          decision: "needs_evidence",
          reason: "Need a primary source quote.",
          created_at: NOW,
        },
      },
      { fact_id: "conflict-a", candidate_occurrence_id: "occ-conflict-a", state: "conflict" },
      { fact_id: "candidate-b", candidate_occurrence_id: "occ-candidate-b", state: "pending_review" },
      { fact_id: "candidate-c", candidate_occurrence_id: "occ-candidate-c", state: "pending_review" },
      { fact_id: "world-open", candidate_occurrence_id: "occ-world-open", state: "pending_review" },
    ]);

    const beforeRevision = first.fact_register_revision;
    const current = await repository.read();
    await repository.commit(current.revision, (state) => ({
      ...state,
      facts: state.facts.map((item) => item.id === "candidate-a"
        ? { ...item, status: "accepted" as const, updated_at: "2026-08-21T00:01:00.000Z" }
        : item),
    }));

    const second = (await runtime.templateContext("director_routing")).context.knowledge!;
    expect(ids(second.accepted_facts)).toEqual(["accepted-a", "candidate-a"]);
    expect(ids(second.unresolved_facts)).not.toContain("candidate-a");
    expect(second.unresolved_fact_reviews?.some((item) => item.fact_id === "candidate-a")).toBe(false);
    expect(second.fact_register_revision).not.toBe(beforeRevision);
  });

  it("uses the same entity scope for accepted and unresolved facts", async () => {
    const { runtime } = await seededRuntime();

    const character = (await runtime.templateContext("character", { character_id: "a" })).context.knowledge!;
    expect(ids(character.accepted_facts)).toEqual(["accepted-a"]);
    expect(ids(character.unresolved_facts)).toEqual(["candidate-a", "needs-a", "conflict-a", "world-open"]);
    expect(character.unresolved_fact_reviews?.map((item) => item.fact_id)).toEqual(ids(character.unresolved_facts));

    const relationship = (await runtime.templateContext("relationships", { participant_ids: ["a", "b"] })).context.knowledge!;
    expect(ids(relationship.accepted_facts)).toEqual(["accepted-a"]);
    expect(ids(relationship.unresolved_facts)).toEqual(["candidate-a", "needs-a", "conflict-a", "candidate-b"]);
    expect(relationship.unresolved_fact_reviews?.map((item) => item.fact_id)).toEqual(ids(relationship.unresolved_facts));

    const greeting = (await runtime.templateContext("greetings", { participant_ids: ["b"] })).context.knowledge!;
    expect(ids(greeting.accepted_facts)).toEqual([]);
    expect(ids(greeting.unresolved_facts)).toEqual(["candidate-b"]);

    const world = (await runtime.templateContext("world")).context.knowledge!;
    expect(ids(world.accepted_facts)).toEqual([]);
    expect(ids(world.unresolved_facts)).toEqual(["world-open"]);
  });
});
