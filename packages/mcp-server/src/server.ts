import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateProject } from "@card-workspace/project";

import { agentCanAccessTool, authorizeTool, authorizeWorkspaceTool } from "./authorization.js";
import { createTrustedContext, type McpEnvironment, type TrustedContext, type WebResearchContext } from "./context.js";
import { machineError } from "./errors.js";
import { toolRegistry } from "./tool-registry.js";

function safeValue(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === "string") {
    const normalizedRoot = workspaceRoot.replaceAll("\\", "/");
    const normalized = value.replaceAll("\\", "/").replaceAll(normalizedRoot, "<workspace>");
    return normalized.replace(/\b[A-Za-z]:\/[^\s"']+/gu, "<host-path>");
  }
  if (Buffer.isBuffer(value)) return { encoding: "base64", byte_length: value.byteLength };
  if (Array.isArray(value)) return value.map((item) => safeValue(item, workspaceRoot));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeValue(item, workspaceRoot)]));
  }
  return value;
}

function result(value: unknown, context: TrustedContext, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(safeValue(value, context.workspaceRoot)) }],
    ...(isError ? { isError: true } : {}),
  };
}

export async function createMcpServer(options: { environment?: McpEnvironment; webResearch?: Partial<WebResearchContext> } = {}) {
  const context = await createTrustedContext(options.environment, options.webResearch);
  const server = new McpServer({ name: "card-workspace", version: "0.1.0" });
  for (const [name, tool] of Object.entries(toolRegistry)) {
    if (!agentCanAccessTool(context.agentId, name, context.config)) continue;
    server.registerTool(name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
    }, async (args: Record<string, unknown>) => {
      try {
        if (tool.scope === "workspace") {
          authorizeWorkspaceTool({ agentId: context.agentId, toolName: name, config: context.config });
          const output = await tool.handler({ trusted: context, args });
          return result({ ok: true, result: output }, context);
        }
        const projectId = args.project_id;
        if (typeof projectId !== "string") throw new TypeError("project_id is required");
        const foundation = await validateProject(`${context.workspaceRoot}/projects`, projectId);
        if (!foundation.workflow) throw new Error("Project workflow is unavailable");
        authorizeTool({
          agentId: context.agentId,
          toolName: name,
          config: context.config,
          workflow: foundation.workflow,
          ...(typeof args.task_id === "string" ? { taskId: args.task_id } : {}),
          ...(typeof args.lease_id === "string" ? { leaseId: args.lease_id } : {}),
        });
        const projectRoot = await context.projectRoot(projectId);
        const output = await tool.handler({ trusted: context, args, workflow: foundation.workflow, projectRoot });
        return result({ ok: true, result: output }, context);
      } catch (error) {
        return result(machineError(error), context, true);
      }
    });
  }
  return { server, context };
}

export async function runStdioServer(environment: McpEnvironment = process.env): Promise<void> {
  const { server } = await createMcpServer({ environment });
  await server.connect(new StdioServerTransport());
}
