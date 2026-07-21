#!/usr/bin/env node
export * from "./authorization.js";
export * from "./context.js";
export * from "./errors.js";
export * from "./server.js";
export * from "./tool-registry.js";

import { pathToFileURL } from "node:url";

import { runStdioServer } from "./server.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStdioServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
