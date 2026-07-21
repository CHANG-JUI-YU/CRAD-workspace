import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { Readable } from "node:stream";

import {
  assertIngestionProjectPath,
  canonicalJson,
  computeRevision,
  computeTextRevision,
  ProjectError,
  resolveExistingWithin,
  runFileTransaction,
} from "@card-workspace/project";

import { intakeRetrievedSource, type IntakeSourceResult } from "./intake.js";
import {
  researchBatchSchema,
  researchPointerSchema,
  researchQuerySchema,
  type ResearchBatch,
  type ResearchCandidate,
  type ResearchQuery,
  type ResearchSourceClass,
} from "./research-schemas.js";
import { IngestionError } from "./types.js";

const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export interface SearchProviderResult { title: string; url: string; snippet: string; language: string }
export interface DnsAddress { address: string; family: number }
export type DnsResolver = (hostname: string) => Promise<DnsAddress[]>;
export interface PinnedHttpResponse { statusCode: number; headers: IncomingHttpHeaders; body: Readable }
export type PinnedHttpTransport = (options: {
  url: URL;
  addresses: readonly DnsAddress[];
  signal: AbortSignal;
}) => Promise<PinnedHttpResponse>;

export interface ResearchDependencies {
  transport: PinnedHttpTransport;
  resolveDns: DnsResolver;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new IngestionError(code, message, cause);
}

function digest(value: unknown, length = 24): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, length);
}

function canonicalWebUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function classify(url: URL, allowedDomains: string[]): ResearchSourceClass | undefined {
  const hostname = url.hostname.toLowerCase();
  if (allowedDomains.some((domain) => hostMatches(hostname, domain))) return "official";
  if (hostMatches(hostname, "wikipedia.org") || hostMatches(hostname, "britannica.com")) return "encyclopedia";
  if (hostMatches(hostname, "fandom.com") || hostMatches(hostname, "wikia.org") || /(?:^|\.)wiki(?:\.|$)/u.test(hostname)) return "wiki";
  return undefined;
}

export function deriveResearchSourceFamily(url: URL, allowedDomains: string[]): string | undefined {
  const hostname = url.hostname.toLowerCase();
  if (hostMatches(hostname, "wikipedia.org")) return "platform:wikipedia.org";
  if (hostMatches(hostname, "britannica.com")) return "platform:britannica.com";
  if (hostMatches(hostname, "fandom.com")) return "platform:fandom.com";
  if (hostMatches(hostname, "wikia.org")) return "platform:wikia.org";
  const officialDomain = allowedDomains
    .filter((domain) => hostMatches(hostname, domain))
    .sort((left, right) => right.length - left.length)[0];
  if (officialDomain) return `official:${officialDomain}`;
  if (/(?:^|\.)wiki(?:\.|$)/u.test(hostname)) return `platform:${hostname}`;
  return undefined;
}

function withRuntimeCandidateFields(batch: ResearchBatch): ResearchBatch {
  return {
    ...batch,
    candidates: batch.candidates.map((candidate) => {
      const url = canonicalWebUrl(candidate.url);
      return {
        ...candidate,
        ...(candidate.source_family_id ? {} : { source_family_id: url ? deriveResearchSourceFamily(url, batch.query.allowed_domains) : undefined }),
        ...(candidate.language ? {} : { language: batch.query.language }),
      };
    }),
  };
}

function withRevision(batch: Omit<ResearchBatch, "revision">): ResearchBatch {
  return researchBatchSchema.parse({ ...batch, revision: computeRevision(batch) });
}

function withoutBatchRevision(batch: ResearchBatch): Omit<ResearchBatch, "revision"> {
  return {
    schema_version: batch.schema_version,
    id: batch.id,
    provider: batch.provider,
    query: batch.query,
    candidates: batch.candidates,
    approvals: batch.approvals,
    created_at: batch.created_at,
    updated_at: batch.updated_at,
  };
}

function batchDirectory(batchId: string): string {
  return `sources/research/${batchId}`;
}

function revisionPath(batch: ResearchBatch): string {
  return `${batchDirectory(batch.id)}/${batch.revision.slice("sha256:".length)}.json`;
}

function pointerPath(batchId: string): string {
  return `${batchDirectory(batchId)}/current.json`;
}

