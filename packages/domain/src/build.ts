import {
  canonicalJson,
  CoreError,
  createQualityPolicySnapshot,
  internalId,
  publishedCardExportPath,
  publishedCardPngExportPath,
  type BuildRecord,
  type IssueSeverity,
  type OperationRecord,
  type ProjectRepository,
  type PublishRecord,
  type RepositoryWriteSet,
} from "@st-workspace/core";
import { availableCardModes, compileProject, type CardModeSelection } from "@st-workspace/compiler";
import { validateWorkflow } from "./workflow-gate.js";

export interface BuildExecutionResult {
  build_id?: string;
  publish_id?: string;
  mode_selection?: CardModeSelection;
  status: "completed" | "needs_input" | "blocked";
  summary: string;
}

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function severityRank(value: IssueSeverity): number {
  return { info: 0, warning: 1, error: 2, critical: 3 }[value];
}

function blockingSeverityRank(value: IssueSeverity | "none"): number {
  return value === "none" ? Number.POSITIVE_INFINITY : severityRank(value);
}

export class BuildService {
  constructor(private readonly repository: ProjectRepository) {}

  async run(operationId: string, request: string, actor: string, options: { mode_selection?: CardModeSelection } = {}): Promise<BuildExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const isPublishRequest = /publish|release|發布|發佈|上線/iu.test(request);
    if (isPublishRequest) {
      const gate = validateWorkflow(initial, "publish");
      if (!gate.ok) {
        const diagnostics = gate.diagnostics.map((item) => `${item.code}: ${item.message}`);
        await this.repository.commit(initial.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, {
            status: "blocked",
            question: diagnostics.join(" "),
            result_summary: `Publish blocked: ${diagnostics.join(" ")}`,
            progress: [...item.progress, { item_id: operationId, status: "blocked", message: "workflow gate blocked publish" }],
          }) : item),
          audit: [...current.audit, {
            id: internalId("audit"),
            operation_id: operationId,
            event: "publish.gate_blocked",
            actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { diagnostics, codes: gate.diagnostics.map((item) => item.code) },
          }],
        }));
        return { status: "blocked", summary: `Publish blocked: ${diagnostics.join(" ")}` };
      }
    }
    if (initial.artifacts.length === 0) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "目前沒有可建置的 artifact，請先建立角色或其他產物。" }) : item),
      }));
      return { status: "needs_input", summary: "目前沒有可建置的 artifact。" };
    }
    const availableModes = availableCardModes(initial.artifacts);
    const modeSelection = availableModes.zhuji && availableModes.palette
      ? options.mode_selection
      : availableModes.zhuji
        ? "zhuji"
        : availableModes.palette
          ? "palette"
          : undefined;
    if (availableModes.zhuji && availableModes.palette && modeSelection === undefined) {
      const question = "本次打包同時有珠璣與調色盤模組，請選擇：珠璣、調色盤，或兩者。";
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question, result_summary: "等待本次打包的模式選擇。" })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "build.mode_selection_required",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { available_modes: ["zhuji", "palette"] },
        }],
      }));
      return { status: "needs_input", summary: question };
    }
    if (modeSelection !== undefined && !availableModes[modeSelection === "both" ? "zhuji" : modeSelection]) {
      const question = `本次打包可用模式為${availableModes.zhuji ? "珠璣" : ""}${availableModes.zhuji && availableModes.palette ? "、" : ""}${availableModes.palette ? "調色盤" : ""}，請重新選擇。`;
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question }) : item),
      }));
      return { status: "needs_input", summary: question };
    }
    const compiled = compileProject(initial, modeSelection === undefined ? {} : { mode_selection: modeSelection });
    const normalized = compiled.normalized;
    const latest = normalized.latestArtifacts;
    /* c8 ignore next -- latestArtifacts is derived from the non-empty artifact list above. */
    if (latest.length === 0) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "目前沒有可建置的 artifact，請先建立角色或其他產物。" }) : item),
      }));
      return { status: "needs_input", summary: "目前沒有可建置的 artifact。" };
    }
    const artifactIds = latest.map((artifact) => artifact.id);
    const canonicalIr = compiled.json;
    const hash = compiled.content_hash;
    const qualityPolicy = createQualityPolicySnapshot(initial.quality_profile, actor, now());
    const blockingIssues = initial.issues.filter((issue) => issue.status === "open" && artifactIds.includes(issue.artifact_id) && severityRank(issue.effective_severity) >= blockingSeverityRank(initial.quality_profile.blocking_severity));
    const isPublish = /publish|release|發布|發佈|上線/iu.test(request);
    const diagnostics = blockingIssues.map((issue) => `${issue.code}: ${issue.message}`);
    const build: BuildRecord = {
      id: internalId("build"),
      operation_id: operationId,
      status: diagnostics.length > 0 ? "failed" : isPublish ? "built" : "previewed",
      artifact_ids: artifactIds,
      canonical_ir: canonicalIr,
      content_hash: hash,
      diagnostics,
      created_at: now(),
      quality_policy_snapshot: qualityPolicy,
    };
    if (diagnostics.length > 0 && isPublish) {
      const state = await this.repository.read();
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        builds: [...current.builds, build],
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "blocked", result_summary: `發布被阻擋：${diagnostics.length} 個 blocking issue。`, question: "請先處理 blocking issue，再重新發布。", progress: [...item.progress, { item_id: build.id, status: "blocked", message: "publish validation failed" }] }) : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "publish.blocked",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { build_id: build.id, artifact_ids: artifactIds, diagnostics },
        }],
      }));
      return { build_id: build.id, status: "blocked", summary: `發布被阻擋：${diagnostics.length} 個 blocking issue。` };
    }

    const publish: PublishRecord | undefined = isPublish ? {
      id: internalId("publish"),
      operation_id: operationId,
      artifact_ids: artifactIds,
      content: canonicalIr,
      content_hash: hash,
      png_base64: compiled.png.toString("base64"),
      export_json_path: publishedCardExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts),
      export_png_path: publishedCardPngExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts),
      created_at: now(),
    } : undefined;
    const summary = isPublish ? `發布完成，輸出 hash ${hash.slice(0, 12)}。` : `Preview 完成，輸出 hash ${hash.slice(0, 12)}。`;
    const exportJsonPath = publishedCardExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts);
    const exportPngPath = publishedCardPngExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts);
    const previousExportPaths = initial.publishes.flatMap((item) => [
      item.export_json_path,
      item.export_png_path,
    ]).filter((item): item is string => item !== undefined);
    const writeSet: RepositoryWriteSet = isPublish ? {
      files: [
        { path: exportJsonPath, content: compiled.json },
        { path: exportPngPath, content: compiled.png },
        { path: ".workspace/plugin-build-trace.json", content: `${canonicalJson(compiled.plugin_trace)}\n` },
      ],
      remove: [
        "exports/ccv3.json",
        "exports/card.json",
        "exports/card.png",
        "exports/manifest.json",
        ...previousExportPaths.filter((item) => item !== exportJsonPath && item !== exportPngPath),
      ],
    } : {};
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      ...(publish === undefined ? {} : { project_status: "published" as const }),
      builds: [...current.builds, build],
      ...(publish === undefined ? {} : { publishes: [...current.publishes, publish] }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", result_summary: summary, progress: [...item.progress, { item_id: build.id, status: "completed", message: isPublish ? "publish transaction committed" : "preview generated" }] })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: isPublish ? "publish.committed" : "build.previewed",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { build_id: build.id, publish_id: publish?.id, artifact_ids: artifactIds, content_hash: hash },
      }],
    }), writeSet);
    return { build_id: build.id, ...(publish === undefined ? {} : { publish_id: publish.id }), ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }), status: "completed", summary };
  }
}
