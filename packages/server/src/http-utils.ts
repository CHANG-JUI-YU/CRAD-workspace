import { TextDecoder } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CoreError, z } from "@st-workspace/core";
import { parseDashboardQuery } from "@st-workspace/runtime";

export function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

export class RequestBodyError extends Error {
  readonly code = "REQUEST_INVALID_UTF8";
  readonly recoverable = true;

  constructor() {
    super("Request body is not valid UTF-8");
    this.name = "RequestBodyError";
  }
}

export class RequestJsonError extends Error {
  readonly code = "REQUEST_INVALID_JSON";
  readonly recoverable = true;

  constructor() {
    super("Request body is not valid JSON");
    this.name = "RequestJsonError";
  }
}

export class RequestTooLargeError extends Error {
  readonly code = "REQUEST_TOO_LARGE";
  readonly recoverable = true;

  constructor() {
    super("Request body exceeds the 10 MiB limit");
    this.name = "RequestTooLargeError";
  }
}

export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function body(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RequestTooLargeError();
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(Buffer.from(chunk));
  }
  if (tooLarge) throw new RequestTooLargeError();
  if (chunks.length === 0) return {};
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new RequestBodyError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestJsonError();
  }
}

export function parseRequest<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown, code: string): z.infer<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CoreError(code, `Invalid ${(schema as z.ZodTypeAny & { description?: string }).description ?? "input"}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, true);
  }
  return parsed.data;
}

export function compact<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result as T;
}

export function dashboardQuery(url: URL) {
  const raw: { cursor?: string; limit?: string; filter?: string } = {};
  const cursor = url.searchParams.get("cursor");
  const limit = url.searchParams.get("limit");
  const filter = url.searchParams.get("filter");
  if (cursor !== null) raw.cursor = cursor;
  if (limit !== null) raw.limit = limit;
  if (filter !== null) raw.filter = filter;
  return parseDashboardQuery(raw);
}

export function dashboardPathId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new CoreError("DASHBOARD_PATH_INVALID", "Dashboard resource id is invalid", true);
  }
}