async function readCurrent(projectRoot: string, batchId: string): Promise<{ batch: ResearchBatch; pointerText: string }> {
  try {
    const pointerFile = assertIngestionProjectPath(pointerPath(batchId)).relativePath;
    const pointerText = await readFile(await resolveExistingWithin(projectRoot, pointerFile), "utf8");
    const pointer = researchPointerSchema.parse(JSON.parse(pointerText));
    if (pointer.batch_id !== batchId) fail("SOURCE_RESEARCH_BATCH_INVALID", "Research pointer batch identity mismatch");
    const batch = researchBatchSchema.parse(JSON.parse(await readFile(await resolveExistingWithin(projectRoot, pointer.revision_path), "utf8")));
    if (batch.id !== batchId || batch.revision !== pointer.revision || revisionPath(batch) !== pointer.revision_path) {
      fail("SOURCE_RESEARCH_BATCH_INVALID", "Research batch revision identity mismatch");
    }
    if (computeRevision(withoutBatchRevision(batch)) !== batch.revision) fail("SOURCE_RESEARCH_BATCH_INVALID", "Research batch revision hash mismatch");
    return { batch: withRuntimeCandidateFields(batch), pointerText };
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    fail("SOURCE_RESEARCH_BATCH_NOT_FOUND", `Research batch not found: ${batchId}`, error);
  }
}

async function publishRevision(projectRoot: string, batch: ResearchBatch, pointerText?: string): Promise<void> {
  const nextRevisionPath = assertIngestionProjectPath(revisionPath(batch)).relativePath;
  const nextPointerPath = assertIngestionProjectPath(pointerPath(batch.id)).relativePath;
  const pointer = researchPointerSchema.parse({
    schema_version: 1,
    batch_id: batch.id,
    revision: batch.revision,
    revision_path: nextRevisionPath,
  });
  await runFileTransaction({
    root: projectRoot,
    operations: [
      { relativePath: nextRevisionPath, content: canonicalJson(batch), expectedAbsent: true },
      pointerText === undefined
        ? { relativePath: nextPointerPath, content: canonicalJson(pointer), expectedAbsent: true }
        : { relativePath: nextPointerPath, content: canonicalJson(pointer), expectedRawRevision: computeTextRevision(pointerText) },
    ],
  });
}

export async function registerResearchSources(options: {
  projectRoot: string;
  query: ResearchQuery;
  results: SearchProviderResult[];
  now?: () => Date;
}): Promise<ResearchBatch> {
  const query = researchQuerySchema.parse(options.query);
  const candidates = new Map<string, ResearchCandidate>();
  for (const result of options.results) {
    const url = canonicalWebUrl(result.url);
    if (!url) continue;
    const sourceClass = classify(url, query.allowed_domains);
    if (!sourceClass) continue;
    const sourceFamilyId = deriveResearchSourceFamily(url, query.allowed_domains);
    if (!sourceFamilyId) continue;
    const language = researchQuerySchema.shape.language.parse(result.language);
    const id = `candidate-${digest(url.href)}`;
    candidates.set(id, {
      id,
      url: url.href,
      hostname: url.hostname.toLowerCase(),
      title: result.title.trim().slice(0, 500) || url.hostname,
      snippet: result.snippet.trim().slice(0, 2000),
      source_class: sourceClass,
      source_family_id: sourceFamilyId,
      language,
      relevance_rationale: `${sourceClass} source matching the bounded work and character query`,
      status: "pending",
      source_id: `research-${digest({ candidate: id })}`,
    });
    if (candidates.size >= query.result_count) break;
  }
  const orderedCandidates = [...candidates.values()].sort((left, right) => left.id.localeCompare(right.id));
  const id = `research-batch-${digest({ provider: "model_web", query, candidates: orderedCandidates.map((item) => ({ id: item.id, language: item.language })) })}`;
  try {
    return (await readCurrent(options.projectRoot, id)).batch;
  } catch (error) {
    if (!(error instanceof IngestionError) || error.code !== "SOURCE_RESEARCH_BATCH_NOT_FOUND") throw error;
  }
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const batch = withRevision({ schema_version: 1, id, provider: "model_web", query, candidates: orderedCandidates, approvals: [], created_at: timestamp, updated_at: timestamp });
  try {
    await publishRevision(options.projectRoot, batch);
    return batch;
  } catch (error) {
    if (error instanceof ProjectError && error.code === "TRANSACTION_TARGET_EXISTS") return (await readCurrent(options.projectRoot, id)).batch;
    throw error;
  }
}

