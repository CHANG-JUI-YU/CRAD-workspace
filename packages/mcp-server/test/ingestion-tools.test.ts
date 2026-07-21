import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { candidateBatchSchema, workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { listSources } from "@card-workspace/ingestion";

import { createMcpServer } from "../src/server.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

interface SourceE2EJob {
  id: string;
  revision: number;
  input_revision: string;
  chunk_set_id: string;
  status: string;
  next_chunk: { chunk_id: string; chunk_hash: string } | null;
}

interface SourceE2ETask {
  id: string;
  kind: string;
  status: string;
  input_artifacts: Array<{ id: string; revision: string }>;
  extensions: { source_jobs: Record<string, { job_id: string }> };
}

interface SourceE2EWorkflow {
  revision: number;
  stage: string;
  tasks: SourceE2ETask[];
  gates: Array<{ id: string; status: string }>;
}

interface SourceE2EResult extends SourceE2EWorkflow {
  job: SourceE2EJob;
  workflow: SourceE2EWorkflow;
  chunk: {
    id: string;
    content: string;
    content_hash: string;
    chunk_set_id: string;
    normalized_character_range: [number, number];
    normalized_line_range: [number, number];
    raw_byte_range?: [number, number];
  };
  completion: { job: SourceE2EJob };
  result: { contract: string };
  unreviewed_candidate_ids: string[];
  fact_projection_revision: string;
  fact_register_revision: string;
  conflict_register_revision: string;
}

describe("Sources/Facts MCP adapters", () => {
  it("passes retrieved bytes to ingestion without exposing URL fetch", async () => {
    const fixture = await setupMcpWorkspace("source-mcp");
    cleanups.push(fixture.workspace.cleanup);
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0,
      eventId: "start-source-processing",
      actor: "engine",
      occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "source_processing" }),
    });
    const { server } = await createMcpServer({ environment: fixture.environment });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "source_intake_retrieved", arguments: {
      project_id: "source-mcp",
      source_id: "source-1",
      title: "Source",
      bytes_base64: Buffer.from("A stable source.").toString("base64"),
      requested_url: "https://example.test/a",
      canonical_url: "https://example.test/a",
      fetched_at: "2026-07-14T00:00:00.000Z",
      media_type: "text/plain",
      extension: ".txt",
      agent_id: "fact-curator",
    } });
    const payload = JSON.parse((response.content[0] as { text: string }).text) as { ok: boolean };
    expect(payload.ok).toBe(true);
    expect(await listSources(fixture.projectRoot)).toMatchObject([{ id: "source-1" }]);
    await client.close();
    await server.close();
  });

  it("runs Source Adaptation from exact source input through the Facts Gate and Blueprint task", async () => {
    const fixture = await setupMcpWorkspace("source-e2e", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const connect = async (agentId: string) => {
      const { server } = await createMcpServer({ environment: { ...fixture.environment, CARD_WORKSPACE_AGENT_ID: agentId } });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: `${agentId}-test`, version: "1" });
      await client.connect(clientTransport);
      return { client, server };
    };
    const director = await connect("director");
    const call = async (client: Client, name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: { project_id: "source-e2e", ...args } });
      const payload = JSON.parse((response.content[0] as { text: string }).text) as {
        ok?: boolean;
        result: SourceE2EResult;
        error?: { code?: string };
      };
      return { response, payload };
    };
    const rawSourceText = "前言\r\nAlice有銀髮😀。\r\n";
    const sourceText = "前言\nAlice有銀髮😀。\n";
    expect((await call(director.client, "source_intake_retrieved", {
      source_id: "novel",
      title: "Novel",
      bytes_base64: Buffer.from(rawSourceText).toString("base64"),
      requested_url: "https://example.test/novel",
      canonical_url: "https://example.test/novel",
      fetched_at: "2027-07-18T00:00:00.000Z",
      media_type: "text/plain",
      extension: ".txt",
    })).payload.ok).toBe(true);
    const started = await call(director.client, "workflow_start", {
      expected_workflow_revision: 0,
      event_id: "source-start",
      occurred_at: "2027-07-18T00:01:00.000Z",
      intake_answers: [{ decision_id: "source-concept", question_id: "concept", answer: "Adapt exact source facts" }],
      intake_completion: { decision_id: "source-intake-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    });
    expect(started.response.isError).not.toBe(true);
    const sourceRef = started.payload.result.tasks[0]!.input_artifacts[0]!;
    expect(sourceRef.id).toBe("source-novel");

    const curator = await connect("fact-curator");
    const claimedTask = await call(curator.client, "task_claim", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      lease_duration_ms: 63_072_000_000,
      expected_workflow_revision: 1,
      event_id: "curation-claimed",
      occurred_at: "2027-07-18T00:02:00.000Z",
    });
    expect(claimedTask.response.isError).not.toBe(true);
    const created = await call(curator.client, "source_create_chunks", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      source_id: sourceRef.id,
      source_revision_id: sourceRef.revision,
      expected_workflow_revision: 2,
      event_id: "novel-job-bound",
      occurred_at: "2027-07-18T00:03:00.000Z",
    });
    expect(created.response.isError).not.toBe(true);
    const job = created.payload.result.job;
    expect(created.payload.result.workflow.tasks[0].extensions.source_jobs.novel.job_id).toBe(job.id);
    const bindingRetry = await call(curator.client, "source_create_chunks", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      source_id: "novel",
      source_revision_id: sourceRef.revision,
      expected_workflow_revision: 2,
      event_id: "novel-job-bound",
      occurred_at: "2027-07-18T00:03:00.000Z",
    });
    expect(bindingRetry.payload.result.workflow.revision).toBe(3);
    const duplicateBinding = await call(curator.client, "source_create_chunks", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      source_id: "novel",
      source_revision_id: sourceRef.revision,
      expected_workflow_revision: 3,
      event_id: "novel-job-bound-again",
      occurred_at: "2027-07-18T00:03:30.000Z",
    });
    expect(duplicateBinding.payload.error?.code).toBe("SOURCE_JOB_BINDING_CONFLICT");
    const chunkTask = job.next_chunk!;
    const chunkClaim = await call(curator.client, "source_get_chunk_task", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      job_id: job.id,
      claim: true,
      chunk_id: chunkTask.chunk_id,
      expected_job_revision: 0,
      chunk_lease_id: "chunk-lease",
      chunk_lease_duration_ms: 3_600_000,
    });
    expect(chunkClaim.response.isError).not.toBe(true);
    const chunk = chunkClaim.payload.result.chunk;
    expect(chunk.content).toBe(sourceText);
    const candidate = {
      schema_version: 1,
      subject: "alice",
      predicate: "appearance.hair",
      value: "silver",
      classification: "source_fact",
      confidence: 1,
      coverage_dimensions: [
        "identity", "appearance", "personality", "speech", "habits", "background", "relationships",
      ],
      scope: { character_ids: ["alice"], extensions: {} },
      valid_time: { extensions: {} },
      evidence: [{
        id: "evidence-alice-hair",
        quote: "Alice有銀髮😀。",
        extensions: {},
      }],
      status: "submitted",
      extensions: {},
    };
    const batch = {
      schema_version: 1 as const,
      source_id: "novel",
      source_revision_id: sourceRef.revision,
      chunk_set_id: chunk.chunk_set_id,
      chunk_id: chunk.id,
      chunk_hash: chunk.content_hash,
      job_id: job.id,
      input_revision: job.input_revision,
      candidates: [candidate],
      created_at: "2027-07-18T00:04:00.000Z",
      extensions: {},
    };
    const submitted = await call(curator.client, "fact_submit_candidates", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      chunk_lease_id: "chunk-lease",
      expected_job_revision: 1,
      batch,
    });
    const submittedResult = submitted.payload.result as {
      batch: { id: string; content_hash: string };
      job: { status: string };
    };
    expect(submittedResult.job.status).toBe("completed");
    expect(submittedResult.batch.id).toMatch(/^batch-/u);
    expect(submittedResult.batch.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const storedBatch = candidateBatchSchema.parse(JSON.parse(await readFile(
      path.join(fixture.projectRoot, "facts", "candidates", `${submittedResult.batch.id}.json`),
      "utf8",
    )));
    expect(storedBatch.candidates[0]!.evidence[0]).toMatchObject({
      source_id: "novel",
      source_revision_id: sourceRef.revision,
      chunk_set_id: chunk.chunk_set_id,
      chunk_id: chunk.id,
      chunk_hash: chunk.content_hash,
      quote: "Alice有銀髮😀。",
      normalized_character_range: [3, 14],
      normalized_line_range: [2, 2],
      raw_byte_range: [8, 29],
    });
    expect(storedBatch.candidates[0]!.created_by).toBe("fact-curator");
    expect(storedBatch.candidates[0]!.id).toMatch(/^candidate-[0-9a-f]{64}$/u);
    const finalized = await call(curator.client, "fact_finalize_curation", {
      task_id: "curate-facts",
      lease_id: "curation-lease",
      result_id: "facts-curation-source-e2e",
      expected_workflow_revision: 3,
      event_id: "curation-finalized",
      occurred_at: "2027-07-18T00:05:00.000Z",
    });
    expect(finalized.payload.error).toBeUndefined();
    expect(finalized.payload.result.workflow.tasks[0].status).toBe("completed");
    expect(finalized.payload.result.result.contract).toBe("facts-curation-summary@1");
    const factsReview = await call(director.client, "workflow_advance", {
      expected_workflow_revision: 4,
      event_id: "facts-review-entered",
      occurred_at: "2027-07-18T00:06:00.000Z",
    });
    expect(factsReview.payload.result.stage).toBe("facts_review");
    const statusBefore = await call(director.client, "facts_review_status", {});
    const statusResult = statusBefore.payload.result as {
      overview: { counts: { unreviewed: number }; revisions: { fact_projection: string; fact_register: string; conflict_register: string } };
      page: { items: Array<{ candidate_id: string }> };
    };
    const activeCandidateId = statusResult.page.items[0]!.candidate_id;
    expect(activeCandidateId).toMatch(/^candidate-occurrence-[0-9a-f]{64}$/u);
    expect(statusResult.overview.counts.unreviewed).toBe(1);
    const inactiveReview = await call(director.client, "fact_review", {
      decision: {
        schema_version: 1,
        id: "review-inactive",
        candidate_id: `candidate-occurrence-${"0".repeat(64)}`,
        fact_id: "fact-inactive",
        type: "rejected",
        rationale: "Not active",
        actor: "director",
        decided_at: "2027-07-18T00:07:00.000Z",
        extensions: {},
      },
      expected_projection_revision: statusResult.overview.revisions.fact_projection,
    });
    expect(inactiveReview.payload.error?.code).toBe("FACT_CANDIDATE_NOT_ACTIVE");
    const incompleteGate = await call(director.client, "workflow_approve_gate", {
      expected_workflow_revision: 5,
      event_id: "facts-gate-too-early",
      occurred_at: "2027-07-18T00:07:00.000Z",
      decision_id: "facts-gate-too-early-decision",
      gate_id: "facts",
      input_revisions: [],
      summary: "Too early",
    });
    expect(incompleteGate.payload.error?.code).toBe("FACTS_REVIEW_INCOMPLETE");
    const reviewed = await call(director.client, "fact_review", {
      decision: {
        schema_version: 1,
        id: "review-alice-hair",
        candidate_id: activeCandidateId,
        fact_id: "fact-alice-hair",
        type: "accepted",
        rationale: "Direct source statement",
        actor: "director",
        decided_at: "2027-07-18T00:08:00.000Z",
        extensions: {},
      },
      expected_projection_revision: statusResult.overview.revisions.fact_projection,
    });
    expect(reviewed.response.isError).not.toBe(true);
    const statusAfter = await call(director.client, "facts_review_status", {});
    const statusAfterResult = statusAfter.payload.result as {
      overview: {
        counts: { unreviewed: number };
        coverage: { gate_ready: boolean };
        gate_ready: boolean;
        revisions: { fact_register: string; conflict_register: string };
      };
    };
    expect(statusAfterResult.overview.counts.unreviewed).toBe(0);
    expect(statusAfterResult.overview.coverage).toMatchObject({ gate_ready: true });
    expect(statusAfterResult.overview.gate_ready).toBe(true);
    const exactRefs = [
      { id: "fact-register", revision: statusAfterResult.overview.revisions.fact_register },
      { id: "conflict-register", revision: statusAfterResult.overview.revisions.conflict_register },
    ];
    const staleGate = await call(director.client, "workflow_approve_gate", {
      expected_workflow_revision: 5,
      event_id: "facts-gate-stale",
      occurred_at: "2027-07-18T00:09:00.000Z",
      decision_id: "facts-gate-stale-decision",
      gate_id: "facts",
      input_revisions: [{ ...exactRefs[0], revision: `sha256:${"0".repeat(64)}` }, exactRefs[1]],
      summary: "Stale",
    });
    expect(staleGate.payload.error?.code).toBe("FACTS_GATE_SNAPSHOT_STALE");
    const approved = await call(director.client, "workflow_approve_gate", {
      expected_workflow_revision: 5,
      event_id: "facts-gate-approved",
      occurred_at: "2027-07-18T00:10:00.000Z",
      decision_id: "facts-gate-approved-decision",
      gate_id: "facts",
      input_revisions: exactRefs,
      summary: "Reviewed exact facts",
    });
    expect(approved.payload.result.gates.find((gate) => gate.id === "facts")?.status).toBe("approved");
    const blueprint = await call(director.client, "workflow_advance", {
      expected_workflow_revision: 6,
      event_id: "blueprint-entered",
      occurred_at: "2027-07-18T00:11:00.000Z",
    });
    expect(blueprint.payload.result).toMatchObject({ stage: "blueprint" });
    const blueprintTask = blueprint.payload.result.tasks.find((task) => task.kind === "create-blueprint");
    expect(blueprintTask?.input_artifacts).toEqual(expect.arrayContaining(exactRefs));

    await curator.client.close();
    await curator.server.close();
    await director.client.close();
    await director.server.close();
  });
});
