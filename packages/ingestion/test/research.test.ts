import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

import { canonicalJson, computeRevision, initializeProject } from "@card-workspace/project";
import { projectManifestSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveResearchSources,
  controlledFetch,
  defaultPinnedHttpTransport,
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

  it("covers public address families and entity decoding edge cases", () => {
    for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.0.1", "192.168.0.1", "192.88.99.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:192.168.0.1", "::ffff:c000:0201"]) expect(isPublicAddress(address)).toBe(false);
    for (const address of ["93.184.216.34", "2001:4860:4860::8888", "::ffff:5db8:d822"]) expect(isPublicAddress(address)).toBe(true);
    expect(extractHtmlText("<p>A &amp; B &#65; &#x42; &unknown;</p> and enough body text here")).toContain("A & B A B");
    expect(() => extractHtmlText("<script>short</script>")).toThrow("no usable");
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
  it("covers source family classification and controlled fetch response guards", async () => {
    expect(deriveResearchSourceFamily(new URL("https://www.britannica.com/topic/alice"), [])).toBe("platform:britannica.com");
    expect(deriveResearchSourceFamily(new URL("https://fandom.com/wiki/Alice"), [])).toBe("platform:fandom.com");
    expect(deriveResearchSourceFamily(new URL("https://wikia.org/alice"), [])).toBe("platform:wikia.org");
    expect(deriveResearchSourceFamily(new URL("https://alice.wiki.example/page"), [])).toBe("platform:alice.wiki.example");
    expect(deriveResearchSourceFamily(new URL("https://unknown.example/page"), [])).toBeUndefined();

    const good = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
    await expect(controlledFetch({ url: "ftp://example.test", resolveDns: good, transport: vi.fn() })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    await expect(controlledFetch({ url: "https://user:pass@example.test", resolveDns: good, transport: vi.fn() })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    await expect(controlledFetch({ url: "https://example.test", resolveDns: () => Promise.resolve([]), transport: vi.fn() })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    await expect(controlledFetch({ url: "https://example.test", resolveDns: () => Promise.reject(new Error("dns")), transport: vi.fn() })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => Promise.resolve(httpResponse("not found", { status: 404 })) })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
    await expect(controlledFetch({ url: "https://example.test", resolveDns: good, maxBytes: 10, transport: () => Promise.resolve(httpResponse("small", { headers: { "content-type": "text/plain", "content-length": "100" } })) })).rejects.toMatchObject({ code: "WEB_FETCH_TOO_LARGE" });
    const stringBody = Readable.from(["This is a sufficiently long plain response body."]);
    const fetched = await controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => Promise.resolve({ statusCode: 200, headers: { "content-type": "text/plain" }, body: stringBody }) });
    expect(fetched.mediaType).toBe("text/plain");
    await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => Promise.resolve(httpResponse("short")) })).rejects.toMatchObject({ code: "WEB_FETCH_CONTENT_UNSUPPORTED" });
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

  it("allows an explicitly audited exclusion of official candidates", async () => {
    const projectRoot = await project();
    const batch = await registerResearchSources({
      projectRoot,
      query,
      results: [
        { title: "Official", url: "https://official.example/alice", snippet: "official", language: "en" },
        { title: "Wikipedia", url: "https://zh.wikipedia.org/wiki/Alice", snippet: "encyclopedia", language: "zh-Hant" },
        { title: "Fandom", url: "https://alice.fandom.com/wiki/Alice", snippet: "wiki", language: "en" },
      ],
    });
    const nonOfficial = batch.candidates.filter((candidate) => candidate.source_class !== "official");
    expect(nonOfficial).toHaveLength(2);

    const approved = await approveResearchSources({
      projectRoot,
      batchId: batch.id,
      expectedRevision: batch.revision,
      approvedCandidateIds: nonOfficial.map((candidate) => candidate.id),
      decisionId: "exclude-official",
      actor: "director",
      decidedAt: "2026-07-18T02:00:00Z",
      singleFamilyFallback: false,
      officialExclusion: true,
      officialExclusionReason: "Official candidates are unavailable through the controlled fetch transport.",
    });
    expect(approved.idempotent).toBe(false);
    expect(approved.batch.approvals.at(-1)).toMatchObject({
      official_exclusion: true,
      official_exclusion_reason: "Official candidates are unavailable through the controlled fetch transport.",
    });

    await expect(approveResearchSources({
      projectRoot,
      batchId: batch.id,
      expectedRevision: approved.batch.revision,
      approvedCandidateIds: nonOfficial.map((candidate) => candidate.id),
      decisionId: "exclude-official-replay",
      actor: "director",
      decidedAt: "2026-07-18T02:01:00Z",
      singleFamilyFallback: false,
      officialExclusion: true,
      officialExclusionReason: "Official candidates are unavailable through the controlled fetch transport.",
    })).resolves.toMatchObject({ idempotent: true });
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

it("covers research pointer corruption, approval fallback guards, and redirect headers", async () => {
  const projectRoot = await project();
  const batch = await registerResearchSources({ projectRoot, query, results: [{ title: "Official", url: "https://official.example/a", snippet: "s", language: "en" }] });
  await expect(approveResearchSources({ projectRoot, batchId: batch.id, expectedRevision: batch.revision, approvedCandidateIds: [batch.candidates[0]!.id], decisionId: "blank-fallback", actor: "director", decidedAt: "2026-07-20T00:00:00Z", singleFamilyFallback: true, singleFamilyFallbackReason: "   " })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_DIVERSITY_REQUIRED" });
  await expect(fetchApprovedResearchSources({ projectRoot, batchId: batch.id, actor: "source-researcher", transport: vi.fn(), resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]) })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_NOT_APPROVED" });
  await writeFile(path.join(projectRoot, `sources/research/${batch.id}/current.json`), JSON.stringify({ schema_version: 1, batch_id: "other", revision: batch.revision, revision_path: `sources/research/${batch.id}/${batch.revision.slice("sha256:".length)}.json` }), "utf8");
  await expect(getResearchStatus(projectRoot, batch.id)).rejects.toMatchObject({ code: "SOURCE_RESEARCH_BATCH_NOT_FOUND" });

  const headersTransport: PinnedHttpTransport = () => Promise.resolve({ statusCode: 302, headers: { location: ["http://localhost/unsafe"] }, body: Readable.from([]) });
  await expect(controlledFetch({ url: "https://example.test", transport: headersTransport, resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]) })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
  const missingLocation: PinnedHttpTransport = () => Promise.resolve({ statusCode: 302, headers: {}, body: Readable.from([]) });
  await expect(controlledFetch({ url: "https://example.test", transport: missingLocation, resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]) })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
});
it("covers research classification, fetch headers, and DNS identity guards", async () => {
  const projectRoot = await project();
  const registered = await registerResearchSources({
    projectRoot,
    query: { ...query, result_count: 1 },
    results: [
      { title: "skip", url: "not-a-url", snippet: "skip", language: "en" },
      { title: " ", url: "https://www.britannica.com/alice", snippet: "encyclopedia", language: "en" },
      { title: "wiki", url: "https://alice.wiki.example/page", snippet: "wiki", language: "en" },
    ],
  });
  expect(registered.candidates).toHaveLength(1);
  expect(registered.candidates[0]?.source_class).toBe("encyclopedia");

  const good = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  const body = (headers: Record<string, string> = { "content-type": "text/plain" }) =>
    Promise.resolve({ statusCode: 200, headers, body: Readable.from(["A sufficiently long body for controlled fetch tests."]) });
  await expect(controlledFetch({ url: "https://example.test", resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 6 }]), transport: vi.fn() })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
  await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => body({}) })).rejects.toMatchObject({ code: "WEB_FETCH_CONTENT_UNSUPPORTED" });
  await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => body({ "content-type": "text/plain", "content-length": "not-a-number" }) })).resolves.toMatchObject({ mediaType: "text/plain" });
  await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => Promise.resolve(httpResponse(null, { status: 302, headers: { location: "https://user:pass@example.test/unsafe" } })) })).rejects.toMatchObject({ code: "WEB_FETCH_TARGET_DENIED" });
  await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => Promise.resolve(httpResponse("short", { status: 204 })) })).rejects.toMatchObject({ code: "WEB_FETCH_CONTENT_UNSUPPORTED" });
  await expect(controlledFetch({ url: "https://example.test", resolveDns: good, transport: () => Promise.resolve(httpResponse("")) })).rejects.toMatchObject({ code: "WEB_FETCH_CONTENT_UNSUPPORTED" });
});
it("covers research pointer integrity, invalid address parsing, transport bodies, and fallback guards", async () => {
  const projectRoot = await project();
  const batch = await registerResearchSources({
    projectRoot,
    query,
    results: [{ title: "Official", url: "https://official.example/alice", snippet: "official", language: "en" }],
  });
  const revisionPath = "sources/research/" + batch.id + "/" + batch.revision.slice("sha256:".length) + ".json";
  const pointerPath = path.join(projectRoot, "sources", "research", batch.id, "current.json");
  await writeFile(pointerPath, canonicalJson({
    schema_version: 1,
    batch_id: batch.id,
    revision: "sha256:" + "0".repeat(64),
    revision_path: revisionPath,
  }), "utf8");
  await expect(getResearchStatus(projectRoot, batch.id)).rejects.toMatchObject({ code: "SOURCE_RESEARCH_BATCH_INVALID" });
  await writeFile(pointerPath, canonicalJson({
    schema_version: 1,
    batch_id: batch.id,
    revision: batch.revision,
    revision_path: revisionPath,
  }), "utf8");
  await writeFile(path.join(projectRoot, revisionPath), canonicalJson({ ...batch, updated_at: "2026-07-21T00:00:00.000Z" }), "utf8");
  await expect(getResearchStatus(projectRoot, batch.id)).rejects.toMatchObject({ code: "SOURCE_RESEARCH_BATCH_INVALID" });

  for (const address of ["not-an-ip", "1.2.3", "999.1.1.1", "::ffff:999.1.1.1"]) {
    expect(isPublicAddress(address)).toBe(false);
  }
  await expect(defaultPinnedHttpTransport({
    url: new URL("https://example.test"),
    addresses: [],
    signal: new AbortController().signal,
  })).rejects.toThrow("validated address");

  const faultyBody = Readable.from((async function* () {
    await Promise.resolve();
    yield Buffer.from("A sufficiently long body for controlled fetch tests.");
    throw new Error("stream failure");
  })());
  await expect(controlledFetch({
    url: "https://example.test",
    resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    transport: () => Promise.resolve({ statusCode: 200, headers: { "content-type": "text/plain" }, body: faultyBody }),
  })).rejects.toThrow("stream failure");

  const fallbackBatch = await registerResearchSources({ projectRoot, query: { ...query, work_title: "Fallback" }, results: [{ title: "Official", url: "https://official.example/fallback", snippet: "official", language: "en" }] });
  await expect(approveResearchSources({
    projectRoot,
    batchId: fallbackBatch.id,
    expectedRevision: fallbackBatch.revision,
    approvedCandidateIds: [fallbackBatch.candidates[0]!.id],
    decisionId: "reason-without-fallback",
    actor: "director",
    decidedAt: "2026-07-21T00:01:00.000Z",
    singleFamilyFallback: false,
    singleFamilyFallbackReason: "reason is ignored unless fallback is enabled",
  })).rejects.toMatchObject({ code: "SOURCE_RESEARCH_DIVERSITY_REQUIRED" });
});


