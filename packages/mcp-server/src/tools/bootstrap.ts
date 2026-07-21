import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { initializeProject, validateProject } from "@card-workspace/project";
import {
  authoringModeSchema,
  blueprintRelationshipsSchema,
  collaborationModeSchema,
  blueprintWorldSchema,
  projectKindSchema,
  projectManifestSchema,
  workflowEntryKindSchema,
} from "@card-workspace/schemas";
import { z } from "zod";

import { mcpFail } from "../errors.js";
import { objectArg, stringArg, type WorkspaceToolHandler } from "./types.js";

const initialCharactersSchema = z.array(z.object({
  display_name: z.string().min(1),
  mode: authoringModeSchema,
}).strict());

const intakeAnswersSchema = z.array(z.object({
  decision_id: z.string().min(1),
  question_id: z.string().min(1),
  answer: z.string().min(1),
}).strict()).min(1);

const projectInitialize: WorkspaceToolHandler = async ({ trusted, args }) => {
  const projectId = stringArg(args, "project_id");
  const title = stringArg(args, "title");
  const kind = projectKindSchema.parse(args.kind ?? "character_card");
  const entryKind = workflowEntryKindSchema.parse(args.entry_kind);
  const occurredAt = z.string().datetime({ offset: true }).parse(args.occurred_at);
  const collaborationMode = collaborationModeSchema.parse(args.collaboration_mode);
  const intakeAnswers = intakeAnswersSchema.parse(args.intake_answers);
  if (intakeAnswers.some((answer) => answer.decision_id === "creative-collaboration-mode")) {
    mcpFail("INTAKE_DECISION_ID_RESERVED", "intake_answers 不可覆寫 creative-collaboration-mode");
  }
  const characters = initialCharactersSchema.parse(args.characters).map((character, index) => ({
    id: `character-${index + 1}`,
    display_name: character.display_name,
    mode: character.mode,
    role: "primary" as const,
  }));
  const requestedWorld = args.world === undefined ? undefined : blueprintWorldSchema.parse(args.world);
  const relationships = args.relationships === undefined
    ? undefined
    : blueprintRelationshipsSchema.parse(args.relationships);
  const world = requestedWorld?.enabled
    ? { ...requestedWorld, authoring_timing: requestedWorld.authoring_timing ?? (kind === "worldbook" ? "before_characters" as const : "after_characters" as const) }
    : requestedWorld;
  const manifest = projectManifestSchema.parse({
    schema_version: 1,
    id: projectId,
    title,
    kind,
    characters,
    card: args.card === undefined ? { name: title } : objectArg(args, "card"),
  });
  await initializeProject({
    projectsRoot: path.join(trusted.workspaceRoot, "projects"),
    manifest,
    entryKind,
    collaborationMode,
    ...(world === undefined ? {} : { world }),
    ...(relationships === undefined ? {} : { relationships }),
    initialDecisions: [{
      id: "creative-collaboration-mode",
      kind: "creative-collaboration.mode",
      actor: trusted.agentId,
      decided_at: occurredAt,
      input_revisions: [],
      summary: collaborationMode === "free" ? "自由創作" : "協助創作",
      option: collaborationMode,
      extensions: { question_id: "creative-collaboration-mode" },
    }, ...intakeAnswers.map((answer) => ({
      id: answer.decision_id,
      kind: "interview.answer",
      actor: trusted.agentId,
      decided_at: occurredAt,
      input_revisions: [],
      summary: answer.answer,
      extensions: { question_id: answer.question_id },
    }))],
  });
  return { project_id: projectId, initialized: true, collaboration_mode: collaborationMode };
};

const projectList: WorkspaceToolHandler = async ({ trusted, args }) => {
  const projectsRoot = path.join(trusted.workspaceRoot, "projects");
  const query = typeof args.query === "string" ? args.query.trim().toLocaleLowerCase() : "";
  const limit = z.number().int().min(1).max(4).parse(args.limit ?? 4);
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async (entry) => {
      const foundation = await validateProject(projectsRoot, entry.name);
      if (!foundation.ok || !foundation.manifest || !foundation.workflow) return undefined;
      const workflowInfo = await stat(path.join(projectsRoot, entry.name, "workflow.json"));
      return {
        project_id: foundation.manifest.id,
        title: foundation.manifest.title,
        entry_kind: foundation.workflow.entry_kind,
        stage: foundation.workflow.stage,
        revision: foundation.workflow.revision,
        routing: foundation.workflow.outcome?.status === "closed" ? "closed" : "active",
        ...(foundation.workflow.outcome ? { outcome: foundation.workflow.outcome } : {}),
        last_modified_at: workflowInfo.mtime.toISOString(),
      };
    }));
  return {
    projects: projects.filter((project): project is NonNullable<typeof project> => project !== undefined && (
      query.length === 0
      || project.project_id.toLocaleLowerCase().includes(query)
      || project.title.toLocaleLowerCase().includes(query)
    )).sort((left, right) => (
      right.last_modified_at.localeCompare(left.last_modified_at)
      || left.project_id.localeCompare(right.project_id)
    )).slice(0, limit),
  };
};

export const bootstrapTools: Readonly<Record<string, WorkspaceToolHandler>> = Object.freeze({
  project_initialize: projectInitialize,
  project_list: projectList,
});
