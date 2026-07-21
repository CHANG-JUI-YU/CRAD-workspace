import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { canonicalJson, computeRevision, initializeProject } from "@card-workspace/project";
import { projectManifestSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveResearchSources,
  controlledFetch,
  deriveResearchSourceFamily,
  extractHtmlText,
  fetchApprovedResearchSources,
  getResearchStatus,
  isPublicAddress,
  listSources,
  registerResearchSources,
  researchBatchSchema,
  researchCandidateSchema,
  type PinnedHttpTransport,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const httpResponse = (body: string | null, init: { status?: number; headers?: Record<string, string> } = {}) => ({
  statusCode: init.status ?? 200,
  headers: init.headers ?? { "content-type": "text/plain" },
  body: Readable.from(body === null ? [] : [Buffer.from(body)]),
});

async function project() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "research-test",
      title: "Research",
      kind: "character_card",
      card: { name: "Research" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
    entryKind: "source_adaptation",
    collaborationMode: "free",
  });
  return projectRoot;
}

const query = {
  work_title: "Example Work",
  character_names: ["Alice"],
  aliases: [],
  language: "en",
  allowed_domains: ["official.example"],
  result_count: 8,
};

describe("model web research contracts", () => {
  it("keeps candidate contracts strict and excludes unsupported source classes", () => {
    const base = {
      id: "candidate-000000000000000000000000",
      url: "https://example.test/alice",
      hostname: "example.test",
      title: "Alice",
      snippet: "metadata",
      relevance_rationale: "bounded result",
      status: "pending",
      source_id: "research-000000000000000000000000",
    };
    expect(researchCandidateSchema.safeParse({ ...base, source_class: "forum" }).success).toBe(false);
    expect(researchCandidateSchema.safeParse({ ...base, source_class: "official", extra: true }).success).toBe(false);
  });

  it("derives stable platform families from URLs", () => {
    expect(deriveResearchSourceFamily(new URL("https://en.wikipedia.org/wiki/Alice"), [])).toBe("platform:wikipedia.org");
    expect(deriveResearchSourceFamily(new URL("https://zh.wikipedia.org/wiki/Alice"), [])).toBe("platform:wikipedia.org");
    expect(deriveResearchSourceFamily(new URL("https://characters.official.example/alice"), ["official.example"])).toBe("official:official.example");
  });

});

