import { CoreError } from "@st-workspace/core";
import type { FetchResult, SourceFetcher } from "@st-workspace/domain";

export { inspectLegacyProject, type LegacyCandidate, type LegacyFileReport, type LegacyInspection } from "./legacy.js";

export interface HttpFetcherOptions {
  allowedHosts?: ReadonlySet<string>;
  maxBytes?: number;
}

export class HttpSourceFetcher {
  readonly fetch: SourceFetcher;
  private readonly allowedHosts: ReadonlySet<string> | undefined;
  private readonly maxBytes: number;

  constructor(options: HttpFetcherOptions = {}) {
    this.allowedHosts = options.allowedHosts;
    this.maxBytes = options.maxBytes ?? 5_000_000;
    this.fetch = (url) => this.fetchUrl(url);
  }

  private async fetchUrl(url: string): Promise<FetchResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new CoreError("SOURCE_URL_INVALID", "來源 URL 無法解析", true);
    }
    if (parsed.protocol !== "https:") throw new CoreError("SOURCE_URL_UNSAFE", "受控來源只允許 HTTPS", true);
    if (this.allowedHosts !== undefined && !this.allowedHosts.has(parsed.hostname)) {
      throw new CoreError("SOURCE_FETCH_TARGET_DENIED", `目標站 ${parsed.hostname} 不在允許清單`, true);
    }
    const response = await fetch(parsed, { redirect: "follow" });
    if (!response.ok) throw new CoreError("SOURCE_FETCH_BLOCKED", `遠端回應 ${response.status}`, true);
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > this.maxBytes) throw new CoreError("SOURCE_TOO_LARGE", "來源超過大小限制", true);
    const content = new Uint8Array(await response.arrayBuffer());
    if (content.byteLength > this.maxBytes) throw new CoreError("SOURCE_TOO_LARGE", "來源超過大小限制", true);
    const mediaType = response.headers.get("content-type");
    return {
      content,
      ...(mediaType === null ? {} : { media_type: mediaType }),
      name: parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname,
    };
  }
}
