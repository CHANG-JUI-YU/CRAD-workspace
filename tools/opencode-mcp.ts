/**
 * Legacy/diagnostic stdio bridge.
 *
 * The supported OpenCode integration is the remote MCP entry in opencode.jsonc
 * and the single server owned by the Dashboard launcher or direct server
 * process. Keep this helper only for legacy protocol diagnostics; do not use it
 * as the primary startup path.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

type JsonRpcRequest = {
  id?: unknown;
  method?: unknown;
  [key: string]: unknown;
};

function runBuild(): Promise<void> {
  const windows = process.platform === "win32";
  const command = windows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
  const args = windows ? ["/d", "/s", "/c", "pnpm build"] : ["build"];
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectBuild);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveBuild();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      rejectBuild(new Error(`workspace build failed${signal === null ? ` with exit code ${code ?? "unknown"}` : ` (${signal})`}${detail.length === 0 ? "" : `: ${detail}`}`));
    });
  });
}

function closeServer(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
  });
}

async function main(): Promise<void> {
  // Use the current server source so a protocol fix is effective immediately.
  // A fresh checkout may not have package dist files yet; only then compile.
  let serverModule: typeof import("../packages/server/src/index.ts");
  try {
    serverModule = await import("../packages/server/src/index.ts");
  } catch (error) {
    await runBuild();
    try {
      serverModule = await import("../packages/server/dist/index.js");
    } catch (distError) {
      throw new Error(`could not load workspace server source (${error instanceof Error ? error.message : String(error)}); compiled fallback also failed (${distError instanceof Error ? distError.message : String(distError)})`);
    }
  }
  const { startWorkspaceServer } = serverModule;
  const server = await startWorkspaceServer({
    actor: "opencode",
    host: "127.0.0.1",
    port: 0,
    // Passing the root explicitly prevents a stale ST_WORKSPACE_PROJECT from
    // reopening an old project in a new OpenCode session.
    projectRoot: resolve(process.cwd(), "projects"),
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("workspace MCP server did not bind to a local port");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const send = (value: unknown): void => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };

  try {
    for await (const line of input) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let message: JsonRpcRequest;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed === null || typeof parsed !== "object") throw new Error("JSON-RPC message must be an object");
        message = parsed as JsonRpcRequest;
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }

      const isNotification = !Object.prototype.hasOwnProperty.call(message, "id");
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(30000),
        });
        if (isNotification) continue;
        const text = await response.text();
        try {
          send(JSON.parse(text) as unknown);
        } catch {
          send({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: "Workspace MCP returned invalid JSON" } });
        }
      } catch (error) {
        if (!isNotification) {
          const timedOut = error instanceof Error && error.name === "TimeoutError";
          send({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: timedOut ? "Request timed out" : "Workspace MCP request failed" } });
        }
      }
    }
  } finally {
    input.close();
    await closeServer(server);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
