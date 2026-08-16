export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorBody;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export function hasJsonRpcId(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "id");
}

export interface ParsedJsonRpcMessage {
  kind: "invalid";
  code: number;
  message: string;
}

export interface ParsedJsonRpcRequest {
  kind: "request";
  id: JsonRpcId;
  method: string;
  params: unknown;
  notification: boolean;
}

export function parseJsonRpcMessage(raw: unknown): ParsedJsonRpcMessage | ParsedJsonRpcRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "invalid", code: JSONRPC_INVALID_REQUEST, message: "Invalid Request" };
  }
  const value = raw as Record<string, unknown>;
  if (value.jsonrpc !== "2.0") {
    return { kind: "invalid", code: JSONRPC_INVALID_REQUEST, message: "Invalid Request" };
  }
  if (typeof value.method !== "string" || value.method.length === 0) {
    return { kind: "invalid", code: JSONRPC_INVALID_REQUEST, message: "Invalid Request" };
  }
  const notification = !hasJsonRpcId(value);
  let id: JsonRpcId = null;
  if (!notification) {
    const rawId = value.id;
    if (typeof rawId === "string" || typeof rawId === "number" || rawId === null) {
      id = rawId;
    } else {
      return { kind: "invalid", code: JSONRPC_INVALID_REQUEST, message: "Invalid Request" };
    }
  }
  return { kind: "request", id, method: value.method, params: value.params, notification };
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
