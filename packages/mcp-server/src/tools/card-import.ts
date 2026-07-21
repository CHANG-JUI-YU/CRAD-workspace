import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  importCardSource,
  importedCardToCanonicalIr,
  roundTripImportedCard,
  writeCorrectedCard,
} from "@card-workspace/compiler";
import { auditCharacterCard } from "@card-workspace/diagnostics";
import { intakeLocalSource, sourceRevision } from "@card-workspace/ingestion";
import {
  canonicalJson,
  computeRevision,
  computeTextRevision,
  assertSafeSegment,
  resolveExistingWithin,
} from "@card-workspace/project";
import {
  cardInspectionReportSchema,
  proposalSchema,
  sourceRevisionSchema,
  workflowStateSchema,
  type ArtifactReference,
  type CardInspectionReport,
} from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";

import { mcpFail } from "../errors.js";
import { numberArg, stringArg, type ToolCallContext } from "./types.js";

const INSPECTION_PATH = ".workflow/inspections/card-inspection.json";
const dispositions = ["retain_report", "corrected_copy", "full_rebuild", "cancel"] as const;

function requireCardImport(context: ToolCallContext): void {
  if (context.workflow.entry_kind !== "card_import" || context.workflow.stage !== "blueprint") {
    mcpFail("CARD_IMPORT_CONTEXT_REQUIRED", "Legacy card inspection requires a card_import workflow at the Blueprint stage");
  }
}

async function readJsonArtifact(projectRoot: string, relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8")) as unknown;
}

export async function loadCardInspection(
  projectRoot: string,
  expectedRevision?: ArtifactReference["revision"],
): Promise<CardInspectionReport> {
  let report: CardInspectionReport;
  try {
    report = cardInspectionReportSchema.parse(await readJsonArtifact(projectRoot, INSPECTION_PATH));
  } catch (error) {
    mcpFail("CARD_INSPECTION_UNAVAILABLE", "A valid persisted card inspection is required", error);
  }
  if (expectedRevision !== undefined && computeRevision(report) !== expectedRevision) {
    mcpFail("CARD_INSPECTION_REVISION_MISMATCH", "Persisted card inspection does not match its workflow artifact reference");
  }
  return report;
}

async function loadAnalysis(context: ToolCallContext) {
  const task = context.workflow.tasks.find((item) => item.id === "analyze-import");
  if (task?.status !== "completed" || !task.result) {
    mcpFail("CARD_IMPORT_ANALYSIS_INCOMPLETE", "Card Import Analyst has not submitted the leased analysis task");
  }
  const value = proposalSchema.parse(await readJsonArtifact(
    context.projectRoot,
    `.workflow/results/${task.id}/${task.result.id}.json`,
  ));
  if (value.value.kind !== "import_analysis" || computeRevision(value) !== task.result.revision) {
    mcpFail("CARD_IMPORT_ANALYSIS_INVALID", "Persisted import analysis does not match its workflow artifact reference");
  }
  return { task, value };
}

function sourceFormat(filePath: string): { format?: "yaml"; mediaType: CardInspectionReport["source"]["media_type"] } {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return { mediaType: "image/png" };
  if (extension === ".json") return { mediaType: "application/json" };
  if (extension === ".yaml" || extension === ".yml") return { format: "yaml", mediaType: "application/yaml" };
  mcpFail("CARD_IMPORT_EXTENSION_DENIED", "Legacy card inspection accepts only PNG, JSON, YAML, or YML files");
}

function exportFormat(report: CardInspectionReport): { extension: "png" | "json" | "yaml"; importFormat?: "yaml" } {
  if (report.source.media_type === "image/png") return { extension: "png" };
  if (report.source.media_type === "application/json") return { extension: "json" };
  return { extension: "yaml", importFormat: "yaml" };
}

