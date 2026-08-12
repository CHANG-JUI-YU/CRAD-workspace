import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  parseCharacterRoster,
  type ArtifactRecord,
  type FactClaim,
  type OperationRecord,
} from "@st-workspace/core";
import { KnowledgeService, SourceService } from "@st-workspace/domain";
import { WorkspaceRuntime } from "../src/index.js";

const timestamp = "2026-08-12T00:00:00.000Z";

type FixtureRosterEntry = {
  id: string;
  label: string;
  aliases: string[];
  ordinal: number;
};

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  return {
    id,
    kind,
    request: kind,
    status: "running",
    created_at: timestamp,
    updated_at: timestamp,
    progress: [],
  };
}

function rosterFixture(): FixtureRosterEntry[] {
  const parsed = parseCharacterRoster(Array.from({ length: 12 }, (_, index) => `角色${index + 1} (R${index + 1}, 別名${index + 1})`).join("、"));
  return parsed.map((entry, index) => ({
    ...entry,
    aliases: [`R${index + 1}`, `別名${index + 1}`],
  }));
}

function blueprintArtifact(projectId: string, roster: readonly FixtureRosterEntry[]): ArtifactRecord {
  const content = JSON.stringify({
    schema_version: 1,
    kind: "blueprint",
    project_id: projectId,
    flow: "source_adaptation",
    source_adaptation: { subject_name: "十二角色來源改編測試" },
    characters: roster,
    primary_character_id: roster[0]!.id,
  });
  const hash = contentHash(content);
  return {
    id: "artifact-blueprint",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "project-blueprint",
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "director",
    operation_id: "op-interview",
  };
}

function authoringArtifact(id: string, key: string, kind: ArtifactRecord["kind"], value: unknown): ArtifactRecord {
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  return {
    id,
    key,
    kind,
    name: key,
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "fixture",
    operation_id: "op-fixture",
  };
}

function typedClaims(roster: readonly FixtureRosterEntry[]): FactClaim[] {
  const claims: FactClaim[] = [];
  for (const character of roster) {
    claims.push({
      subject: character.aliases[0]!,
      predicate: "has_name",
      value: character.label,
      classification: "identity",
      confidence: 0.95,
      entity_refs: [character.aliases[0]!],
      coverage: ["identity"],
      evidence: [{ source: "roles-html", quote: `${character.aliases[0]} has_name ${character.label}` }],
    });
    for (let index = 1; index <= 3; index += 1) {
      claims.push({
        subject: character.label,
        predicate: `has_trait_${index}`,
        value: `trait-${character.ordinal}-${index}`,
        classification: "trait",
        confidence: 0.9,
        entity_refs: [character.id],
        coverage: ["personality"],
        evidence: [{ source: "roles-html", quote: `${character.label} has_trait_${index} trait-${character.ordinal}-${index}` }],
      });
    }
    for (let index = 1; index <= 2; index += 1) {
      claims.push({
        subject: character.label,
        predicate: `has_event_${index}`,
        value: `background-${character.ordinal}-${index}`,
        classification: "event",
        confidence: 0.88,
        entity_refs: [character.id],
        coverage: ["background"],
        evidence: [{ source: "roles-html", quote: `${character.label} has_event_${index} background-${character.ordinal}-${index}` }],
      });
    }
    for (let index = 1; index <= 2; index += 1) {
      const other = roster[(character.ordinal + index - 1) % roster.length]!;
      claims.push({
        subject: `${character.label} and ${other.label}`,
        predicate: `has_relationship_${index}`,
        value: `relationship-${character.ordinal}-${index}`,
        classification: "relationship",
        confidence: 0.86,
        entity_refs: [character.id, other.id],
        coverage: ["relationships"],
        evidence: [{ source: "roles-html", quote: `${character.label} and ${other.label} has_relationship_${index} relationship-${character.ordinal}-${index}` }],
      });
    }
    for (let index = 1; index <= 2; index += 1) {
      claims.push({
        subject: "世界設定",
        predicate: `has_rule_${character.ordinal}_${index}`,
        value: `world-context-${character.ordinal}-${index}`,
        classification: "world",
        confidence: 0.84,
        coverage: ["world_context"],
        evidence: [{ source: "world-plain", quote: `世界設定 has_rule_${character.ordinal}_${index} world-context-${character.ordinal}-${index}` }],
      });
    }
  }
  return claims;
}

function sourceText(claims: readonly FactClaim[], source: string): string {
  return claims
    .filter((claim) => claim.evidence[0]?.source === source)
    .map((claim) => claim.evidence[0]?.quote ?? "")
    .join("\n");
}

function reviewDecision(candidate: Awaited<ReturnType<KnowledgeService["factReviewContext"]>>["candidates"][number]) {
  const evidence = candidate.evidence_refs?.[0];
  if (evidence === undefined) throw new Error(`Missing evidence reference for ${candidate.fact_id}`);
  return {
    candidate_occurrence_id: candidate.candidate_occurrence_id,
    claim: candidate.statement,
    decision: "accept" as const,
    reason: "Deterministic fixture quote matches the current source revision.",
    evidence: [{ source: evidence.source_id, quote: evidence.quote }],
  };
}

