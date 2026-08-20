import type { RequestResult, WorkspaceContext } from "@st-workspace/core";
import {
  WorkspaceProjectManager as BaseWorkspaceProjectManager,
  type WorkspaceProjectManagerOptions,
  type WorkspaceProjectSummary,
} from "./project-manager.js";

export type { WorkspaceProjectManagerOptions, WorkspaceProjectSummary };

export function userFacingProjectSwitchResult(result: RequestResult): RequestResult {
  if (!result.summary.startsWith("已切換至專案「")) return result;
  const summary = result.summary.replace(/（revision \d+）/u, "");
  return summary === result.summary ? result : { ...result, summary };
}

export class WorkspaceProjectManager extends BaseWorkspaceProjectManager {
  override async answerInterview(answer: string, context: WorkspaceContext): Promise<RequestResult> {
    return userFacingProjectSwitchResult(await super.answerInterview(answer, context));
  }
}
