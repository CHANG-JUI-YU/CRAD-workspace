import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { checkServerIdentity } from "node:tls";
import { CoreError, currentWorkspaceAbortSignal } from "@st-workspace/core";
import type { FetchResult, SourceFetcher } from "@st-workspace/domain";
import { isBlockedIp, isIpLiteral, parseIpv4, parseIpv6, stripBrackets } from "./network-policy.js";

export { inspectLegacyProject, type LegacyCandidate, type LegacyFileReport, type LegacyInspection } from "./legacy.js";

export type HostLookup = (hostname: string) => Promise<ReadonlyArray<string>>;

export interface HttpTransportBody {
  read(): Promise<{ done: true } | { done: false; value: Uint8Array }>;
  cancel(): Promise<void>;
}

export interface HttpTransportResponse {
  status: number;
  headers: Headers;
  body: HttpTransportBody | null;
  remoteAddress: string | undefined;
}

export type HttpTransport = (url: URL, pinnedAddress: string, signal: AbortSignal) => Promise<HttpTransportResponse>;

export interface HttpFetcherOptions {
  allowedHosts?: ReadonlySet<string>;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  transport?: HttpTransport;
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

function remoteAddressOf(response: Response): string | undefined {
  const value = (response as unknown as { remoteAddress?: unknown }).remoteAddress;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fetchBody(response: Response): HttpTransportBody | null {
  const reader = response.body?.getReader();
  if (reader === undefined) return null;
  return {
    async read() {
      const result = await reader.read();
      if (result.done) return { done: true };
      return { done: false, value: result.value };
    },
    async cancel() {
      await reader.cancel().catch(() => {});
    },
  };
}

function fetchTransport(fetchImpl: typeof fetch): HttpTransport {
  return async (url, _pinnedAddress, signal) => {
    const response = await fetchImpl(url, { redirect: "manual", signal });
    return {
      status: response.status,
      headers: response.headers,
      body: fetchBody(response),
      remoteAddress: remoteAddressOf(response),
    };
  };
}

function nodeHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else {
      result.set(name, String(value));
    }
  }
  return result;
}

function nodeBody(response: IncomingMessage): HttpTransportBody {
  const iterator = response[Symbol.asyncIterator]();
  return {
    async read() {
      const result = await iterator.next();
      if (result.done === true) return { done: true };
      const chunk = result.value;
      return { done: false, value: chunk instanceof Uint8Array ? chunk : Buffer.from(chunk) };
    },
    async cancel() {
      response.destroy();
    },
  };
}

const pinnedHttpsTransport: HttpTransport = (url, pinnedAddress, signal) =>
  new Promise<HttpTransportResponse>((resolve, reject) => {
    const originalHostname = stripBrackets(url.hostname);
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: stripBrackets(pinnedAddress),
        port: url.port === "" ? 443 : Number(url.port),
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host },
        agent: false,
        signal,
        ...(isIpLiteral(originalHostname) ? {} : { servername: originalHostname }),
        checkServerIdentity: (_hostname, certificate) => checkServerIdentity(originalHostname, certificate),
      },
      (response) => {
        if (response.statusCode === undefined) {
          response.destroy();
          reject(new Error("HTTPS response missing status code"));
          return;
        }
        resolve({
          status: response.statusCode,
          headers: nodeHeaders(response.headers),
          body: nodeBody(response),
          remoteAddress: response.socket.remoteAddress,
        });
      },
    );
    request.once("error", reject);
    request.end();
  });

function canonicalIpBytes(ip: string): number[] | null {
  const clean = stripBrackets(ip.trim());
  const v4 = parseIpv4(clean);
  if (v4 !== null) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...v4];
  return parseIpv6(clean);
}

