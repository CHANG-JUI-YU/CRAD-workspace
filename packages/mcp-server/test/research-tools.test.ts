import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listSources, type PinnedHttpTransport } from "@card-workspace/ingestion";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("Source Research MCP flow", () => {
  it("enforces visibility and runs model candidate registration, exact approval, fetch, manifest, and workflow_start refs", async () => {
    const fixture = await setupMcpWorkspace("research-e2e", "source_adaptation");
    cleanups.push(fixture.workspace.cleanup);
    const pageTransport: PinnedHttpTransport = () => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: Readable.from([Buffer.from("Alice has an official biography with stable source facts.")]),
    });
    const connect = async (agentId: string) => {
      const { server } = await createMcpServer({
        environment: { ...fixture.environment, CARD_WORKSPACE_AGENT_ID: agentId },
        webResearch: { pageTransport, resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]), now: () => new Date("2026-07-18T00:00:00Z") },
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: agentId, version: "1" });
      await client.connect(clientTransport);
      return { client, server };
    };
    const researcher = await connect("source-researcher");
    const director = await connect("director");
    const researcherTools = (await researcher.client.listTools()).tools.map((tool) => tool.name);
    const directorTools = (await director.client.listTools()).tools.map((tool) => tool.name);
    expect(researcherTools).toEqual(expect.arrayContaining(["source_research_submit_candidates", "source_research_status", "source_research_fetch_approved"]));
    expect(researcherTools).not.toContain("source_research_approve");
    expect(directorTools).toEqual(expect.arrayContaining(["source_research_status", "source_research_approve"]));
    expect(directorTools).not.toContain("source_research_submit_candidates");
    expect(directorTools).not.toContain("source_research_fetch_approved");

    interface Candidate { id: string; status: string; source_family_id: string; language: string }
    interface Batch { id: string; revision: string; candidates: Candidate[]; approvals: Array<{ single_family_fallback?: boolean; single_family_fallback_reason?: string }> }
    interface ApprovalResult { batch: Batch }
    interface FetchResult { results: unknown[] }
    interface WorkflowResult { tasks: Array<{ input_artifacts: Array<{ id: string; revision: string }> }> }
    interface Payload<T> { ok?: boolean; result: T; error?: { code?: string } }
    const call = async <T>(client: Client, name: string, args: Record<string, unknown>): Promise<Payload<T>> => {
      const response = await client.callTool({ name, arguments: { project_id: "research-e2e", ...args } });
      return JSON.parse((response.content[0] as { text: string }).text) as Payload<T>;
    };
    const searched = await call<Batch>(researcher.client, "source_research_submit_candidates", {
      work_title: "Example Work",
      character_names: ["Alice"],
      aliases: [],
      language: "en",
      allowed_domains: ["official.example"],
      result_count: 5,
      candidates: [{ title: "Official Alice", url: "https://official.example/alice", snippet: "discovery metadata only", language: "en" }],
    });
    expect(searched.ok).toBe(true);
    expect((searched.result as Batch & { provider: string }).provider).toBe("model_web");
    expect(searched.result.candidates[0]).toMatchObject({ source_family_id: "official:official.example", language: "en" });
    const batch = searched.result;
    const status = await call<Batch>(director.client, "source_research_status", { batch_id: batch.id });
    expect(status.result.revision).toBe(batch.revision);
    const stale = await call<ApprovalResult>(director.client, "source_research_approve", {
      batch_id: batch.id,
      expected_batch_revision: `sha256:${"0".repeat(64)}`,
      approved_candidate_ids: [batch.candidates[0].id],
      decision_id: "stale",
      decided_at: "2026-07-18T00:01:00Z",
      single_family_fallback: true,
      single_family_fallback_reason: "No second suitable family was found.",
    });
    expect(stale.error?.code).toBe("SOURCE_RESEARCH_REVISION_CONFLICT");
    const approved = await call<ApprovalResult>(director.client, "source_research_approve", {
      batch_id: batch.id,
      expected_batch_revision: batch.revision,
      approved_candidate_ids: [batch.candidates[0].id],
      decision_id: "approve-source",
      decided_at: "2026-07-18T00:01:00Z",
      single_family_fallback: true,
      single_family_fallback_reason: "No second suitable family was found.",
    });
    expect(approved.result.batch.candidates[0].status).toBe("approved");
    expect(approved.result.batch.approvals.at(-1)).toMatchObject({ single_family_fallback: true, single_family_fallback_reason: "No second suitable family was found." });
    const fetched = await call<FetchResult>(researcher.client, "source_research_fetch_approved", { batch_id: batch.id });
    expect(fetched.result.results).toHaveLength(1);
    const sources = await listSources(fixture.projectRoot);
    expect(sources).toHaveLength(1);
    const started = await call<WorkflowResult>(director.client, "workflow_start", {
      expected_workflow_revision: 0,
      event_id: "research-start",
      occurred_at: "2026-07-18T00:02:00Z",
      intake_answers: [{ decision_id: "research-intent", question_id: "source", answer: "Use approved official source" }],
      intake_completion: { decision_id: "research-complete", answer: "No additional settings", confirmed_no_additional_settings: true },
    });
    expect(started.result.tasks[0].input_artifacts).toContainEqual({ id: `source-${sources[0]!.id}`, revision: sources[0]!.current_revision_id });

    await researcher.client.close();
    await researcher.server.close();
    await director.client.close();
    await director.server.close();
  });
});