describe("source-adaptation production path", () => {
  it("ingests 12 roles, curates 120 typed facts, reviews by three shards, and scopes authoring context", async () => {
    const projectId = "twelve-role-production-path";
    const roster = rosterFixture();
    const claims = typedClaims(roster);
    expect(roster).toHaveLength(12);
    expect(claims).toHaveLength(120);

    const html = sourceText(claims, "roles-html");
    const plain = sourceText(claims, "world-plain");
    const htmlContent = `<html><head><title>Roles</title><script>discarded()</script></head><body><nav>navigation junk</nav><main><h1>Roles</h1>${html.split("\n").map((line) => `<p>${line}</p>`).join("")}</main><footer>footer junk</footer></body></html>`;
    const repository = new MemoryProjectRepository(projectId);
    await repository.commit(0, (state) => ({
      ...createProjectState(projectId),
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "source_adaptation" },
      artifacts: [
        blueprintArtifact(projectId, roster),
        authoringArtifact("artifact-character", "character:character-1", "character", { kind: "character", document: { id: "character-1", display_name: "角色1" } }),
        authoringArtifact("artifact-relationships", "relationship:team", "relationship", { kind: "relationships", document: { character_ids: ["character-1", "character-2"] } }),
        authoringArtifact("artifact-greetings", "greeting:team", "greeting", { kind: "greetings", document: { greetings: [{ id: "greeting-1", kind: "primary", content: "Welcome", character_ids: ["character-1", "character-2"] }] } }),
        authoringArtifact("artifact-world", "world:setting", "world_lore", { kind: "world", document: { entries: [] } }),
      ],
      candidates: [
        { id: "candidate-html", title: "roles-html", url: "https://fixture.test/roles", status: "approved", media_type: "text/html", content: htmlContent },
        { id: "candidate-html-duplicate", title: "roles-html-duplicate", url: "https://fixture.test/roles", status: "approved", media_type: "text/html", content: htmlContent },
        { id: "candidate-world", title: "world-plain", url: "https://fixture.test/world.txt", status: "approved", media_type: "text/plain", content: plain },
      ],
      operations: [
        operation("op-source", "source"),
        operation("op-curation", "knowledge"),
        operation("op-review", "review"),
      ],
    }));

    const sourceService = new SourceService(repository);
    const sourceResult = await sourceService.execute("op-source", { actor: "source-researcher", attachments: [] });
    expect(sourceResult.status).toBe("completed");
    let state = await repository.read();
    expect(state.sources).toHaveLength(2);
    expect(state.candidates).toHaveLength(3);
    expect(state.candidates.every((candidate) => candidate.status === "ingested")).toBe(true);
    expect(state.sources.some((source) => source.media_type === "text/html")).toBe(true);
    expect(state.sources.some((source) => source.media_type === "text/plain")).toBe(true);
    expect(state.audit.filter((event) => event.event === "source.ingested")).toHaveLength(3);
    expect(state.sources.find((source) => source.media_type === "text/html")?.canonical_text).not.toMatch(/discarded|navigation junk|footer junk/iu);

    const knowledgeService = new KnowledgeService(repository);
    const curation = await knowledgeService.applyCuration("op-curation", claims, "fact-curator");
    expect(curation.status).toBe("completed");
    state = await repository.read();
    expect(state.facts).toHaveLength(120);
    expect(state.facts.every((fact) => fact.status === "candidate" && (fact.entity_refs?.length ?? 0) >= 0)).toBe(true);

    const run = await knowledgeService.beginFactReviewRun("op-review", "fact-reviewer-1");
    const reviewers = ["fact-reviewer-1", "fact-reviewer-2", "fact-reviewer-3"] as const;
    let reviewed = 0;
    for (const reviewer of reviewers) {
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await knowledgeService.factReviewContext({ cursor, limit: 7, reviewer_identity: reviewer });
        pages += 1;
        if (page.candidates.length > 0) {
          const applied = await knowledgeService.applyReviewBatch(
            "op-review",
            page.candidates.map(reviewDecision),
            reviewer,
            reviewer,
            run.id,
            page.projection_revision,
          );
          expect(["completed", "needs_input"]).toContain(applied.status);
          reviewed += applied.applied;
        }
        cursor = page.next_cursor;
      } while (cursor !== undefined);
      expect(pages).toBeGreaterThan(1);
    }

    state = await repository.read();
    expect(reviewed).toBe(120);
    expect(state.facts.every((fact) => fact.status === "accepted")).toBe(true);
    expect(new Set(state.fact_review_decisions.map((decision) => decision.reviewer_identity))).toEqual(new Set(reviewers));
    expect(state.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("completed");

    const runtime = new WorkspaceRuntime(repository);
    const character = (await runtime.templateContext("character")).context.knowledge!;
    const relationships = (await runtime.templateContext("relationships")).context.knowledge!;
    const greetings = (await runtime.templateContext("greetings")).context.knowledge!;
    const world = (await runtime.templateContext("world")).context.knowledge!;
    expect(character.accepted_facts.some((fact) => fact.coverage?.includes("identity"))).toBe(true);
    expect(character.accepted_facts.some((fact) => fact.coverage?.includes("personality"))).toBe(true);
    expect(character.accepted_facts.some((fact) => fact.coverage?.includes("background"))).toBe(true);
    expect(relationships.accepted_facts.some((fact) => fact.coverage?.includes("relationships"))).toBe(true);
    expect(greetings.accepted_facts.some((fact) => fact.coverage?.includes("relationships"))).toBe(true);
    expect(world.accepted_facts.length).toBe(24);
    expect(world.accepted_facts.every((fact) => fact.coverage?.includes("world_context"))).toBe(true);
    expect((await runtime.authoringKnowledgeContext()).accepted_facts).toHaveLength(120);
  });

  it("keeps original no-source authoring context available", async () => {
    const repository = new MemoryProjectRepository("original-no-source");
    const runtime = new WorkspaceRuntime(repository);
    const context = await runtime.templateContext("character");
    expect(context.context.knowledge?.accepted_facts).toEqual([]);
    expect(context.context.knowledge?.sources).toEqual([]);
    expect((await runtime.authoringKnowledgeContext()).accepted_facts).toEqual([]);
  });
});