function sameIpAddress(left: string, right: string): boolean {
  const leftBytes = canonicalIpBytes(left);
  const rightBytes = canonicalIpBytes(right);
  if (leftBytes === null || rightBytes === null || leftBytes.length !== rightBytes.length) return false;
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

export class HttpSourceFetcher {
  readonly fetch: SourceFetcher;
  private readonly allowedHosts: ReadonlySet<string> | undefined;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;
  private readonly transport: HttpTransport;
  private readonly lookup: HostLookup;

  constructor(options: HttpFetcherOptions = {}) {
    this.allowedHosts = options.allowedHosts;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transport = options.transport ?? (options.fetchImpl === undefined ? pinnedHttpsTransport : fetchTransport(options.fetchImpl));
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
    const externalSignal = currentWorkspaceAbortSignal();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      externalSignal?.throwIfAborted();
      let current = initial;
      let redirects = 0;
      while (true) {
        const addresses = await this.assertTargetAllowed(current);
        externalSignal?.throwIfAborted();
        const response = await this.requestPinned(current, addresses, controller.signal);
        const status = response.status;
        if (status >= 300 && status < 400) {
          const location = response.headers.get("location");
          await this.cancelBody(response);
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
        if (status < 200 || status >= 300) {
          await this.cancelBody(response);
          throw new CoreError("SOURCE_FETCH_BLOCKED", `遠端回應 ${status}`, true);
        }
        const declaredLength = response.headers.get("content-length");
        if (declaredLength !== null && Number(declaredLength) > this.maxBytes) {
          await this.cancelBody(response);
          throw new CoreError("SOURCE_TOO_LARGE", "來源超過大小限制", true);
        }
        const content = await this.readBoundedBody(response, controller);
        externalSignal?.throwIfAborted();
        const mediaType = response.headers.get("content-type");
        return {
          content,
          ...(mediaType === null ? {} : { media_type: mediaType }),
          final_url: current.href,
          name: current.pathname.split("/").filter(Boolean).at(-1) ?? current.hostname,
        };
      }
    } catch (error) {
      if (externalSignal?.aborted) {
        throw externalSignal.reason instanceof Error
          ? externalSignal.reason
          : new DOMException("Operation aborted", "AbortError");
      }
      if (timedOut) throw new CoreError("SOURCE_FETCH_TIMEOUT", "來源擷取逾時", true);
      if (error instanceof CoreError) throw error;
      throw new CoreError("SOURCE_FETCH_FAILED", error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  private async assertTargetAllowed(url: URL): Promise<ReadonlyArray<string>> {
    if (url.protocol !== "https:") throw new CoreError("SOURCE_URL_UNSAFE", "受控來源只允許 HTTPS", true);
    if (this.allowedHosts !== undefined && !this.allowedHosts.has(url.hostname)) {
      throw new CoreError("SOURCE_FETCH_TARGET_DENIED", `目標站 ${url.hostname} 不在允許清單`, true);
    }
    const hostname = stripBrackets(url.hostname);
    if (isIpLiteral(hostname)) {
      if (isBlockedIp(hostname)) throw new CoreError("SOURCE_NETWORK_DENIED", `目標 ${url.hostname} 指向不允許的網路位址`, true);
      return [hostname];
    }
    let addresses: ReadonlyArray<string>;
    try {
      addresses = await this.lookup(hostname);
    } catch {
      throw new CoreError("SOURCE_FETCH_FAILED", `無法解析主機 ${url.hostname}`, true);
    }
    if (addresses.length === 0) throw new CoreError("SOURCE_FETCH_FAILED", `無法解析主機 ${url.hostname}`, true);
    const verified: string[] = [];
    for (const rawAddress of addresses) {
      const address = stripBrackets(rawAddress.trim());
      if (!isIpLiteral(address)) throw new CoreError("SOURCE_FETCH_FAILED", `主機 ${url.hostname} 回傳無效的網路位址`, true);
      if (isBlockedIp(address)) {
        throw new CoreError("SOURCE_NETWORK_DENIED", `目標 ${url.hostname} 解析到不允許的網路位址 ${address}`, true);
      }
      if (!verified.some((candidate) => sameIpAddress(candidate, address))) verified.push(address);
    }
    return verified;
  }

  private async requestPinned(url: URL, addresses: ReadonlyArray<string>, signal: AbortSignal): Promise<HttpTransportResponse> {
    let lastError: unknown;
    for (const address of addresses) {
      try {
        const response = await this.transport(url, address, signal);
        try {
          this.assertRemoteAddress(address, response.remoteAddress);
        } catch (error) {
          await response.body?.cancel().catch(() => {});
          throw error;
        }
        return response;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof CoreError) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error(`無法連線到 ${url.hostname}`);
  }

  private assertRemoteAddress(pinnedAddress: string, remoteAddress: string | undefined): void {
    if (remoteAddress === undefined || remoteAddress.length === 0) {
      throw new CoreError("SOURCE_NETWORK_DENIED", "無法驗證連線實際網路位址", true);
    }
    const address = stripBrackets(remoteAddress);
    if (!isIpLiteral(address) || isBlockedIp(address)) {
      throw new CoreError("SOURCE_NETWORK_DENIED", `連線實際目標 ${remoteAddress} 指向不允許的網路位址`, true);
    }
    if (!sameIpAddress(address, pinnedAddress)) {
      throw new CoreError("SOURCE_NETWORK_DENIED", `連線實際目標 ${remoteAddress} 與已釘選的目標 ${pinnedAddress} 不符`, true);
    }
  }

  private async cancelBody(response: HttpTransportResponse): Promise<void> {
    await response.body?.cancel().catch(() => {});
  }

  private async readBoundedBody(response: HttpTransportResponse, controller: AbortController): Promise<Uint8Array> {
    const body = response.body;
    if (body === null) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      let result: { done: true } | { done: false; value: Uint8Array };
      try {
        result = await body.read();
      } catch (error) {
        await body.cancel().catch(() => {});
        if (controller.signal.aborted) throw new CoreError("SOURCE_FETCH_TIMEOUT", "來源擷取逾時", true);
        throw error;
      }
      if (result.done) break;
      total += result.value.byteLength;
      if (total > this.maxBytes) {
        await body.cancel().catch(() => {});
        throw new CoreError("SOURCE_TOO_LARGE", "來源超過大小限制", true);
      }
      chunks.push(result.value);
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
