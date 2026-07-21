#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { lintAgentConfiguration } from "./agent-lint.js";

export interface AgentLintStreams {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export async function runAgentLintCli(args: string[], streams: AgentLintStreams = process): Promise<number> {
  try {
    const rootArgument = args.find((argument) => argument !== "--");
    const report = await lintAgentConfiguration({ root: resolve(rootArgument ?? process.cwd()) });
    streams.stdout.write(`${JSON.stringify(report)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    const report = { ok: false, diagnostics: [{ code: "AGENT_LINT_INTERNAL", severity: "error", message: error instanceof Error ? error.message : String(error), evidence: [], fixability: "none" }] };
    streams.stdout.write(`${JSON.stringify(report)}\n`);
    return 2;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await runAgentLintCli(process.argv.slice(2));
}
