import { lookup as dnsLookup } from "node:dns/promises";
import { CoreError } from "@st-workspace/core";
import type { FetchResult, SourceFetcher } from "@st-workspace/domain";
import { isBlockedIp, isIpLiteral, stripBrackets } from "./network-policy.js";

export { inspectLegacyProject, type LegacyCandidate, type LegacyFileReport, type LegacyInspection } from "./legacy.js";

export type HostLookup = (hostname: string) => Promise<ReadonlyArray<string>>;

export interface HttpFetcherOptions {
  allowedHosts?: ReadonlySet<string>;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
}

const DEFAULT_MAX_BYTES = 5_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

async function defaultLookup(hostname: string): Promise<ReadonlyArray<string>> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
}

export class HttpSourceFetcher {
  readonly fetch: SourceFetcher;
  private readonly allowedHosts: ReadonlySet<string> | undefined;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly lookup: HostLookup;

  constructor(options: HttpFetcherOptions = {}) {
    this.allowedHosts = options.allowedHosts;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.lookup = options.lookup ?? defaultLookup;
    this.fetch = (url) => this.fetchUrl(url);
  }

  private async fetchUrl(url: string): Promise<FetchResult> {
    let initial: URL;
    try {
      initial = new URL(url);
    } catch {
      throw new CoreError("SOURCE_URL_INVALID", "來源 URL 無法解析", true);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let current = initial;
      let redirects = 0;
      while (true) {
        await this.assertTargetAllowed(current);
        const response = await this.fetchImpl(current, { redirect: "manual", signal: controller.signal });
        const status = response.status;
        if (status >= 300 && status < 400) {
          const location = response.headers.get("location");
          if (location === null) throw new CoreError("SOURCE_FETCH_BLOCKED", `遠端回應 ${status}`, true);
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            throw new CoreError("SOURCE_URL_INVALID", "重新導向位置無法解析", true);
          }
          if (next.protocol !== "https:") throw new CoreError("SOURCE_URL_UNSAFE", "重新導向目標只允許 HTTPS", true);
          redirects += 1;
          if (redirects > this.maxRedirects) throw new CoreError("SOURCE_REDIRECT_LIMIT", `來源重新導向超過 ${this.maxRedirects} 次`, true);
          current = next;
          continue;
        }
        if (!response.ok) throw new CoreError("SOURCE_FETCH_BLOCKED", `遠端回應 ${status}`, true);
        const declaredLength = response.headers.get("content-length");
        if (declaredLength !== null && Number(declaredLength) > this.maxBytes) {
          throw new CoreError("SOURCE_TOO_LARGE", "來源超過大小限制", true);
        }
        const content = await this.readBoundedBody(response, controller);
        const mediaType = response.headers.get("content-type");
        return {
          content,
          ...(mediaType === null ? {} : { media_type: mediaType }),
          name: current.pathname.split("/").filter(Boolean).at(-1) ?? current.hostname,
        };
      }
    } catch (error) {
      if (controller.signal.aborted) throw new CoreError("SOURCE_FETCH_TIMEOUT", "來源擷取逾時", true);
      if (error instanceof CoreError) throw error;
      throw new CoreError("SOURCE_FETCH_FAILED", error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async assertTargetAllowed(url: URL): Promise<void> {
    if (url.protocol !== "https:") throw new CoreError("SOURCE_URL_UNSAFE", "受控來源只允許 HTTPS", true);
    if (this.allowedHosts !== undefined && !this.allowedHosts.has(url.hostname)) {
      throw new CoreError("SOURCE_FETCH_TARGET_DENIED", `目標站 ${url.hostname} 不在允許清單`, true);
    }
    const hostname = stripBrackets(url.hostname);
    if (isIpLiteral(hostname)) {
      if (isBlockedIp(hostname)) throw new CoreError("SOURCE_NETWORK_DENIED", `目標 ${url.hostname} 指向不允許的網路位址`, true);
      return;
    }
    let addresses: ReadonlyArray<string>;
    try {
      addresses = await this.lookup(hostname);
    } catch {
      throw new CoreError("SOURCE_FETCH_FAILED", `無法解析主機 ${url.hostname}`, true);
    }
    if (addresses.length === 0) throw new CoreError("SOURCE_FETCH_FAILED", `無法解析主機 ${url.hostname}`, true);
    for (const address of addresses) {
      if (isBlockedIp(address)) {
        throw new CoreError("SOURCE_NETWORK_DENIED", `目標 ${url.hostname} 解析到不允許的網路位址 ${address}`, true);
      }
    }
  }

  private async readBoundedBody(response: Response, controller: AbortController): Promise<Uint8Array> {
    const body = response.body;
    if (body === null) return new Uint8Array(0);
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (controller.signal.aborted) throw new CoreError("SOURCE_FETCH_TIMEOUT", "來源擷取逾時", true);
        throw error;
      }
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => {});
        throw new CoreError("SOURCE_TOO_LARGE", "來源超過大小限制", true);
      }
      chunks.push(value);
    }
    const content = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return content;
  }
}