it("covers every reserved IPv4 range and runtime candidate defaults", async () => {
  const safe = ["1.1.1.1", "100.63.0.1", "169.1.0.1", "172.15.0.1", "192.1.0.1", "192.88.98.1", "198.17.0.1", "198.20.0.1", "203.0.112.1"];
  for (const address of safe) expect(isPublicAddress(address)).toBe(true);
  const denied = ["100.64.0.1", "169.254.0.1", "172.16.0.1", "192.0.0.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1"];
  for (const address of denied) expect(isPublicAddress(address)).toBe(false);

  const projectRoot = await project();
  const current = await registerResearchSources({
    projectRoot,
    query,
    results: [{ title: "Official", url: "https://official.example/defaults", snippet: "official", language: "en" }],
  });
  const legacyContent = {
    schema_version: current.schema_version,
    id: current.id,
    provider: current.provider,
    query: current.query,
    candidates: current.candidates.map((candidate) => ({ ...candidate, source_family_id: undefined, language: undefined })),
    approvals: current.approvals,
    created_at: current.created_at,
    updated_at: current.updated_at,
  };
  const revision = computeRevision(legacyContent);
  const legacyRevisionPath = "sources/research/" + current.id + "/" + revision.slice("sha256:".length) + ".json";
  await writeFile(path.join(projectRoot, legacyRevisionPath), canonicalJson({ ...legacyContent, revision }), "utf8");
  await writeFile(path.join(projectRoot, "sources/research/" + current.id + "/current.json"), canonicalJson({
    schema_version: 1, batch_id: current.id, revision, revision_path: legacyRevisionPath,
  }), "utf8");
  expect((await getResearchStatus(projectRoot, current.id)).candidates[0]).toMatchObject({
    source_family_id: "official:official.example", language: query.language,
  });
});


