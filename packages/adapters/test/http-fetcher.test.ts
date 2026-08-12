import { describe, expect, it, vi } from "vitest";
import { HttpSourceFetcher } from "../src/index.js";

const publicLookup = async (): Promise<string[]> => ["93.184.216.34"];

function fetchStub(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input;
    return await handler(url, init);
  }) as unknown as typeof fetch;
}

function okResponse(body: BodyInit, headers?: Record<string, string>): Response {
  return new Response(body, { status: 200, headers });
}

function streamedBody(totalBytes: number, chunkSize = 8): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const remaining = totalBytes - sent;
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, remaining);
      controller.enqueue(new Uint8Array(size));
      sent += size;
    },
  });
}

function withRemoteAddress(response: Response, address: string): Response {
  return Object.defineProperty(response, "remoteAddress", { value: address, enumerable: true });
}

describe("controlled HTTP source adapter", () => {
  it("rejects non-HTTPS targets before network access", async () => {
    const fetcher = new HttpSourceFetcher();
    await expect(fetcher.fetch("http://example.test/source")).rejects.toMatchObject({ code: "SOURCE_URL_UNSAFE" });
  });

  it("rejects a response whose content-length exceeds the configured size limit", async () => {
    const fetcher = new HttpSourceFetcher({
      maxBytes: 10,
      lookup: publicLookup,
      fetchImpl: fetchStub(() => okResponse(new Uint8Array(20), { "content-length": "20" })),
    });
    await expect(fetcher.fetch("https://example.test/source")).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("validates URLs, hosts, response status and successful metadata", async () => {
    const fetcher = new HttpSourceFetcher({ lookup: publicLookup });
    await expect(fetcher.fetch("not a URL")).rejects.toMatchObject({ code: "SOURCE_URL_INVALID" });
    await expect(new HttpSourceFetcher({ allowedHosts: new Set(["allowed.test"]), lookup: publicLookup }).fetch("https://denied.test/source")).rejects.toMatchObject({ code: "SOURCE_FETCH_TARGET_DENIED" });
    const blockedFetcher = new HttpSourceFetcher({ lookup: publicLookup, fetchImpl: fetchStub(() => new Response("blocked", { status: 403 })) });
    await expect(blockedFetcher.fetch("https://example.test/source")).rejects.toMatchObject({ code: "SOURCE_FETCH_BLOCKED" });
    const okFetcher = new HttpSourceFetcher({ lookup: publicLookup, fetchImpl: fetchStub(() => okResponse("ok", { "content-type": "text/plain" })) });
    const result = await okFetcher.fetch("https://example.test/path/source.txt");
    expect(new TextDecoder().decode(result.content)).toBe("ok");
    expect(result.media_type).toBe("text/plain");
    expect(result.final_url).toBe("https://example.test/path/source.txt");
    expect(result.name).toBe("source.txt");
    const smallFetcher = new HttpSourceFetcher({ maxBytes: 10, lookup: publicLookup, fetchImpl: fetchStub(() => okResponse(new Uint8Array(20))) });
    await expect(smallFetcher.fetch("https://example.test/large")).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    const rootFetcher = new HttpSourceFetcher({ lookup: publicLookup, fetchImpl: fetchStub(() => okResponse("root")) });
    const rootResult = await rootFetcher.fetch("https://example.test");
    expect(rootResult.name).toBe("example.test");
    const noMediaFetcher = new HttpSourceFetcher({ lookup: publicLookup, fetchImpl: fetchStub(() => okResponse(new Uint8Array([1]))) });
    const noMediaType = await noMediaFetcher.fetch("https://example.test/no-media");
    expect(noMediaType.media_type).toBeUndefined();
  });

  it("rejects loopback, private, link-local, multicast and unspecified IPv4 targets even without an allowlist", async () => {
    const targets = [
      "https://127.0.0.1/x",
      "https://10.0.0.1/x",
      "https://172.16.5.5/x",
      "https://172.31.255.255/x",
      "https://192.168.1.1/x",
      "https://169.254.169.254/x",
      "https://0.0.0.0/x",
      "https://224.0.0.1/x",
    ];
    for (const target of targets) {
      const fetcher = new HttpSourceFetcher({ fetchImpl: fetchStub(() => okResponse("ok")) });
      await expect(fetcher.fetch(target)).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
    }
  });

  it("rejects unsafe IPv6 targets including mapped IPv4", async () => {
    const targets = [
      "https://[::1]/x",
      "https://[fe80::1]/x",
      "https://[fc00::1]/x",
      "https://[ff02::1]/x",
      "https://[::]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://[::ffff:10.0.0.5]/x",
    ];
    for (const target of targets) {
      const fetcher = new HttpSourceFetcher({ fetchImpl: fetchStub(() => okResponse("ok")) });
      await expect(fetcher.fetch(target)).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
    }
  });

  it("accepts a public IPv6 target", async () => {
    const fetcher = new HttpSourceFetcher({
      fetchImpl: fetchStub(() => okResponse("ok", { "content-type": "text/plain" })),
    });
    const result = await fetcher.fetch("https://[2606:2800:220:1:248:1893:25c8:1946]/x");
    expect(new TextDecoder().decode(result.content)).toBe("ok");
  });

  it("validates every address returned by DNS (DNS rebinding guard)", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: async () => ["93.184.216.34", "10.0.0.5"],
      fetchImpl: fetchStub(() => okResponse("ok")),
    });
    await expect(fetcher.fetch("https://example.test/x")).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
  });

  it("reports a failed DNS lookup as a fetch failure", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
      fetchImpl: fetchStub(() => okResponse("ok")),
    });
    await expect(fetcher.fetch("https://no-such-host.test/x")).rejects.toMatchObject({ code: "SOURCE_FETCH_FAILED" });
  });

  it("revalidates redirect targets and rejects hops to unsafe addresses", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: fetchStub(async (url) => {
        if (url.hostname === "evil.test") return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/internal" } });
        return okResponse("ok");
      }),
    });
    await expect(fetcher.fetch("https://evil.test/start")).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
  });

  it("rejects redirects that downgrade to HTTP", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: fetchStub(() => new Response(null, { status: 302, headers: { location: "http://example.test/plain" } })),
    });
    await expect(fetcher.fetch("https://example.test/start")).rejects.toMatchObject({ code: "SOURCE_URL_UNSAFE" });
  });

  it("stops after the maximum number of redirects", async () => {
    const fetcher = new HttpSourceFetcher({
      maxRedirects: 2,
      lookup: publicLookup,
      fetchImpl: fetchStub(() => new Response(null, { status: 302, headers: { location: "https://example.test/again" } })),
    });
    await expect(fetcher.fetch("https://example.test/start")).rejects.toMatchObject({ code: "SOURCE_REDIRECT_LIMIT" });
  });

  it("follows redirects and returns the final content", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: fetchStub(async (url) => {
        if (url.pathname === "/start") return new Response(null, { status: 301, headers: { location: "/final.txt" } });
        return okResponse("final", { "content-type": "text/plain" });
      }),
    });
    const result = await fetcher.fetch("https://example.test/start");
    expect(new TextDecoder().decode(result.content)).toBe("final");
    expect(result.final_url).toBe("https://example.test/final.txt");
    expect(result.name).toBe("final.txt");
  });

  it("aborts a fetch that exceeds the timeout", async () => {
    const fetcher = new HttpSourceFetcher({
      timeoutMs: 20,
      lookup: publicLookup,
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })) as unknown as typeof fetch,
    });
    await expect(fetcher.fetch("https://example.test/slow")).rejects.toMatchObject({ code: "SOURCE_FETCH_TIMEOUT" });
  });

  it("wraps network-level failures", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: (() => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch,
    });
    await expect(fetcher.fetch("https://example.test/down")).rejects.toMatchObject({ code: "SOURCE_FETCH_FAILED" });
  });

  it("enforces the byte limit while streaming when no content-length is present", async () => {
    const fetcher = new HttpSourceFetcher({
      maxBytes: 10,
      lookup: publicLookup,
      fetchImpl: fetchStub(() => okResponse(streamedBody(20))),
    });
    await expect(fetcher.fetch("https://example.test/big")).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("returns a bounded streamed body within the limit", async () => {
    const fetcher = new HttpSourceFetcher({
      maxBytes: 100,
      lookup: publicLookup,
      fetchImpl: fetchStub(() => okResponse(streamedBody(50))),
    });
    const result = await fetcher.fetch("https://example.test/medium");
    expect(result.content.byteLength).toBe(50);
  });

  it("rejects a connection whose actual remote address is private (DNS rebinding / TOCTOU)", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: fetchStub(() => withRemoteAddress(okResponse("secret"), "10.0.0.5")),
    });
    await expect(fetcher.fetch("https://example.test/x")).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
  });

  it("rejects a redirect hop that rebinds to loopback after a valid first hop", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: fetchStub(async (url) => {
        if (url.pathname === "/start") {
          return withRemoteAddress(new Response(null, { status: 302, headers: { location: "/internal" } }), "93.184.216.34");
        }
        return withRemoteAddress(okResponse("secret"), "127.0.0.1");
      }),
    });
    await expect(fetcher.fetch("https://example.test/start")).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
  });

  it("accepts a response whose remote address matches the resolved public address", async () => {
    const fetcher = new HttpSourceFetcher({
      lookup: publicLookup,
      fetchImpl: fetchStub(() => withRemoteAddress(okResponse("ok", { "content-type": "text/plain" }), "93.184.216.34")),
    });
    const result = await fetcher.fetch("https://example.test/x");
    expect(new TextDecoder().decode(result.content)).toBe("ok");
  });

  it("rejects a literal IP target whose connection reaches a different address", async () => {
    const fetcher = new HttpSourceFetcher({
      fetchImpl: fetchStub(() => withRemoteAddress(okResponse("secret"), "10.0.0.5")),
    });
    await expect(fetcher.fetch("https://93.184.216.34/x")).rejects.toMatchObject({ code: "SOURCE_NETWORK_DENIED" });
  });
});
