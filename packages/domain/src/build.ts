import {
  canonicalJson,
  contentHash,
  CoreError,
  createQualityPolicySnapshot,
  internalId,
  publishedCardExportPath,
  publishedCardPngExportPath,
  type BuildRecord,
  type OperationRecord,
  type ProjectRepository,
  type PublishRecord,
  type RepositoryWriteSet,
} from "@st-workspace/core";
import { availableCardModes, compileProject, type CardModeSelection } from "@st-workspace/compiler";
import { buildRequiredArtifactManifest } from "./required-artifacts.js";
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

export class BuildService {
  constructor(private readonly repository: ProjectRepository) {}

  async run(operationId: string, request: string, actor: string, options: { mode_selection?: CardModeSelection } = {}): Promise<BuildExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const isPublishRequest = /publish|release|發布|發佈|上線/iu.test(request);
    if (initial.artifacts.length === 0) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "目前沒有可建置的 artifact，請先建立角色或其他產物。" }) : item),
      }));
      return { status: "needs_input", summary: "目前沒有可建置的 artifact。" };
    }
    const availableModes = availableCardModes(initial.artifacts);
    const manifest = buildRequiredArtifactManifest(initial);
    const manifestMode = manifest === undefined || manifest.export_modes === "both" ? undefined : manifest.export_modes;
    const modeUsable = (selection: CardModeSelection): boolean => {
      if (manifestMode !== undefined) {
        if (selection === "both" || selection !== manifestMode) return false;
        return availableModes[manifestMode];
      }
      if (selection === "both") return availableModes.zhuji && availableModes.palette;
      return availableModes[selection];
    };
    const modeSelection = options.mode_selection ?? (manifestMode !== undefined && availableModes[manifestMode] && !(availableModes.zhuji && availableModes.palette) ? manifestMode : undefined);
    if (availableModes.zhuji && availableModes.palette && modeSelection === undefined) {
      const question = manifestMode === undefined
        ? "本次打包同時有珠璣與調色盤模組，請選擇：珠璣、調色盤，或兩者。"
        : `本次打包同時有珠璣與調色盤模組；Blueprint 選定 ${manifestMode === "zhuji" ? "珠璣" : "調色盤"}，本次只能打包該模式。請確認後再試。`;
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
          details: { available_modes: ["zhuji", "palette"], ...(manifestMode === undefined ? {} : { manifest_mode: manifestMode }) },
        }],
      }));
      return { status: "needs_input", summary: question };
    }
    if (modeSelection !== undefined && !modeUsable(modeSelection)) {
      const question = `本次打包可用模式為${availableModes.zhuji ? "珠璣" : ""}${availableModes.zhuji && availableModes.palette ? "、" : ""}${availableModes.palette ? "調色盤" : ""}，請重新選擇。`;
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question }) : item),
      }));
      return { status: "needs_input", summary: question };
    }
    const exactManifest = buildRequiredArtifactManifest(initial, modeSelection === "zhuji" || modeSelection === "palette" ? modeSelection : undefined);
    if (isPublishRequest) {
      const gate = validateWorkflow(initial, "publish", exactManifest);
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
    let coverImage: Uint8Array | undefined;
    if (initial.images.length > 0) {
      const blueprintValue = [...initial.artifacts].reverse().find((artifact) => artifact.kind === "blueprint");
      let primaryCharacterId: string | undefined;
      try {
        if (blueprintValue !== undefined) {
          const parsed = JSON.parse(blueprintValue.content) as { characters?: Array<{ id?: unknown }> };
          if (Array.isArray(parsed.characters) && parsed.characters[0] !== undefined) primaryCharacterId = String(parsed.characters[0].id ?? "");
        }
      } catch {
        primaryCharacterId = undefined;
      }
      const bound = primaryCharacterId === undefined ? undefined : [...initial.images].reverse().find((image) => image.character_id === primaryCharacterId);
      const selected = bound ?? [...initial.images].at(-1);
      if (selected !== undefined) {
        const blob = await this.repository.readBlob(selected.blob_hash);
        if (blob !== undefined) coverImage = blob;
      }
    }
    const compiled = compileProject(initial, { ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }), ...(coverImage === undefined ? {} : { image: coverImage }) });
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
    const jsonBlobRef = { hash, size: Buffer.byteLength(canonicalIr, "utf8") };
    const pngBlobRef = { hash: contentHash(compiled.png), size: compiled.png.byteLength };
    await this.repository.writeBlob(jsonBlobRef.hash, Buffer.from(canonicalIr, "utf8"));
    await this.repository.writeBlob(pngBlobRef.hash, compiled.png);
    const diagnostics = compiled.diagnostics.map((item) => `${item.code}: ${item.message}`);
    const errorDiagnostics = compiled.diagnostics.filter((item) => item.severity === "error");
    const qualityPolicy = createQualityPolicySnapshot(initial.quality_profile, actor, now());
    const isPublish = /publish|release|發布|發佈|上線/iu.test(request);
    const build: BuildRecord = {
      id: internalId("build"),
      operation_id: operationId,
      status: errorDiagnostics.length > 0 ? "failed" : (isPublish ? "built" : "previewed"),
      artifact_ids: artifactIds,
      canonical_ir_ref: jsonBlobRef,
      content_hash: hash,
      diagnostics,
      created_at: now(),
      quality_policy_snapshot: qualityPolicy,
    };
    if (errorDiagnostics.length > 0) {
      const summary = `Build failed: ${diagnostics.join(" ")}`;
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        builds: [...current.builds, build],
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
              status: "blocked",
              question: diagnostics.join(" "),
              result_summary: summary,
              progress: [...item.progress, { item_id: build.id, status: "blocked", message: "compiler diagnostics blocked build" }],
            })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "build.failed",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { build_id: build.id, artifact_ids: artifactIds, content_hash: hash, codes: errorDiagnostics.map((item) => item.code) },
        }],
      }));
      return { build_id: build.id, ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }), status: "blocked", summary };
    }
    const publish: PublishRecord | undefined = isPublish ? {
      id: internalId("publish"),
      operation_id: operationId,
      artifact_ids: artifactIds,
      content_ref: jsonBlobRef,
      content_hash: hash,
      png_ref: pngBlobRef,
      export_json_path: publishedCardExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts, modeSelection),
      export_png_path: publishedCardPngExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts, modeSelection),
      created_at: now(),
    } : undefined;
    const warningCount = compiled.diagnostics.filter((item) => item.severity === "warning").length;
    const summary = `${isPublish ? "發布完成" : "Preview 完成"}，輸出 hash ${hash.slice(0, 12)}。${warningCount > 0 ? `（含 ${warningCount} 個警告）` : ""}`;
    const exportJsonPath = publishedCardExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts, modeSelection);
    const exportPngPath = publishedCardPngExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts, modeSelection);
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
        details: {
          build_id: build.id,
          publish_id: publish?.id,
          artifact_ids: artifactIds,
          content_hash: hash,
          ...(compiled.diagnostics.length > 0 ? { diagnostics: compiled.diagnostics.map((item) => `${item.code}: ${item.message}`) } : {}),
        },
      }],
    }), writeSet);
    return { build_id: build.id, ...(publish === undefined ? {} : { publish_id: publish.id }), ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }), status: "completed", summary };
  }
}