it("covers default HTTP transport protocol branches and entity fallbacks", async () => {
  const controller = new AbortController();
  await expect(defaultPinnedHttpTransport({
    url: new URL("http://127.0.0.1:1"),
    addresses: [{ address: "127.0.0.1", family: 4 }],
    signal: controller.signal,
  })).rejects.toBeDefined();
  const aborted = new AbortController();
  aborted.abort();
  await expect(defaultPinnedHttpTransport({
    url: new URL("http://127.0.0.1:1"),
    addresses: [{ address: "127.0.0.1", family: 4 }],
    signal: aborted.signal,
  })).rejects.toBeDefined();
  expect(extractHtmlText("<p>Known &amp; unknown &mystery; entity text with enough length.</p>"))
    .toContain("&mystery; entity");
});

it("default pinned HTTP transport supports Node all-address lookup callbacks", async () => {
  let receivedUserAgent: string | string[] | undefined;
  let receivedAccept: string | string[] | undefined;
  const server = createServer((request, response) => {
    receivedUserAgent = request.headers["user-agent"];
    receivedAccept = request.headers.accept;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Pinned transport reached the local fixture successfully.");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local fixture did not expose a TCP address");
    const response = await defaultPinnedHttpTransport({
      url: new URL("http://fixture.test:" + address.port + "/"),
      addresses: [{ address: "127.0.0.1", family: 4 }],
      signal: new AbortController().signal,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer);
    expect(response.statusCode).toBe(200);
    expect(receivedUserAgent).toBe("card-workspace/0.1.0 (controlled-fetch)");
    expect(receivedAccept).toContain("text/html");
    expect(Buffer.concat(chunks).toString("utf8")).toContain("Pinned transport reached");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

it("covers research runtime defaults, rejection states, and pinned protocol paths", async () => {
  const projectRoot = await project();
  const batch = await registerResearchSources({
    projectRoot,
    query: { ...query, result_count: 2 },
    results: [
      { title: "Official", url: "https://official.example/runtime", snippet: "official", language: "en" },
      { title: "Wiki", url: "https://alice.fandom.com/wiki/Runtime", snippet: "wiki", language: "en" },
    ],
  });
  const official = batch.candidates.find((candidate) => candidate.source_class === "official")!;
  const approved = await approveResearchSources({
    projectRoot,
    batchId: batch.id,
    expectedRevision: batch.revision,
    approvedCandidateIds: [official.id],
    decisionId: "runtime-approval",
    actor: "director",
    decidedAt: "2026-07-22T00:00:00.000Z",
    singleFamilyFallback: true,
    singleFamilyFallbackReason: "Only one source family is available for this focused check.",
  });
  expect(approved.batch.candidates.some((candidate) => candidate.status === "rejected")).toBe(true);
  expect((await getResearchStatus(projectRoot, batch.id)).candidates.every((candidate) => candidate.source_family_id)).toBe(true);
  expect(isPublicAddress("1.2.3.4")).toBe(true);

  await expect(defaultPinnedHttpTransport({
    url: new URL("http://127.0.0.1:1"),
    addresses: [{ address: "127.0.0.1", family: 4 }],
    signal: new AbortController().signal,
  })).rejects.toBeDefined();
  await expect(defaultPinnedHttpTransport({
    url: new URL("https://127.0.0.1:1"),
    addresses: [{ address: "127.0.0.1", family: 4 }],
    signal: new AbortController().signal,
  })).rejects.toBeDefined();
  await expect(controlledFetch({
    url: "https://example.test",
    resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    timeoutMs: 5,
    transport: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  })).rejects.toMatchObject({ code: "WEB_FETCH_TIMEOUT" });

  const second = await registerResearchSources({
    projectRoot,
    query: { ...query, work_title: "Runtime options" },
    results: [{ title: "Official", url: "https://official.example/options", snippet: "official", language: "en" }],
  });
  const secondApproved = await approveResearchSources({
    projectRoot,
    batchId: second.id,
    expectedRevision: second.revision,
    approvedCandidateIds: [second.candidates[0]!.id],
    decisionId: "runtime-options-approval",
    actor: "director",
    decidedAt: "2026-07-22T00:01:00.000Z",
    singleFamilyFallback: true,
    singleFamilyFallbackReason: "Only one source family is available for this focused check.",
  });
  await fetchApprovedResearchSources({
    projectRoot,
    batchId: secondApproved.batch.id,
    actor: "source-researcher",
    timeoutMs: 1000,
    maxBytes: 1024,
    resolveDns: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    transport: () => Promise.resolve(httpResponse("Runtime options include enough source text for ingestion.")),
  });
});