export const cardImportTools = {
  card_inspect_local: async (context: ToolCallContext) => {
    requireCardImport(context);
    const task = context.workflow.tasks.find((item) => item.id === "analyze-import");
    if (!task || task.status !== "pending" || task.assigned_agent !== "card-import-analyst") {
      mcpFail("CARD_IMPORT_TASK_UNAVAILABLE", "The pending Card Import Analyst task is required before inspection");
    }
    if (context.workflow.artifacts.some((item) => item.id === "card-inspection")) {
      mcpFail("CARD_INSPECTION_EXISTS", "This project already has a card inspection artifact");
    }

    const filePath = stringArg(context.args, "file_path");
    const format = sourceFormat(filePath);
    const intake = await intakeLocalSource({
      projectRoot: context.projectRoot,
      sourceId: "legacy-card",
      title: path.basename(filePath),
      filePath,
      actor: context.trusted.agentId,
    });
    const snapshot = await readFile(await resolveExistingWithin(context.projectRoot, intake.revision.snapshot.path));
    if (sourceRevision(snapshot) !== intake.revision.raw_hash) {
      mcpFail("CARD_IMPORT_SNAPSHOT_MISMATCH", "Immutable source snapshot hash does not match its intake revision");
    }
    const envelope = importCardSource(snapshot, format.format ? { format: format.format } : {});
    const report = cardInspectionReportSchema.parse({
      schema_version: 1,
      id: "card-inspection",
      source: {
        source_id: intake.source.id,
        revision: intake.revision.id,
        snapshot_revision: intake.revision.raw_hash,
        original_name: path.basename(filePath),
        media_type: format.mediaType,
        byte_size: snapshot.byteLength,
      },
      envelope,
      canonical_passthrough: importedCardToCanonicalIr(envelope).passthrough,
      audit: auditCharacterCard(envelope.card, { strict: true }),
      roundtrip: roundTripImportedCard(envelope),
      supported_dispositions: dispositions,
      extensions: {},
    });
    const revision = computeRevision(report);
    const artifact: ArtifactReference = { id: report.id, revision, contract: "card-inspection@1" };
    const next = await commitWorkflowMutation(context.projectRoot, {
      expectedRevision: numberArg(context.args, "expected_workflow_revision"),
      eventId: stringArg(context.args, "event_id"),
      occurredAt: stringArg(context.args, "occurred_at"),
      actor: context.trusted.agentId,
      operations: [{ relativePath: INSPECTION_PATH, content: canonicalJson(report), expectedAbsent: true }],
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        artifacts: [...state.artifacts, {
          ...artifact,
          status: "reviewed",
          updated_at: stringArg(context.args, "occurred_at"),
          extensions: { source_revision: intake.revision.id },
        }],
        tasks: state.tasks.map((item) => item.id === task.id
          ? { ...item, input_artifacts: [...item.input_artifacts, artifact] }
          : item),
      }),
    });
    return { inspection: report, artifact, workflow: next };
  },

  card_import_report: async (context: ToolCallContext) => {
    requireCardImport(context);
    const inspectionRef = context.workflow.artifacts.find((item) => item.id === "card-inspection");
    if (!inspectionRef?.revision) mcpFail("CARD_INSPECTION_UNAVAILABLE", "Workflow has no card inspection artifact reference");
    const inspection = await loadCardInspection(context.projectRoot, inspectionRef.revision);
    const analysis = await loadAnalysis(context);
    return {
      inspection,
      analyst_analysis: analysis.value,
      dispositions,
      action_availability: {
        retain_report: "available",
        corrected_copy: "available_safe_export",
        full_rebuild: "available_blueprint_gate_required",
        cancel: "available",
      },
    };
  },

  card_import_disposition: async (context: ToolCallContext) => {
    requireCardImport(context);
    const disposition = stringArg(context.args, "disposition") as typeof dispositions[number];
    if (!dispositions.includes(disposition)) mcpFail("CARD_IMPORT_DISPOSITION_INVALID", "Unknown card import disposition");
    const inspectionRef = context.workflow.artifacts.find((item) => item.id === "card-inspection");
    if (!inspectionRef?.revision) mcpFail("CARD_INSPECTION_UNAVAILABLE", "Workflow has no card inspection artifact reference");
    const inspection = await loadCardInspection(context.projectRoot, inspectionRef.revision);
    const analysis = await loadAnalysis(context);
    if (context.workflow.decisions.some((item) => item.kind === "card_import.disposition")) {
      mcpFail("CARD_IMPORT_DISPOSITION_EXISTS", "A card import disposition has already been recorded");
    }
    const occurredAt = stringArg(context.args, "occurred_at");
    const inputArtifacts = [
      { id: inspection.id, revision: computeRevision(inspection), contract: "card-inspection@1" as const },
      analysis.task.result!,
    ];
    let exportOperation: { relativePath: string; content: Buffer; expectedAbsent: true } | undefined;
    let exportArtifact: ArtifactReference | undefined;
    let sourceExpectation: { relativePath: string; expectedRawRevision: ArtifactReference["revision"] } | undefined;
    if (disposition === "corrected_copy") {
      const sourceId = assertSafeSegment(inspection.source.source_id);
      const digest = inspection.source.revision.slice("sha256:".length);
      const revisionPath = `sources/revisions/${sourceId}/${digest}.json`;
      const revision = sourceRevisionSchema.parse(await readJsonArtifact(context.projectRoot, revisionPath));
      if (revision.id !== inspection.source.revision || revision.raw_hash !== inspection.source.snapshot_revision) {
        mcpFail("CARD_IMPORT_SOURCE_REVISION_MISMATCH", "Persisted source revision no longer matches the inspected source");
      }
      const snapshotPath = revision.snapshot.path;
      const snapshot = await readFile(await resolveExistingWithin(context.projectRoot, snapshotPath));
      const currentEnvelope = importCardSource(snapshot, exportFormat(inspection).importFormat ? { format: "yaml" } : {});
      if (currentEnvelope.raw_revision !== inspection.envelope.raw_revision) {
        mcpFail("CARD_IMPORT_SOURCE_REVISION_MISMATCH", "Source bytes changed after inspection");
      }
      const format = exportFormat(inspection);
      const content = writeCorrectedCard(snapshot, currentEnvelope, format.extension);
      const exportPath = `exports/${assertSafeSegment(context.workflow.project_id)}/corrected-card.v3.${format.extension}`;
      exportOperation = { relativePath: exportPath, content, expectedAbsent: true };
      exportArtifact = { id: "corrected-copy", revision: computeTextRevision(content), contract: "character-card-v3@1" };
      sourceExpectation = {
        relativePath: snapshotPath,
        expectedRawRevision: inspection.envelope.raw_revision,
      };
    }
    const closesWorkflow = disposition !== "full_rebuild";
    const decisionId = stringArg(context.args, "decision_id");
    const next = await commitWorkflowMutation(context.projectRoot, {
      expectedRevision: numberArg(context.args, "expected_workflow_revision"),
      eventId: stringArg(context.args, "event_id"),
      occurredAt,
      actor: context.trusted.agentId,
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        decisions: [...state.decisions, {
          id: decisionId,
          kind: "card_import.disposition",
          actor: "opencode-user",
          decided_at: occurredAt,
          input_revisions: inputArtifacts,
          summary: stringArg(context.args, "summary"),
          option: disposition,
          extensions: { source_immutable: true },
        }],
        tasks: disposition === "full_rebuild" ? [...state.tasks, {
          id: "create-blueprint",
          kind: "create-blueprint",
          status: "pending",
          assigned_agent: "director",
          capabilities: ["task.execute", "blueprint.propose"],
          input_artifacts: inputArtifacts,
          output_contract: "proposal@1",
          dependencies: [analysis.task.id],
          attempt: 0,
          max_attempts: 3,
          extensions: { stage: "blueprint", disposition: "full_rebuild" },
        }] : state.tasks,
        artifacts: exportArtifact ? [...state.artifacts, {
          ...exportArtifact,
          status: "reviewed",
          updated_at: occurredAt,
          extensions: { export_path: exportOperation!.relativePath, source_revision: inspection.envelope.raw_revision },
        }] : state.artifacts,
        outcome: closesWorkflow ? {
          status: "closed",
          kind: disposition === "corrected_copy" ? "corrected_copy_exported"
            : disposition === "retain_report" ? "report_retained" : "cancelled",
          closed_at: occurredAt,
          decision_id: decisionId,
          ...(exportArtifact ? { artifact: {
            ...exportArtifact,
            status: "reviewed",
            updated_at: occurredAt,
            extensions: { export_path: exportOperation!.relativePath },
          } } : {}),
        } : undefined,
      }),
      ...(sourceExpectation ? { expectations: [sourceExpectation] } : {}),
      ...(exportOperation ? { workspaceTransaction: {
        root: context.trusted.workspaceRoot,
        projectPrefix: `projects/${assertSafeSegment(context.workflow.project_id)}`,
        operations: [exportOperation],
      } } : {}),
    });
    return {
      workflow: next,
      disposition,
      source_modified: false,
      workflow_closed: closesWorkflow,
      ...(exportOperation ? { export_path: exportOperation.relativePath, export_revision: exportArtifact!.revision } : {}),
      blueprint_gate: disposition === "full_rebuild" ? "pending_user_approval" : "not_applicable",
    };
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