describe("controlled web fetch", () => {
  const publicDns = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  const transport = (body: string, headers?: Record<string, string>): PinnedHttpTransport =>
    () => Promise.resolve(httpResponse(body, { ...(headers ? { headers } : {}) }));

  it("rejects private, reserved, mapped, and mixed DNS targets", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(isPublicAddress(address)).toBe(false);
      await expect(controlledFetch({ url: "https://example.test", resolveDns: () => Promise.resolve([{ address, family: address.includes(":") ? 6 : 4 }]), transport: vi.fn() })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    }
    await expect(controlledFetch({
      url: "https://example.test", transport: vi.fn(),
      resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]),
    })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
  });

  it("pins each redirect hop to that hop's validated addresses and limits redirects to three", async () => {
    const requestHop: PinnedHttpTransport = ({ url }) => {
      return Promise.resolve(httpResponse(null, { status: 302, headers: { location: `${url.href.replace(/\/$/u, "")}/next` } }));
    };
    const requestMock = vi.fn(requestHop);
    await expect(controlledFetch({ url: "https://example.test", resolveDns: publicDns, transport: requestMock })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    expect(requestMock).toHaveBeenCalledTimes(4);
    expect(vi.mocked(requestMock).mock.calls[0]![0].addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);

    const redirectPrivate: PinnedHttpTransport = vi.fn(() => Promise.resolve(httpResponse(null, { status: 302, headers: { location: "http://localhost/internal" } })));
    await expect(controlledFetch({
      url: "https://example.test",
      resolveDns: (host) => Promise.resolve([{ address: host === "localhost" ? "127.0.0.1" : "93.184.216.34", family: 4 }]),
      transport: redirectPrivate,
    })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    expect(redirectPrivate).toHaveBeenCalledTimes(1);
  });

  it("enforces DNS deadlines and destroys oversized body streams", async () => {
    await expect(controlledFetch({ url: "https://example.test", resolveDns: () => new Promise(() => {}), transport: vi.fn(), timeoutMs: 10 })).rejects.toMatchObject({ code: "WEB_FETCH_TIMEOUT" });
    await expect(controlledFetch({ url: "https://example.test", resolveDns: publicDns, transport: () => new Promise(() => {}), timeoutMs: 10 })).rejects.toMatchObject({ code: "WEB_FETCH_TIMEOUT" });
    await expect(controlledFetch({ url: "https://example.test", resolveDns: publicDns, transport: transport("binary", { "content-type": "application/octet-stream" }) })).rejects.toMatchObject({ code: "WEB_FETCH_CONTENT_UNSUPPORTED" });
    const body = Readable.from([Buffer.from("This content is larger than ten bytes")]);
    const destroy = vi.spyOn(body, "destroy");
    await expect(controlledFetch({ url: "https://example.test", resolveDns: publicDns, maxBytes: 10, transport: () => Promise.resolve({ statusCode: 200, headers: { "content-type": "text/plain" }, body }) })).rejects.toMatchObject({ code: "WEB_FETCH_TOO_LARGE" });
    expect(destroy).toHaveBeenCalled();
  });

  it("fails closed on transport errors", async () => {
    await expect(controlledFetch({
      url: "https://example.test",
      resolveDns: publicDns,
      transport: () => Promise.reject(new Error("socket failed")),
    })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
  });

  it("extracts conservative HTML without scripts, comments, or tags", async () => {
    const html = "<!-- hidden --><style>bad</style><script>steal()</script><main>Alice &amp; Bob have stable source text.</main>";
    expect(extractHtmlText(html)).toBe("Alice & Bob have stable source text.");
    const fetched = await controlledFetch({ url: "https://example.test", resolveDns: publicDns, transport: transport(html, { "content-type": "text/html; charset=utf-8" }) });
    expect(fetched.bytes.toString()).toBe("Alice & Bob have stable source text.");
  });
});

describe("research registry and snapshot bridge", () => {
  it("keeps deterministic immutable revisions, exact approval, lineage, and fetch idempotency", async () => {
    const projectRoot = await project();
    const results = [
      { title: "Official Alice", url: "https://official.example/alice#bio", snippet: "snippet is not evidence", language: "en" },
      { title: "Forum", url: "https://forum.example/alice", snippet: "excluded", language: "en" },
      { title: "Alice Wiki", url: "https://alice.fandom.com/wiki/Alice", snippet: "wiki metadata", language: "ja" },
    ];
    const first = await registerResearchSources({ projectRoot, query, results, now: () => new Date("2026-07-18T00:00:00Z") });
    const repeated = await registerResearchSources({ projectRoot, query, results, now: () => new Date("2026-07-19T00:00:00Z") });
    const differentCandidateLanguage = await registerResearchSources({
      projectRoot,
      query,
      results: results.map((result) => result.url.includes("official.example") ? { ...result, language: "de" } : result),
      now: () => new Date("2026-07-19T00:00:00Z"),
    });
    expect(repeated).toEqual(first);
    expect(differentCandidateLanguage.id).not.toBe(first.id);
    expect(first.provider).toBe("model_web");
    expect(researchBatchSchema.safeParse({ ...first, provider: "brave" }).success).toBe(true);
    expect(first.candidates).toHaveLength(2);
    expect(first.candidates.map((item) => item.source_class)).toEqual(["wiki", "official"]);
    expect(first.candidates.map((item) => item.language)).toEqual(["ja", "en"]);
    expect(first.candidates.map((item) => item.source_family_id)).toEqual(["platform:fandom.com", "official:official.example"]);

    const candidate = first.candidates.find((item) => item.source_class === "official")!;
    const approved = await approveResearchSources({
      projectRoot,
      batchId: first.id,
      expectedRevision: first.revision,
      approvedCandidateIds: [candidate.id],
      decisionId: "approve-official",
      actor: "director",
      decidedAt: "2026-07-18T00:01:00Z",
      singleFamilyFallback: true,
      singleFamilyFallbackReason: "No second suitable family is available for this focused fetch.",
    });
    expect(approved.batch.revision).not.toBe(first.revision);
    expect(approved.batch.approvals.at(-1)).toMatchObject({
      single_family_fallback: true,
      single_family_fallback_reason: "No second suitable family is available for this focused fetch.",
    });
    await expect(approveResearchSources({
      projectRoot,
      batchId: first.id,
      expectedRevision: first.revision,
      approvedCandidateIds: [candidate.id],
      decisionId: "stale",
      actor: "director",
      decidedAt: "2026-07-18T00:02:00Z",
      singleFamilyFallback: true,
      singleFamilyFallbackReason: "No second suitable family is available.",
    })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_REVISION_CONFLICT" });
    await expect(approveResearchSources({
      projectRoot,
      batchId: first.id,
      expectedRevision: approved.batch.revision,
      approvedCandidateIds: ["candidate-000000000000000000000000"],
      decisionId: "unknown",
      actor: "director",
      decidedAt: "2026-07-18T00:02:00Z",
      singleFamilyFallback: false,
    })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_CANDIDATE_UNKNOWN" });
    await expect(approveResearchSources({
      projectRoot,
      batchId: first.id,
      expectedRevision: approved.batch.revision,
      approvedCandidateIds: [candidate.id],
      decisionId: "idempotent",
      actor: "director",
      decidedAt: "2026-07-18T00:03:00Z",
      singleFamilyFallback: true,
      singleFamilyFallbackReason: "No second suitable family is available for this focused fetch.",
    })).resolves.toMatchObject({ idempotent: true });

    const pageTransport: PinnedHttpTransport = vi.fn(() => Promise.resolve(httpResponse("Alice has an official biography with enough source text.")));
    const fetched = await fetchApprovedResearchSources({
      projectRoot,
      batchId: first.id,
      actor: "source-researcher",
      transport: pageTransport,
      resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      now: () => new Date("2026-07-18T00:04:00Z"),
    });
    expect(fetched.results).toHaveLength(1);
    expect(fetched.batch.candidates.find((item) => item.id === candidate.id)).toMatchObject({ status: "fetched", requested_url: candidate.url, final_url: candidate.url });
    expect(await listSources(projectRoot)).toMatchObject([{ id: candidate.source_id, tier: "official" }]);
    const retried = await fetchApprovedResearchSources({ projectRoot, batchId: first.id, actor: "source-researcher", transport: pageTransport, resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]) });
    expect(retried.results).toEqual([]);
    expect(pageTransport).toHaveBeenCalledTimes(1);
    expect((await getResearchStatus(projectRoot, first.id)).revision).toBe(fetched.batch.revision);
  });

  it("filters supported candidates before applying result_count and enforces family and official approval", async () => {
    const projectRoot = await project();
    const batch = await registerResearchSources({
      projectRoot,
      query: { ...query, result_count: 2 },
      results: [
        { title: "Unsupported", url: "https://forum.example/alice", snippet: "skip", language: "en" },
        { title: "Official", url: "https://official.example/alice", snippet: "official", language: "en" },
        { title: "Wikipedia", url: "https://zh.wikipedia.org/wiki/Alice", snippet: "encyclopedia", language: "zh-Hant" },
      ],
    });
    expect(batch.candidates).toHaveLength(2);
    const official = batch.candidates.find((candidate) => candidate.source_class === "official")!;
    const wikipedia = batch.candidates.find((candidate) => candidate.source_family_id === "platform:wikipedia.org")!;

    await expect(approveResearchSources({
      projectRoot,
      batchId: batch.id,
      expectedRevision: batch.revision,
      approvedCandidateIds: [wikipedia.id],
      decisionId: "missing-official",
      actor: "director",
      decidedAt: "2026-07-18T01:00:00Z",
      singleFamilyFallback: true,
      singleFamilyFallbackReason: "Only one family",
    })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_OFFICIAL_REQUIRED" });

    await expect(approveResearchSources({
      projectRoot,
      batchId: batch.id,
      expectedRevision: batch.revision,
      approvedCandidateIds: [official.id],
      decisionId: "missing-diversity",
      actor: "director",
      decidedAt: "2026-07-18T01:01:00Z",
      singleFamilyFallback: false,
    })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_DIVERSITY_REQUIRED" });

    await expect(approveResearchSources({
      projectRoot,
      batchId: batch.id,
      expectedRevision: batch.revision,
      approvedCandidateIds: [official.id, wikipedia.id],
      decisionId: "diverse",
      actor: "director",
      decidedAt: "2026-07-18T01:02:00Z",
      singleFamilyFallback: false,
    })).resolves.toMatchObject({ idempotent: false });
  });

  it("rejects a final redirect into a different source family", async () => {
    const projectRoot = await project();
    const batch = await registerResearchSources({
      projectRoot,
      query,
      results: [{ title: "Official", url: "https://official.example/alice", snippet: "official", language: "en" }],
    });
    const approved = await approveResearchSources({
      projectRoot,
      batchId: batch.id,
      expectedRevision: batch.revision,
      approvedCandidateIds: [batch.candidates[0]!.id],
      decisionId: "fallback",
      actor: "director",
      decidedAt: "2026-07-18T02:00:00Z",
      singleFamilyFallback: true,
      singleFamilyFallbackReason: "No independent second source exists.",
    });
    const pageTransport: PinnedHttpTransport = vi.fn()
      .mockResolvedValueOnce(httpResponse(null, { status: 302, headers: { location: "https://en.wikipedia.org/wiki/Alice" } }))
      .mockResolvedValueOnce(httpResponse("Alice has enough final redirected source text."));
    await expect(fetchApprovedResearchSources({
      projectRoot,
      batchId: approved.batch.id,
      actor: "source-researcher",
      transport: pageTransport,
      resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_FAMILY_REDIRECT_MISMATCH" });
    expect(await listSources(projectRoot)).toEqual([]);
  });

  it("reads legacy batches without family or candidate language using runtime derivation", async () => {
    const projectRoot = await project();
    const current = await registerResearchSources({
      projectRoot,
      query,
      results: [{ title: "Official", url: "https://official.example/alice", snippet: "official", language: "fr" }],
    });
    const legacyCandidates = current.candidates.map((candidate) => {
      const legacy = { ...candidate };
      delete legacy.source_family_id;
      delete legacy.language;
      return legacy;
    });
    const legacyContent = {
      schema_version: current.schema_version,
      id: current.id,
      provider: current.provider,
      query: current.query,
      candidates: legacyCandidates,
      approvals: current.approvals,
      created_at: current.created_at,
      updated_at: current.updated_at,
    };
    const revision = computeRevision(legacyContent);
    const revisionPath = `sources/research/${current.id}/${revision.slice("sha256:".length)}.json`;
    await writeFile(path.join(projectRoot, revisionPath), canonicalJson({ ...legacyContent, revision }), "utf8");
    await writeFile(path.join(projectRoot, `sources/research/${current.id}/current.json`), canonicalJson({
      schema_version: 1,
      batch_id: current.id,
      revision,
      revision_path: revisionPath,
    }), "utf8");

    const legacy = await getResearchStatus(projectRoot, current.id);
    expect(legacy.candidates[0]).toMatchObject({ source_family_id: "official:official.example", language: query.language });
  });
});
