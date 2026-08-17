import { describe, expect, it, afterAll } from "vitest";
import { DASHBOARD_URL_JS } from "../src/dashboard-url.js";
import { createWorkspaceServer } from "../src/index.js";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import type { Server } from "node:http";

const servers: Array<Server> = [];

async function startServer(): Promise<string> {
  const repository = new MemoryProjectRepository("batch2-urls");
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "batch9-batch2-urls", autoStartWorker: false });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

function safeExternalUrl(raw: string): string | null {
  const fn = new Function(
    `${DASHBOARD_URL_JS}\nreturn dashboardUrlSafe.safeExternalUrl;`,
  ) as () => (value: unknown) => string | null;
  return fn()(raw);
}

afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("audit9-batch2 external URL scheme allowlist (#131)", () => {
  it("allows http and https URLs", () => {
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("https://example.com/source")).toBe("https://example.com/source");
    expect(safeExternalUrl("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
  });

  it("rejects javascript scheme variants", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeExternalUrl(" javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("java\tscript:alert(1)")).toBeNull();
  });

  it("rejects data, vbscript and file schemes", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects urls without a scheme, malformed urls and encoded schemes", () => {
    expect(safeExternalUrl("example.com/path")).toBeNull();
    expect(safeExternalUrl("//example.com/path")).toBeNull();
    expect(safeExternalUrl("http://%zz")).toBeNull();
    expect(safeExternalUrl("http://exa mple")).toBeNull();
    expect(safeExternalUrl("javascript%3Aalert(1)")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });

  it("renders external links with a safe rel attribute and a warning for unsafe urls", async () => {
    const url = await startServer();
    const response = await fetch(url);
    const html = await response.text();
    expect(html).toContain('rel = "noopener noreferrer"');
    expect(html).toContain("external-link-warning");
    expect(html).toContain("dashboardUrlSafe");
    expect(html).toContain("外部來源網址不安全，已停用連結。");
    expect(html).toContain("（不安全網址）");
    expect(html).toContain("（來源網址不安全）");
  });
});