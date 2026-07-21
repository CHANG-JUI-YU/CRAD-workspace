import path from "node:path";

import { resolveProjectDirectory } from "@card-workspace/project";
import { defaultDnsResolver, defaultPinnedHttpTransport, type DnsResolver, type PinnedHttpTransport } from "@card-workspace/ingestion";
import { loadWorkflowConfig, type WorkflowConfig } from "@card-workspace/workflow";

import { mcpFail } from "./errors.js";

export interface McpEnvironment {
  [key: string]: string | undefined;
  CARD_WORKSPACE_ROOT?: string;
  CARD_WORKSPACE_AGENT_ID?: string;
}

export interface WebResearchContext {
  readonly pageTransport: PinnedHttpTransport;
  readonly resolveDns: DnsResolver;
  readonly now?: () => Date;
}

export interface TrustedContext {
  workspaceRoot: string;
  agentId: string;
  config: WorkflowConfig;
  webResearch: WebResearchContext;
  projectRoot(projectId: string): Promise<string>;
}

export async function createTrustedContext(
  environment: McpEnvironment = process.env,
  webResearch: Partial<WebResearchContext> = {},
): Promise<TrustedContext> {
  const rawRoot = environment.CARD_WORKSPACE_ROOT?.trim();
  const agentId = environment.CARD_WORKSPACE_AGENT_ID?.trim();
  if (!rawRoot) mcpFail("MCP_WORKSPACE_ROOT_REQUIRED", "CARD_WORKSPACE_ROOT is required");
  if (!agentId) mcpFail("MCP_AGENT_ID_REQUIRED", "CARD_WORKSPACE_AGENT_ID is required");

  const workspaceRoot = path.resolve(rawRoot);
  const config = await loadWorkflowConfig(workspaceRoot);
  if (!config.registry.agents.some((agent) => agent.id === agentId)) {
    mcpFail("MCP_AGENT_UNKNOWN", `Unknown configured agent: ${agentId}`);
  }

  return {
    workspaceRoot,
    agentId,
    config,
    webResearch: {
      pageTransport: webResearch.pageTransport ?? defaultPinnedHttpTransport,
      resolveDns: webResearch.resolveDns ?? defaultDnsResolver,
      ...(webResearch.now ? { now: webResearch.now } : {}),
    },
    projectRoot: (projectId) => resolveProjectDirectory(path.join(workspaceRoot, "projects"), projectId),
  };
}
