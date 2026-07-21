#!/usr/bin/env node
export * from "./context.js";
export * from "./errors.js";
export * from "./server.js";

import { pathToFileURL } from "node:url";
import path from "node:path";

import { createDashboardContext } from "./context.js";
import { createDashboardServer } from "./server.js";

async function main(): Promise<void> {
  const context = await createDashboardContext(process.env.CARD_WORKSPACE_ROOT);
  const { app, sessions } = createDashboardServer({ context, logger: true, clientDist: path.join(context.workspaceRoot, "apps/dashboard/dist") });
  const address = await app.listen({ host: "127.0.0.1", port: Number(process.env.CARD_WORKSPACE_DASHBOARD_PORT ?? 0) });
  process.stderr.write(`${address}/#bootstrap=${sessions.bootstrapToken}\n`);
}

export async function startDashboard(options: { workspaceRoot?: string; port?: number; logger?: boolean } = {}) {
  const context = await createDashboardContext(options.workspaceRoot);
  const { app, sessions } = createDashboardServer({
    context,
    logger: options.logger ?? false,
    clientDist: path.join(context.workspaceRoot, "apps/dashboard/dist"),
  });
  const address = await app.listen({ host: "127.0.0.1", port: options.port ?? 0 });
  return { app, address, url: `${address}/#bootstrap=${sessions.bootstrapToken}` };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
