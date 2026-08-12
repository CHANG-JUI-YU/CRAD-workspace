import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, CoreError, contentHash, internalId } from "@st-workspace/core";
import { SourceService } from "../src/index.js";

describe("source vertical slice", () => {
  it("approves, normalizes and ingests text candidates without low-level caller parameters", async () => {
    const repository = new MemoryProjectRepository("demo");
    const seeded = await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-1", title: "Yukino official", status: "pending", content: "\uFEFFline 1\r\nline 2" },
      ],
      operations: [{ id: "operation-1", kind: "source", request: "把批准的來源加入專案", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    expect(seeded.revision).toBe(1);
    const service = new SourceService(repository);
    const selection = await service.selectCandidates("operation-1", [{ candidate_id: "candidate-1", decision: "approve" }], "director");
    expect(selection.approved).toEqual(["candidate-1"]);
    const result = await service.execute("operation-1", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    const final = await repository.read();
    expect(final.sources[0]?.canonical_text).toBe("line 1\nline 2");
    expect(final.candidates[0]?.status).toBe("ingested");
    expect(final.sources[0]?.selection_snapshot).toMatchObject({
      operation_id: "operation-1",
      candidate_ids: ["candidate-1"],
      approved_candidate_ids: ["candidate-1"],
      rejected_candidate_ids: [],
      selected_by: "director",
    });
    expect(final.audit.map((event) => event.event)).toEqual(expect.arrayContaining(["source.approved", "source.ingested"]));
  });

  it("canonicalizes HTML through visible title, headings and paragraphs in document order", async () => {
    const repository = new MemoryProjectRepository("html-source");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-html", title: "Official HTML", status: "approved", media_type: "text/html", content: `<!doctype html>
        <html><head><title>Series title</title><style>.junk{display:none}</style><meta name="description" content="metadata" /></head>
        <body><nav>Navigation must not become source text</nav><main><h1>Main heading</h1>
        <p>First paragraph with <strong>inline emphasis</strong>.</p>
        <div hidden>Hidden text must not become source text</div>
        <div class="metadata">Metadata text must not become source text</div>
        <script>window.junk = true;</script><p>Second paragraph.</p></main><footer>Footer junk</footer></body></html>` }],
      operations: [{ id: "op-html", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const result = await new SourceService(repository).execute("op-html", { actor: "researcher", attachments: [] });

    expect(result.status).toBe("completed");
    const source = (await repository.read()).sources[0];
    expect(source?.media_type).toBe("text/html");
    expect(source?.canonical_text).toBe("Series title\nMain heading\nFirst paragraph with inline emphasis.\nSecond paragraph.");
    expect(source?.canonical_text).not.toMatch(/Navigation|Hidden|Metadata|window\.junk|Footer|display:none/iu);
  });

  it("rejects HTML without visible body text and unsupported media types before source creation", async () => {
    const repository = new MemoryProjectRepository("invalid-media-source");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-empty-html", title: "Empty HTML", status: "approved", media_type: "text/html", content: "<html><head><title>Only title</title></head><body><script>junk()</script></body></html>" },
        { id: "candidate-pdf", title: "PDF", status: "approved", media_type: "application/pdf", content: "not a PDF" },
      ],
      operations: [{ id: "op-invalid-media", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const result = await new SourceService(repository).execute("op-invalid-media", { actor: "researcher", attachments: [] });
    const state = await repository.read();

    expect(result.status).toBe("needs_input");
    expect(state.sources).toHaveLength(0);
    expect(state.candidates.map((candidate) => candidate.failure?.code)).toEqual(["SOURCE_EMPTY", "SOURCE_MEDIA_TYPE_UNSUPPORTED"]);
  });

  it("does not ingest an unselected pending candidate", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-selected", title: "Selected", status: "pending", content: "selected content" },
        { id: "candidate-mirror", title: "Mirror", status: "pending", content: "mirror content" },
      ],
      operations: [{ id: "operation-selection", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const service = new SourceService(repository);
    await service.selectCandidates("operation-selection", [{ candidate_id: "candidate-selected", decision: "approve" }, { candidate_id: "candidate-mirror", decision: "reject" }], "director");
    const result = await service.execute("operation-selection", { actor: "director", attachments: [] });
    expect(result.completed).toEqual(["candidate-selected"]);
    expect((await repository.read()).candidates.map((candidate) => candidate.status)).toEqual(["ingested", "rejected"]);
  });

  it("keeps successful items when another source is blocked", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-good", title: "Good", status: "approved", content: "good" },
        { id: "candidate-blocked", title: "Blocked", status: "approved", url: "https://blocked.example" },
      ],
      operations: [{ id: "operation-2", kind: "source", request: "加入來源", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const service = new SourceService(repository);
    const result = await service.execute("operation-2", { actor: "director", attachments: [], fetcher: async () => { throw new Error("403 target denied"); } });
    expect(result.status).toBe("partial");
    expect(result.completed).toEqual(["candidate-good"]);
    expect(result.blocked).toEqual(["candidate-blocked"]);
    const final = await repository.read();
    expect(final.sources).toHaveLength(1);
    expect(final.candidates.find((candidate) => candidate.id === "candidate-blocked")?.status).toBe("blocked_external");
  });

  it("uses an attachment fallback when remote content is unavailable", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: internalId("candidate"), title: "雪乃", status: "approved", url: "https://denied.example" }],
      operations: [{ id: "operation-3", kind: "source", request: "加入來源", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const service = new SourceService(repository);
    const result = await service.execute("operation-3", {
      actor: "director",
      attachments: [{ name: "雪乃.txt", content: new TextEncoder().encode("local fallback") }],
      fetcher: async () => { throw new Error("403"); },
    });
    expect(result.status).toBe("completed");
    expect((await repository.read()).sources[0]?.canonical_text).toBe("local fallback");
  });

  it("returns needs_input for empty search and empty candidate state", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [{ id: "op-empty-search", kind: "source", request: "search", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const service = new SourceService(repository);
    expect((await service.registerCandidates("op-empty-search", [], "researcher")).status).toBe("needs_input");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [{ id: "op-empty", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }] }));
    expect((await service.execute("op-empty", { actor: "researcher", attachments: [] })).status).toBe("needs_input");
  });

  it("marks empty and binary content as failed while preserving the operation", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-empty", title: "empty", status: "approved", content: "   " },
        { id: "candidate-binary", title: "binary", status: "approved", content: "a\u0000b" },
      ],
      operations: [{ id: "op-invalid", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const result = await new SourceService(repository).execute("op-invalid", { actor: "researcher", attachments: [] });
    expect(result.status).toBe("needs_input");
    const state = await repository.read();
    expect(state.candidates.map((candidate) => candidate.status)).toEqual(["failed", "failed"]);
    expect(state.audit.filter((event) => event.event === "source.blocked")).toHaveLength(2);
  });

  it("accepts a recoverable payload with NULs at or below one percent", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-text-with-nul", title: "mostly text", status: "approved", content: `${"x".repeat(99)}\u0000` }],
      operations: [{ id: "op-text-with-nul", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const result = await new SourceService(repository).execute("op-text-with-nul", { actor: "researcher", attachments: [] });
    expect(result.status).toBe("completed");
    expect((await repository.read()).sources).toHaveLength(1);
  });

  it("creates a URL candidate when resuming with a URL", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [{ id: "op-url", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }] }));
    const result = await new SourceService(repository).resume("op-url", "please add https://example.test/page", { actor: "researcher", attachments: [], fetcher: async () => ({ content: new TextEncoder().encode("remote text"), media_type: "text/plain" }) });
    expect(result.status).toBe("completed");
    expect((await repository.read()).candidates[0]?.url).toBe("https://example.test/page");
  });

  it("reuses a candidate for equivalent canonical URLs during registration", async () => {
    const repository = new MemoryProjectRepository("canonical-candidate-url");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [{ id: "op-canonical-candidates", kind: "source", request: "search", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const result = await new SourceService(repository).registerCandidates("op-canonical-candidates", [
      { title: "Page one", url: "https://EXAMPLE.test/page#section-one" },
      { title: "Page one alias", url: "https://example.test/page#section-two" },
    ], "researcher");

    expect(result.completed).toHaveLength(2);
    const state = await repository.read();
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]?.canonical_url).toBe("https://example.test/page");
  });

  it("deduplicates identical content across URLs while retaining final URL provenance", async () => {
    const repository = new MemoryProjectRepository("source-identity-dedupe");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-one", title: "First page", url: "https://source.example/one", status: "approved" },
        { id: "candidate-two", title: "Second page", url: "https://source.example/two", status: "approved" },
      ],
      operations: [{ id: "op-source-identity", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const result = await new SourceService(repository).execute("op-source-identity", {
      actor: "researcher",
      attachments: [],
      fetcher: async () => ({
        content: new TextEncoder().encode("the same canonical body"),
        media_type: "text/plain",
        final_url: "https://canonical.example/article",
      }),
    });

    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]).toMatchObject({
      canonical_url: "https://source.example/one",
      final_url: "https://canonical.example/article",
    });
    expect(state.candidates.every((candidate) => candidate.status === "ingested")).toBe(true);
    expect(state.audit.filter((event) => event.event === "source.ingested").map((event) => event.details.deduplicated)).toEqual([false, true]);
  });

  it("retains different revisions even when their canonical URL is the same", async () => {
    const repository = new MemoryProjectRepository("source-revision-history");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-old", title: "Old revision", url: "https://example.test/article", status: "approved", content: "old revision" },
        { id: "candidate-new", title: "New revision", url: "https://example.test/article", status: "approved", content: "new revision" },
      ],
      operations: [{ id: "op-source-revisions", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const result = await new SourceService(repository).execute("op-source-revisions", { actor: "researcher", attachments: [] });

    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.sources).toHaveLength(2);
    expect(new Set(state.sources.map((source) => source.revision)).size).toBe(2);
    expect(state.sources.every((source) => source.canonical_url === "https://example.test/article")).toBe(true);
  });

  it("converges concurrent execution and replay of the same operation", async () => {
    const repository = new MemoryProjectRepository("source-concurrent-replay");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-replay", title: "Replay page", url: "https://example.test/replay", status: "approved" }],
      operations: [{ id: "op-source-replay", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    let fetchCount = 0;
    let releaseFetches!: () => void;
    let resolveBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => { resolveBothStarted = resolve; });
    const fetchesReleased = new Promise<void>((resolve) => { releaseFetches = resolve; });
    const fetcher = async () => {
      fetchCount += 1;
      if (fetchCount === 2) resolveBothStarted();
      await fetchesReleased;
      return { content: new TextEncoder().encode("replayed body"), media_type: "text/plain", final_url: "https://example.test/replay" };
    };

    const concurrent = Promise.all([
      new SourceService(repository).execute("op-source-replay", { actor: "worker-a", attachments: [], fetcher }),
      new SourceService(repository).execute("op-source-replay", { actor: "worker-b", attachments: [], fetcher }),
    ]);
    await bothStarted;
    releaseFetches();
    const results = await concurrent;

    expect(results.every((item) => item.status === "completed")).toBe(true);
    const state = await repository.read();
    expect(state.sources).toHaveLength(1);
    expect(state.candidates[0]?.status).toBe("ingested");
  });

  it("uses the matching attachment and records missing-content failures", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-match", title: "Official", status: "approved", url: "https://example.test/official" },
        { id: "candidate-missing", title: "Missing", status: "approved" },
      ],
      operations: [{ id: "op-attachments", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const result = await new SourceService(repository).execute("op-attachments", {
      actor: "researcher",
      attachments: [
        { name: "other.txt", content: new TextEncoder().encode("other") },
        { name: "official.txt", content: new TextEncoder().encode("matched") },
      ],
    });
    expect(result.status).toBe("partial");
    const state = await repository.read();
    expect(state.sources[0]?.canonical_text).toBe("matched");
    expect(state.candidates.find((candidate) => candidate.id === "candidate-missing")?.failure?.code).toBe("SOURCE_CONTENT_REQUIRED");
  });

  it("falls back to the only attachment when its name does not match", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-fallback", title: "Remote article", status: "approved" }],
      operations: [{ id: "op-fallback", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const result = await new SourceService(repository).execute("op-fallback", {
      actor: "researcher",
      attachments: [{ name: "local.txt", content: new TextEncoder().encode("fallback content") }],
    });
    expect(result.status).toBe("completed");
    expect((await repository.read()).sources[0]?.canonical_text).toBe("fallback content");
  });

  it("registers optional candidate metadata and rejects unknown operations", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [{ id: "op-register", kind: "source", request: "search", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }] }));
    const service = new SourceService(repository);
    await service.registerCandidates("op-register", [{ title: "Page", url: "https://example.test", snippet: "snippet", content: "content", media_type: "text/plain" }], "researcher");
    expect((await repository.read()).candidates[0]?.snippet).toBe("snippet");
    await expect(service.execute("missing-operation", { actor: "researcher", attachments: [] })).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });

  it("enforces the latest source-research allowed-domain policy before fetching", async () => {
    const repository = new MemoryProjectRepository("demo");
    const policy = JSON.stringify({ kind: "source_research", query: "official", allowed_domains: ["allowed.example"], candidates: [] });
    const hash = contentHash(policy);
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [{ id: "research-1", key: "source_research:official", kind: "source_research", name: "official", content: policy, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "researcher", operation_id: "op-research" }],
      candidates: [{ id: "candidate-blocked-domain", title: "Blocked", url: "https://blocked.example/page", domain: "blocked.example", status: "approved" }],
      operations: [{ id: "op-domain-policy", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const result = await new SourceService(repository).execute("op-domain-policy", { actor: "researcher", attachments: [], fetcher: async () => ({ content: new TextEncoder().encode("must not fetch") }) });
    expect(result.status).toBe("needs_input");
    expect((await repository.read()).candidates[0]?.failure?.code).toBe("SOURCE_DOMAIN_NOT_ALLOWED");
  });

  it("keeps a mirror result but reports the official-candidate requirement when official fetch fails", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-official", title: "Official page", url: "https://official.example/page", status: "approved" },
        { id: "candidate-mirror", title: "Mirror page", content: "mirror text", status: "approved" },
      ],
      operations: [{ id: "op-official", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const result = await new SourceService(repository).execute("op-official", { actor: "researcher", attachments: [], fetcher: async () => { throw new Error("target denied"); } });
    expect(result.status).toBe("partial");
    expect(result.summary).toContain("SOURCE_RESEARCH_OFFICIAL_REQUIRED");
    expect((await repository.read()).sources).toHaveLength(1);
  });

  it("scopes execute to the approved selection snapshot of its operation", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [
        { id: "candidate-a", title: "A", status: "pending", content: "a content" },
        { id: "candidate-b", title: "B", status: "pending", content: "b content" },
      ],
      operations: [
        { id: "operation-a", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] },
        { id: "operation-b", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] },
      ],
    }));
    const service = new SourceService(repository);
    await service.selectCandidates("operation-a", [{ candidate_id: "candidate-a", decision: "approve" }], "director");
    await service.selectCandidates("operation-b", [{ candidate_id: "candidate-b", decision: "approve" }], "director");
    const resultA = await service.execute("operation-a", { actor: "director", attachments: [] });
    expect(resultA.completed).toEqual(["candidate-a"]);
    const afterA = await repository.read();
    expect(afterA.sources.map((source) => source.candidate_id)).toEqual(["candidate-a"]);
    expect(afterA.candidates.find((candidate) => candidate.id === "candidate-b")?.status).toBe("approved");
    const resultB = await service.execute("operation-b", { actor: "director", attachments: [] });
    expect(resultB.completed).toEqual(["candidate-b"]);
    expect((await repository.read()).sources.map((source) => source.candidate_id)).toEqual(["candidate-a", "candidate-b"]);
  });

  it("skips candidates that a concurrent operation already ingested", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-shared", title: "Shared", status: "approved", content: "shared content" }],
      operations: [{ id: "operation-x", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const service = new SourceService(repository);
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      candidates: state.candidates.map((candidate) => ({ ...candidate, status: "ingested" as const })),
    }));
    const result = await service.execute("operation-x", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.completed).toEqual(["candidate-shared"]);
    const final = await repository.read();
    expect(final.sources).toHaveLength(0);
  });

  it("fails loudly when the fetched source is not valid UTF-8", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-bad", title: "Bad", url: "https://bad.example", status: "approved" }],
      operations: [{ id: "operation-decode", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));
    const service = new SourceService(repository);
    const result = await service.execute("operation-decode", {
      actor: "director",
      attachments: [],
      fetcher: async () => ({ content: new Uint8Array([0x80, 0x81, 0x82]), media_type: "text/plain" }),
    });
    expect(result.status).toBe("needs_input");
    const final = await repository.read();
    expect(final.candidates[0]!.failure?.code).toBe("SOURCE_DECODE_FAILED");
  });

  it("retries on REVISION_CONFLICT during commit and succeeds on second attempt (BUG2-20)", async () => {
    const baseRepository = new MemoryProjectRepository("demo-cas-retry");
    await baseRepository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-conflict", title: "Conflict candidate", status: "approved", content: "valid content" }],
      operations: [{ id: "op-conflict", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    let commitCount = 0;
    const repository = {
      read: () => baseRepository.read(),
      readBlob: (hash: string) => baseRepository.readBlob(hash),
      writeBlob: (hash: string, data: Uint8Array) => baseRepository.writeBlob(hash, data),
      inspectRepair: () => baseRepository.inspectRepair(),
      runRepair: () => baseRepository.runRepair(),
      commit: async (expectedRevision: number, updateFn: any) => {
        commitCount += 1;
        if (commitCount === 1) {
          await baseRepository.commit(expectedRevision, (s) => ({ ...s, audit: [...s.audit] }));
          throw new CoreError("REVISION_CONFLICT", `Expected project revision ${expectedRevision}, found ${expectedRevision + 1}`, true);
        }
        return baseRepository.commit(expectedRevision, updateFn);
      },
    };

    const service = new SourceService(repository as any);
    const result = await service.execute("op-conflict", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.completed).toEqual(["candidate-conflict"]);
    const final = await baseRepository.read();
    expect(final.candidates[0]?.status).toBe("ingested");
    expect(final.candidates[0]?.failure).toBeUndefined();
  });

  it("does not mark candidate as failed on REVISION_CONFLICT and leaves it approved if retries exhaust (BUG2-20)", async () => {
    const baseRepository = new MemoryProjectRepository("demo-cas-exhaust");
    await baseRepository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-exhaust", title: "Exhaust candidate", status: "approved", content: "valid content" }],
      operations: [{ id: "op-exhaust", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const repository = {
      read: () => baseRepository.read(),
      readBlob: (hash: string) => baseRepository.readBlob(hash),
      writeBlob: (hash: string, data: Uint8Array) => baseRepository.writeBlob(hash, data),
      inspectRepair: () => baseRepository.inspectRepair(),
      runRepair: () => baseRepository.runRepair(),
      commit: async (expectedRevision: number, updateFn: any) => {
        throw new CoreError("REVISION_CONFLICT", "Revision mismatch simulated", true);
      },
    };

    const service = new SourceService(repository as any);
    const result = await service.execute("op-exhaust", { actor: "director", attachments: [] });
    expect(result.blocked).toEqual(["candidate-exhaust"]);
    expect(result.summary).toContain("CAS_RETRY_EXHAUSTED");
    expect(result.summary).toContain("REVISION_CONFLICT");
    const final = await baseRepository.read();
    expect(final.candidates[0]?.status).toBe("approved");
    expect(final.candidates[0]?.failure).toBeUndefined();
    expect(final.audit.some((e) => e.event === "source.blocked")).toBe(false);
  });

  it("safely converges when another executor ingests candidate during CAS retry (BUG2-20)", async () => {
    const baseRepository = new MemoryProjectRepository("demo-cas-concurrent");
    await baseRepository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-concurrent", title: "Concurrent candidate", status: "approved", content: "valid content" }],
      operations: [{ id: "op-concurrent", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    let commitCount = 0;
    const repository = {
      read: () => baseRepository.read(),
      readBlob: (hash: string) => baseRepository.readBlob(hash),
      writeBlob: (hash: string, data: Uint8Array) => baseRepository.writeBlob(hash, data),
      inspectRepair: () => baseRepository.inspectRepair(),
      runRepair: () => baseRepository.runRepair(),
      commit: async (expectedRevision: number, updateFn: any) => {
        commitCount += 1;
        if (commitCount === 1) {
          await baseRepository.commit(expectedRevision, (s) => ({
            ...s,
            sources: [...s.sources, { id: "source-concurrent", candidate_id: "candidate-concurrent", title: "Concurrent candidate", canonical_text: "valid content", original_hash: "0".repeat(64), revision: "0".repeat(64), media_type: "text/plain", created_at: new Date().toISOString() }],
            candidates: s.candidates.map((c) => c.id === "candidate-concurrent" ? { ...c, status: "ingested" as const } : c),
          }));
          throw new CoreError("REVISION_CONFLICT", "Conflict simulation", true);
        }
        return baseRepository.commit(expectedRevision, updateFn);
      },
    };

    const service = new SourceService(repository as any);
    const result = await service.execute("op-concurrent", { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.completed).toEqual(["candidate-concurrent"]);
    const final = await baseRepository.read();
    expect(final.sources).toHaveLength(1);
  });

  it("propagates non-CAS CoreError directly without marking candidate failed or adding source.blocked audit", async () => {
    const baseRepository = new MemoryProjectRepository("demo-non-cas-core-error");
    await baseRepository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-non-cas", title: "Non-CAS candidate", status: "approved", content: "valid content" }],
      operations: [{ id: "op-non-cas", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const repository = {
      read: () => baseRepository.read(),
      readBlob: (hash: string) => baseRepository.readBlob(hash),
      writeBlob: (hash: string, data: Uint8Array) => baseRepository.writeBlob(hash, data),
      inspectRepair: () => baseRepository.inspectRepair(),
      runRepair: () => baseRepository.runRepair(),
      commit: async () => {
        throw new CoreError("STATE_INVALID", "State schema validation failed", true);
      },
    };

    const service = new SourceService(repository as any);
    await expect(service.execute("op-non-cas", { actor: "director", attachments: [] })).rejects.toMatchObject({ code: "STATE_INVALID" });

    const final = await baseRepository.read();
    expect(final.candidates[0]?.status).toBe("approved");
    expect(final.candidates[0]?.failure).toBeUndefined();
    expect(final.audit.some((event) => event.event === "source.blocked")).toBe(false);
  });

  it("propagates generic SystemError directly without converting to SOURCE_ACQUISITION_FAILED", async () => {
    const baseRepository = new MemoryProjectRepository("demo-generic-error");
    await baseRepository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-generic", title: "Generic error candidate", status: "approved", content: "valid content" }],
      operations: [{ id: "op-generic", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const repository = {
      read: () => baseRepository.read(),
      readBlob: (hash: string) => baseRepository.readBlob(hash),
      writeBlob: (hash: string, data: Uint8Array) => baseRepository.writeBlob(hash, data),
      inspectRepair: () => baseRepository.inspectRepair(),
      runRepair: () => baseRepository.runRepair(),
      commit: async () => {
        throw new Error("disk I/O write failure");
      },
    };

    const service = new SourceService(repository as any);
    await expect(service.execute("op-generic", { actor: "director", attachments: [] })).rejects.toThrow("disk I/O write failure");

    const final = await baseRepository.read();
    expect(final.candidates[0]?.status).toBe("approved");
    expect(final.candidates[0]?.failure).toBeUndefined();
    expect(final.audit.some((event) => event.event === "source.blocked")).toBe(false);
  });

  it("throws when markCandidateBlockedOrFailed exhausts retries", async () => {
    const baseRepository = new MemoryProjectRepository("demo-mark-exhaust");
    await baseRepository.commit(0, (state) => ({
      ...state,
      candidates: [{ id: "candidate-mark-exhaust", title: "Unreachable URL", url: "https://invalid.domain.example", status: "approved" }],
      operations: [{ id: "op-mark-exhaust", kind: "source", request: "source", status: "running", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress: [] }],
    }));

    const repository = {
      read: () => baseRepository.read(),
      readBlob: (hash: string) => baseRepository.readBlob(hash),
      writeBlob: (hash: string, data: Uint8Array) => baseRepository.writeBlob(hash, data),
      inspectRepair: () => baseRepository.inspectRepair(),
      runRepair: () => baseRepository.runRepair(),
      commit: async () => {
        throw new CoreError("REVISION_CONFLICT", "Conflict on mark failure", true);
      },
    };

    const service = new SourceService(repository as any);
    await expect(service.execute("op-mark-exhaust", {
      actor: "director",
      attachments: [],
      fetcher: async () => {
        throw new CoreError("SOURCE_FETCH_BLOCKED", "Fetch blocked", true);
      },
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
});