export async function getResearchStatus(projectRoot: string, batchId: string): Promise<ResearchBatch> {
  return (await readCurrent(projectRoot, batchId)).batch;
}

export async function approveResearchSources(options: {
  projectRoot: string;
  batchId: string;
  expectedRevision: string;
  approvedCandidateIds: string[];
  decisionId: string;
  actor: string;
  decidedAt: string;
  singleFamilyFallback: boolean;
  singleFamilyFallbackReason?: string;
}): Promise<{ batch: ResearchBatch; idempotent: boolean }> {
  const current = await readCurrent(options.projectRoot, options.batchId);
  if (current.batch.revision !== options.expectedRevision) fail("SOURCE_RESEARCH_REVISION_CONFLICT", "Research approval requires the exact current batch revision");
  const approved = [...new Set(options.approvedCandidateIds)].sort();
  const known = new Set(current.batch.candidates.map((candidate) => candidate.id));
  if (approved.some((id) => !known.has(id))) fail("SOURCE_RESEARCH_CANDIDATE_UNKNOWN", "Approval contains an unknown candidate");
  const selected = current.batch.candidates.filter((candidate) => approved.includes(candidate.id));
  if (current.batch.candidates.some((candidate) => candidate.source_class === "official") && !selected.some((candidate) => candidate.source_class === "official")) {
    fail("SOURCE_RESEARCH_OFFICIAL_REQUIRED", "Approval must include an official candidate when one is available");
  }
  const families = new Set(selected.map((candidate) => candidate.source_family_id).filter((family): family is string => Boolean(family)));
  const fallbackReason = options.singleFamilyFallbackReason?.trim();
  if (families.size < 2 && !(families.size === 1 && options.singleFamilyFallback && fallbackReason)) {
    fail("SOURCE_RESEARCH_DIVERSITY_REQUIRED", "Approval requires at least two source families or an explicit single-family fallback reason");
  }
  const currentApproved = current.batch.candidates.filter((item) => item.status === "approved" || item.status === "fetched").map((item) => item.id).sort();
  const latestApproval = current.batch.approvals.at(-1);
  const hasRequiredAudit = families.size >= 2 || (latestApproval?.single_family_fallback === true && Boolean(latestApproval.single_family_fallback_reason));
  if (JSON.stringify(currentApproved) === JSON.stringify(approved) && hasRequiredAudit) return { batch: current.batch, idempotent: true };
  const content = {
    ...current.batch,
    candidates: current.batch.candidates.map((candidate) => ({
      ...candidate,
      status: candidate.status === "fetched" ? "fetched" as const : approved.includes(candidate.id) ? "approved" as const : "rejected" as const,
    })),
    approvals: [...current.batch.approvals, {
      decision_id: options.decisionId,
      actor: options.actor,
      decided_at: options.decidedAt,
      approved_candidate_ids: approved,
      prior_revision: current.batch.revision,
      single_family_fallback: options.singleFamilyFallback,
      ...(options.singleFamilyFallback ? { single_family_fallback_reason: fallbackReason } : {}),
    }],
    updated_at: options.decidedAt,
  };
  const batch = withRevision(withoutBatchRevision(researchBatchSchema.parse(content)));
  await publishRevision(options.projectRoot, batch, current.pointerText);
  return { batch, idempotent: false };
}

function isDeniedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113);
}

function ipv4MappedAddress(address: string): string | undefined {
  const normalized = address.toLowerCase();
  const dotted = /^(?:(?:0{0,4}:){5}|::)ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  if (dotted) return dotted;
  const compressed = /^(?:(?:0{0,4}:){5}|::)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized);
  if (!compressed) return undefined;
  const high = Number.parseInt(compressed[1]!, 16);
  const low = Number.parseInt(compressed[2]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !isDeniedIpv4(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  const mapped = ipv4MappedAddress(normalized);
  if (mapped) return !isDeniedIpv4(mapped);
  return normalized !== "::" && normalized !== "::1"
    && !/^(?:fc|fd)/u.test(normalized) && !/^fe[89ab]/u.test(normalized)
    && !/^ff/u.test(normalized) && !/^2001:db8(?::|$)/u.test(normalized);
}

export const defaultDnsResolver: DnsResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

export const defaultPinnedHttpTransport: PinnedHttpTransport = ({ url, addresses, signal }) => new Promise((resolve, reject) => {
  const selected = addresses[0];
  if (!selected) {
    reject(new Error("Pinned transport requires a validated address"));
    return;
  }
  const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
    agent: false,
    lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
  });
  const abort = () => request.destroy(new Error("Controlled fetch aborted"));
  const cleanup = () => signal.removeEventListener("abort", abort);
  signal.addEventListener("abort", abort, { once: true });
  request.once("response", (response) => {
    response.once("close", cleanup);
    resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response });
  });
  request.once("error", (error) => {
    cleanup();
    reject(error);
  });
  if (signal.aborted) abort();
  else request.end();
});

