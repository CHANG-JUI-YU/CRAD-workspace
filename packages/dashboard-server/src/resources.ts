import { readFile } from "node:fs/promises";

import {
  dashboardDocumentSchema,
  paletteModuleKindSchema,
  worldCategorySchema,
  zhujiModuleKindSchema,
  type DashboardDocument,
  type DashboardResourceRef,
} from "@card-workspace/schemas";
import {
  computeRevision,
  computeTextRevision,
  paletteModuleFiles,
  parseStructuredFile,
  patchProjectFile,
  resolveExistingWithin,
  zhujiModuleFiles,
  type Operation,
} from "@card-workspace/project";

import { dashboardFail } from "./errors.js";

export function resourcePath(resource: DashboardResourceRef): string {
  switch (resource.kind) {
    case "project": return "project.yaml";
    case "blueprint": return "blueprint.yaml";
    case "greetings": return "greetings.yaml";
    case "workflow": return "workflow.json";
    case "character": return `characters/${resource.id}/character.yaml`;
    case "zhuji_module": {
      const owner = requiredOwner(resource);
      const kind = zhujiModuleKindSchema.parse(resource.id);
      const file = zhujiModuleFiles.find((item) => item.kind === kind)?.file;
      if (file === undefined) dashboardFail("DASHBOARD_RESOURCE_INVALID", `Unknown Zhuji module: ${kind}`);
      return `characters/${owner}/zhuji/${file}`;
    }
    case "palette_module": {
      const owner = requiredOwner(resource);
      const kind = paletteModuleKindSchema.parse(resource.id);
      const file = paletteModuleFiles.find((item) => item.kind === kind)?.file;
      if (file === undefined) dashboardFail("DASHBOARD_RESOURCE_INVALID", `Unknown palette module: ${kind}`);
      return `characters/${owner}/palette/${file}`;
    }
    case "world_entry": return `world/${worldCategorySchema.parse(requiredOwner(resource))}/${resource.id}.yaml`;
    case "source":
    case "fact":
    case "preview":
    case "export": dashboardFail("DASHBOARD_RESOURCE_READ_ONLY", `${resource.kind} is not an editable document`);
  }
}

function requiredOwner(resource: DashboardResourceRef): string {
  if (resource.owner_id === undefined) dashboardFail("DASHBOARD_RESOURCE_OWNER_REQUIRED", `${resource.kind} requires owner_id`);
  return resource.owner_id;
}

export async function readDashboardDocument(projectRoot: string, resource: DashboardResourceRef): Promise<DashboardDocument> {
  const relativePath = resourcePath(resource);
  const filePath = await resolveExistingWithin(projectRoot, relativePath);
  const parsed = await parseStructuredFile(filePath, { displayPath: relativePath });
  if (parsed.data === undefined) dashboardFail("DASHBOARD_DOCUMENT_INVALID", `Document cannot be parsed: ${relativePath}`);
  return dashboardDocumentSchema.parse({
    resource,
    format: parsed.format,
    value: parsed.data,
    semantic_revision: computeRevision(parsed.data),
    raw_revision: computeTextRevision(await readFile(filePath)),
    read_only: resource.kind === "workflow",
  });
}

export async function patchDashboardDocument(input: {
  projectRoot: string;
  resource: DashboardResourceRef;
  expectedRevision: string;
  operations: Operation[];
  dryRun: boolean;
}) {
  if (input.resource.kind === "workflow") dashboardFail("DASHBOARD_RESOURCE_READ_ONLY", "Workflow is mutated only through Workflow Engine");
  const before = await readDashboardDocument(input.projectRoot, input.resource);
  const result = await patchProjectFile({
    projectRoot: input.projectRoot,
    relativePath: resourcePath(input.resource),
    operations: input.operations,
    expectedRevision: input.expectedRevision,
    dryRun: input.dryRun,
  });
  return {
    resource: input.resource,
    before_revision: before.semantic_revision,
    after_revision: result.afterRevision,
    workflow_revision: result.workflowRevision,
    no_op: result.noOp,
    dry_run: result.dryRun,
    affected_resources: result.affectedFiles,
    rebuild_scopes: result.rebuildScopes,
    differences: result.differences,
    value: result.value,
  };
}
