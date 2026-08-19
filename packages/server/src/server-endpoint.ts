import type { Server } from "node:http";

export type WorkspaceServerEndpoint =
  | { readonly kind: "url"; readonly value: string }
  | { readonly kind: "bind"; readonly value: string };

function unbracketedHost(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function formattedHost(host: string): string {
  const normalized = unbracketedHost(host);
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

function wildcardHost(host: string): boolean {
  const normalized = unbracketedHost(host);
  return normalized === "0.0.0.0" || normalized === "::";
}

/** Resolve the endpoint from the address actually reported by the listening server. */
export function resolveWorkspaceServerEndpoint(server: Pick<Server, "address">): WorkspaceServerEndpoint {
  const address = server.address();
  if (address === null) throw new Error("workspace server is not listening");
  if (typeof address === "string") return { kind: "bind", value: address };

  const host = formattedHost(address.address);
  const value = `${host}:${address.port}`;
  if (wildcardHost(address.address)) return { kind: "bind", value };
  return { kind: "url", value: `http://${value}` };
}

export function workspaceServerStartupMessage(server: Pick<Server, "address">): string {
  const endpoint = resolveWorkspaceServerEndpoint(server);
  return endpoint.kind === "url"
    ? `ST Workspace server listening on ${endpoint.value}`
    : `ST Workspace server bound to ${endpoint.value}`;
}