async function resolveTarget(url: URL, resolver: DnsResolver, timeoutMs: number): Promise<DnsAddress[]> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("WEB_FETCH_TARGET_DENIED", "Fetch target must be credential-free HTTP(S)");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: DnsAddress[];
  try {
    addresses = await Promise.race([
      resolver(url.hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new IngestionError("WEB_FETCH_TIMEOUT", "Controlled fetch DNS resolution timed out")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    fail("WEB_FETCH_TARGET_DENIED", "Fetch target DNS resolution failed", error);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (addresses.length === 0 || addresses.some((item) => isIP(item.address) !== item.family || !isPublicAddress(item.address))) {
    fail("WEB_FETCH_TARGET_DENIED", "Fetch target resolves to a non-public or invalid address set");
  }
  return addresses;
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Controlled fetch aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    if (signal.aborted) throw new Error("Controlled fetch aborted");
    return await Promise.race([operation, aborted]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named[name?.toLowerCase() ?? ""] ?? match;
  });
}

export function extractHtmlText(html: string): string {
  const text = decodeEntities(html
    .replace(/<!--[^]*?-->/gu, " ")
    .replace(/<(?:script|style|noscript|nav|footer|header|aside)\b[^>]*>[^]*?<\/(?:script|style|noscript|nav|footer|header|aside)\s*>/giu, " ")
    .replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length < 20) fail("WEB_FETCH_CONTENT_UNSUPPORTED", "Fetched HTML has no usable body text");
  return text;
}

export async function controlledFetch(options: {
  url: string;
  transport: PinnedHttpTransport;
  resolveDns: DnsResolver;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<{ requestedUrl: string; finalUrl: string; mediaType: "text/html" | "text/plain"; bytes: Buffer }> {
  const requested = canonicalWebUrl(options.url);
  if (!requested) fail("WEB_FETCH_TARGET_DENIED", "Fetch target must be credential-free HTTP(S)");
  let current = requested;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const addresses = await resolveTarget(current, options.resolveDns, timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: PinnedHttpResponse;
    try {
      try {
        response = await abortable(options.transport({ url: current, addresses, signal: controller.signal }), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) fail("WEB_FETCH_TIMEOUT", "Controlled fetch timed out", error);
        fail("WEB_FETCH_TARGET_DENIED", "Controlled fetch failed", error);
      }
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = header(response.headers, "location");
        response.body.destroy();
        if (!location || redirects === MAX_REDIRECTS) fail("WEB_FETCH_TARGET_DENIED", "Fetch redirect is missing or exceeds the redirect limit");
        const redirected = canonicalWebUrl(new URL(location, current).href);
        if (!redirected) fail("WEB_FETCH_TARGET_DENIED", "Fetch redirect target is unsafe");
        current = redirected;
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        fail("WEB_FETCH_TARGET_DENIED", `Fetch target returned status ${response.statusCode}`);
      }
      const mediaType = header(response.headers, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "text/html" && mediaType !== "text/plain") {
        response.body.destroy();
        fail("WEB_FETCH_CONTENT_UNSUPPORTED", `Unsupported fetch content type: ${mediaType ?? "missing"}`);
      }
      const maxBytes = options.maxBytes ?? MAX_FETCH_BYTES;
      const declared = Number(header(response.headers, "content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.body.destroy();
        fail("WEB_FETCH_TOO_LARGE", "Fetched content exceeds the byte limit");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const abortBody = () => response.body.destroy(new Error("Controlled fetch timed out"));
      controller.signal.addEventListener("abort", abortBody, { once: true });
      try {
        for await (const chunkValue of response.body) {
          const chunk = typeof chunkValue === "string" ? Buffer.from(chunkValue) : chunkValue as Uint8Array;
          total += chunk.byteLength;
          if (total > maxBytes) {
            response.body.destroy();
            fail("WEB_FETCH_TOO_LARGE", "Fetched content exceeds the byte limit");
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (controller.signal.aborted) fail("WEB_FETCH_TIMEOUT", "Controlled fetch timed out", error);
        throw error;
      } finally {
        controller.signal.removeEventListener("abort", abortBody);
      }
      const raw = Buffer.concat(chunks);
      const text = mediaType === "text/html" ? extractHtmlText(raw.toString("utf8")) : raw.toString("utf8").replace(/\s+/gu, " ").trim();
      if (text.length < 20) fail("WEB_FETCH_CONTENT_UNSUPPORTED", "Fetched page has no usable body text");
      return { requestedUrl: requested.href, finalUrl: current.href, mediaType, bytes: Buffer.from(text, "utf8") };
    } finally {
      clearTimeout(timeout);
    }
  }
  fail("WEB_FETCH_TARGET_DENIED", "Fetch redirect limit exceeded");
}

const tierByClass = { official: "official", encyclopedia: "unknown", wiki: "common_fanon" } as const;

export async function fetchApprovedResearchSources(options: {
  projectRoot: string;
  batchId: string;
  actor: string;
  transport: PinnedHttpTransport;
  resolveDns: DnsResolver;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<{ batch: ResearchBatch; results: Array<{ candidate_id: string; source_id: string; idempotent: boolean; revision: string }> }> {
  let current = await readCurrent(options.projectRoot, options.batchId);
  const approved = current.batch.candidates.filter((candidate) => candidate.status === "approved");
  if (approved.length === 0 && !current.batch.candidates.some((candidate) => candidate.status === "fetched")) fail("SOURCE_RESEARCH_NOT_APPROVED", "Research batch has no approved candidates");
  const results: Array<{ candidate_id: string; source_id: string; idempotent: boolean; revision: string }> = [];
  for (const candidate of approved) {
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const fetched = await controlledFetch({ url: candidate.url, transport: options.transport, resolveDns: options.resolveDns, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}) });
    const finalUrl = canonicalWebUrl(fetched.finalUrl);
    const finalFamily = finalUrl ? deriveResearchSourceFamily(finalUrl, current.batch.query.allowed_domains) : undefined;
    if (!candidate.source_family_id || finalFamily !== candidate.source_family_id) {
      fail("SOURCE_RESEARCH_FAMILY_REDIRECT_MISMATCH", "Fetched final URL belongs to a different source family");
    }
    const finalSourceClass = finalUrl ? classify(finalUrl, current.batch.query.allowed_domains) : undefined;
    if (!finalSourceClass) fail("SOURCE_RESEARCH_FAMILY_REDIRECT_MISMATCH", "Fetched final URL is not an approved source family");
    const intake: IntakeSourceResult = await intakeRetrievedSource({
      projectRoot: options.projectRoot,
      sourceId: candidate.source_id,
      title: candidate.title,
      bytes: fetched.bytes,
      requestedUrl: fetched.requestedUrl,
      canonicalUrl: fetched.finalUrl,
      fetchedAt,
      acquiredAt: fetchedAt,
      mediaType: "text/plain",
      extension: ".txt",
      language: candidate.language ?? current.batch.query.language,
      tier: tierByClass[finalSourceClass],
      actor: options.actor,
      extensions: {
        research_batch_id: current.batch.id,
        research_batch_revision: current.batch.revision,
        research_candidate_id: candidate.id,
        research_source_class: candidate.source_class,
        research_source_family_id: candidate.source_family_id,
        language: candidate.language ?? current.batch.query.language,
        requested_url: fetched.requestedUrl,
        final_url: fetched.finalUrl,
        fetched_at: fetchedAt,
      },
    });
    const updatedCandidates = current.batch.candidates.map((item) => item.id === candidate.id ? {
      ...item,
      status: "fetched" as const,
      source_revision_id: intake.revision.id,
      requested_url: fetched.requestedUrl,
      final_url: fetched.finalUrl,
      fetched_at: fetchedAt,
    } : item);
    const next = withRevision({ ...withoutBatchRevision(current.batch), candidates: updatedCandidates, updated_at: fetchedAt });
    await publishRevision(options.projectRoot, next, current.pointerText);
    current = await readCurrent(options.projectRoot, options.batchId);
    results.push({ candidate_id: candidate.id, source_id: candidate.source_id, idempotent: intake.idempotent, revision: intake.revision.id });
  }
  return { batch: current.batch, results };
}
