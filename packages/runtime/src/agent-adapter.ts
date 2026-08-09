import type { RequestResult, WorkspaceContext } from "@st-workspace/core";
import type { WorkspaceRuntime } from "./index.js";
import { AgentRouter, type AgentResolution } from "./agent-router.js";

export interface AgentRequest {
  readonly request: string;
  readonly context: WorkspaceContext;
  readonly agent?: string;
}

export class AgentAdapter {
  constructor(
    private readonly runtime: WorkspaceRuntime,
    private readonly router = new AgentRouter(),
  ) {}

  resolve(request: string, agent?: string): AgentResolution {
    return this.router.resolve(request, agent);
  }

  list() {
    return this.router.registryView().list();
  }

  async request(input: AgentRequest): Promise<RequestResult> {
    const resolution = this.router.resolve(input.request, input.agent);
    return this.runtime.request(input.request, input.context, { agent: resolution.agent_id });
  }
}
