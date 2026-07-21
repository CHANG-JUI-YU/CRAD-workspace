import path from "node:path";

import { resolveWorkspaceRoot } from "@card-workspace/project";

export interface DashboardContext {
  workspaceRoot: string;
  projectsRoot: string;
  exportsRoot: string;
}

export async function createDashboardContext(workspaceRoot?: string): Promise<DashboardContext> {
  const root = await resolveWorkspaceRoot({
    ...(workspaceRoot === undefined ? {} : { explicit: workspaceRoot }),
    start: process.cwd(),
  });
  return {
    workspaceRoot: root,
    projectsRoot: path.join(root, "projects"),
    exportsRoot: path.join(root, "exports"),
  };
}
