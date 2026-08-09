import { describe, expect, it, vi } from "vitest";
import { HttpSourceFetcher } from "../src/index.js";

describe("controlled HTTP source adapter", () => {
  it("rejects non-HTTPS targets before network access", async () => {
    const fetcher = new HttpSourceFetcher();
    await expect(fetcher.fetch("http://example.test/source")).rejects.toMatchObject({ code: "SOURCE_URL_UNSAFE" });
  });

  it("rejects a response outside the configured size limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(20), { status: 200, headers: { "content-length": "20" } })));
    const fetcher = new HttpSourceFetcher({ maxBytes: 10 });
    await expect(fetcher.fetch("https://example.test/source")).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    vi.unstubAllGlobals();
  });

  it("validates URLs, hosts, response status and successful metadata", async () => {
    const fetcher = new HttpSourceFetcher();
    await expect(fetcher.fetch("not a URL")).rejects.toMatchObject({ code: "SOURCE_URL_INVALID" });
    await expect(new HttpSourceFetcher({ allowedHosts: new Set(["allowed.test"]) }).fetch("https://denied.test/source")).rejects.toMatchObject({ code: "SOURCE_FETCH_TARGET_DENIED" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    await expect(fetcher.fetch("https://example.test/source")).rejects.toMatchObject({ code: "SOURCE_FETCH_BLOCKED" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })));
    const result = await fetcher.fetch("https://example.test/path/source.txt");
    expect(new TextDecoder().decode(result.content)).toBe("ok");
    expect(result.media_type).toBe("text/plain");
    expect(result.name).toBe("source.txt");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(20), { status: 200 })));
    await expect(new HttpSourceFetcher({ maxBytes: 10 }).fetch("https://example.test/large")).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("root", { status: 200 })));
    const rootResult = await fetcher.fetch("https://example.test");
    expect(rootResult.name).toBe("example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
    const noMediaType = await fetcher.fetch("https://example.test/no-media");
    expect(noMediaType.media_type).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
