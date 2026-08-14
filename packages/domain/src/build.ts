import {
  buildProvenanceCompositionSummary,
  canonicalJson,
  computeBuildPlan,
  computeBuildSnapshotHash,
  computeProjectProjection,
  contentHash,
  CoreError,
  createQualityPolicySnapshot,
  internalId,
  provenanceConfirmationFingerprint,
  publishedCardExportPath,
  publishedCardPngExportPath,
  resolveCoverImageIdentity,
  type BuildRecord,
  type OperationRecord,
  type ProjectRepository,
  type PublishRecord,
  type RepositoryWriteSet,
} from "@st-workspace/core";
import { compileProject, type CardModeSelection } from "@st-workspace/compiler";
import { buildRequiredArtifactManifest } from "./required-artifacts.js";
import { validateWorkflow } from "./workflow-gate.js";
import { buildCoverageSnapshot, coverageAssessmentFreshness, projectActiveCoverageBindings } from "./coverage-assessment.js";
import { assertExecutionLease, assertExecutionLeaseForOperation, resolveExecutionActors, type ExecutionActorInput } from "./execution-context.js";
import { resolveBuildModeSelection } from "./build-mode.js";

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

  async run(operationId: string, request: string, actorInput: ExecutionActorInput, options: { mode_selection?: CardModeSelection; expected_provenance_fingerprint?: string } = {}): Promise<BuildExecutionResult> {
    const { auditActor: actor, context: execution } = resolveExecutionActors(actorInput);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const isPublishRequest = /publish|release|發布|發佈|上線/iu.test(request);
    if (initial.artifacts.length === 0) {
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "目前沒有可建置的 artifact，請先建立角色或其他產物。" }) : item),
        };
      });
      return { status: "needs_input", summary: "目前沒有可建置的 artifact。" };
    }
    const projection = computeProjectProjection(initial);
    const manifest = buildRequiredArtifactManifest(initial);
    const modeResolution = resolveBuildModeSelection(initial, options.mode_selection);
    if (modeResolution.status === "needs_input" || modeResolution.status === "invalid") {
      const question = modeResolution.question ?? "請選擇打包模式。";
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
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
            details: { available_modes: ["zhuji", "palette"], ...(modeResolution.manifest_mode === undefined ? {} : { manifest_mode: modeResolution.manifest_mode }), ...(modeResolution.reason === undefined ? {} : { reason: modeResolution.reason }) },
          }],
        };
      });
      return { status: "needs_input", summary: question };
    }
    const modeSelection = modeResolution.mode_selection;
    const exactManifest = buildRequiredArtifactManifest(initial, modeSelection === "zhuji" || modeSelection === "palette" ? modeSelection : undefined);
    if (isPublishRequest) {
      const gate = validateWorkflow(initial, "publish", exactManifest);
      if (!gate.ok) {
        const diagnostics = gate.diagnostics.map((item) => `${item.code}: ${item.message}`);
        await this.repository.commit(initial.revision, (current) => {
          assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
          return {
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
          };
        });
        return { status: "blocked", summary: `Publish blocked: ${diagnostics.join(" ")}` };
      }
      if (options.expected_provenance_fingerprint === undefined) {
        const summary = "Publish requires provenance confirmation: please prepare and confirm the immutable provenance composition before publishing.";
        await this.repository.commit(initial.revision, (current) => {
          assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
          return {
            ...current,
            operations: current.operations.map((item) => item.id === operationId
              ? updateOperation(item, {
                  status: "blocked",
                  question: summary,
                  result_summary: summary,
                  progress: [...item.progress, { item_id: operationId, status: "blocked", message: "provenance confirmation required for publish" }],
                })
              : item),
            audit: [...current.audit, {
              id: internalId("audit"),
              operation_id: operationId,
              event: "publish.confirmation_required",
              actor,
              occurred_at: now(),
              project_revision: current.revision + 1,
              details: { codes: ["PROVENANCE_CONFIRMATION_REQUIRED"] },
            }],
          };
        });
        return { status: "blocked", summary };
      }
    }
    const buildWarnings: string[] = [];
    let coverImage: Uint8Array | undefined;
    let imageIdentity = resolveCoverImageIdentity(initial, manifest?.primary_character_id).identity;
    const isCharacterCardExport = manifest?.primary_character_id !== undefined || projection.currentArtifacts.some((art) => art.kind === "character");
    if (initial.images.length === 0) {
      if (isCharacterCardExport) {
        buildWarnings.push("CARD_IMAGE_MISSING: 專案尚未上傳角色圖片；本次輸出將使用內建佔位圖。");
      }
    } else {
      const resolved = resolveCoverImageIdentity(initial, manifest?.primary_character_id);
      if (resolved.selected === undefined) {
        buildWarnings.push("CARD_IMAGE_MISSING: 找不到 primary 角色的已上傳圖片，也沒有未綁定角色的封面圖；本次輸出將使用內建佔位圖。");
      } else {
        const blob = await this.repository.readBlob(resolved.selected.blob_hash);
        if (blob === undefined) {
          buildWarnings.push(`CARD_IMAGE_MISSING: 角色圖 ${resolved.selected.id} 的 blob 遺失；本次輸出將使用內建佔位圖。`);
          imageIdentity = { mode: "placeholder" };
        } else {
          coverImage = blob;
        }
      }
    }
    const compiled = compileProject(initial, { ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }), ...(coverImage === undefined ? {} : { image: coverImage }) });
    const normalized = compiled.normalized;
    const latest = normalized.latestArtifacts;
    /* c8 ignore next -- latestArtifacts is derived from the non-empty artifact list above. */
    if (latest.length === 0) {
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "目前沒有可建置的 artifact，請先建立角色或其他產物。" }) : item),
        };
      });
      return { status: "needs_input", summary: "目前沒有可建置的 artifact。" };
    }
    const artifactIds = latest.map((artifact) => artifact.id);
    const canonicalIr = compiled.json;
    const hash = compiled.content_hash;
    const jsonBlobRef = { hash, size: Buffer.byteLength(canonicalIr, "utf8") };
    const pngBlobRef = { hash: contentHash(compiled.png), size: compiled.png.byteLength };
    await assertExecutionLease(this.repository, execution);
    const diagnostics = [...buildWarnings, ...compiled.diagnostics.map((item) => `${item.code}: ${item.message}`)];
    const errorDiagnostics = compiled.diagnostics.filter((item) => item.severity === "error");
    const qualityPolicy = createQualityPolicySnapshot(initial.quality_profile, actor, now());
    const isPublish = /publish|release|發布|發佈|上線/iu.test(request);

    const sourceAdaptation = projection.intent.is_source_adaptation;
    const latestAssessment = initial.coverage_assessments.at(-1);
    const plan = computeBuildPlan(initial, modeSelection);
    const coverageDiagnostics: Array<{ code: string; severity: "error"; message: string }> = [];
    if (sourceAdaptation) {
      if (latestAssessment === undefined || latestAssessment.pass !== "formal") {
        coverageDiagnostics.push({
          code: "COVERAGE_ASSESSMENT_REQUIRED",
          severity: "error",
          message: "尚未建立通過 Fact Review 的 formal coverage assessment；無法固定 coverage snapshot。",
        });
      } else if (!coverageAssessmentFreshness(initial, latestAssessment)) {
        coverageDiagnostics.push({
          code: "COVERAGE_ASSESSMENT_STALE",
          severity: "error",
          message: "最新 coverage assessment 已過期；請重新執行 formal assessment 後再打包。",
        });
      } else {
        for (const projected of projectActiveCoverageBindings(initial, plan)) {
          if (projected.status === "missing") {
            coverageDiagnostics.push({ code: "COVERAGE_AUTHORING_BINDING_MISSING", severity: "error", message: `Artifact ${projected.entry.artifact_id}（${projected.entry.kind}）缺少 coverage authoring binding；請重新 authoring 該產物。` });
          } else if (projected.status === "stale") {
            coverageDiagnostics.push({ code: "COVERAGE_AUTHORING_BINDING_STALE", severity: "error", message: `Artifact ${projected.entry.artifact_id} 的 coverage binding 已過期；請重新 authoring 該產物。` });
          } else if (projected.status === "duplicate") {
            coverageDiagnostics.push({ code: "COVERAGE_AUTHORING_BINDING_DUPLICATE", severity: "error", message: `Artifact ${projected.entry.artifact_id} 有多筆 current binding；請檢查 binding 記錄。` });
          }
        }
      }
    }
    const coverageSnapshot = latestAssessment === undefined ? undefined : buildCoverageSnapshot(initial, latestAssessment, plan);
    const buildSnapshotHash = computeBuildSnapshotHash(initial, plan, modeSelection, coverageSnapshot, imageIdentity);
    const provenanceSummary = buildProvenanceCompositionSummary(initial, coverageSnapshot, buildSnapshotHash, hash, imageIdentity);
    const confirmationFingerprint = provenanceConfirmationFingerprint(provenanceSummary);
    if (options.expected_provenance_fingerprint !== undefined && options.expected_provenance_fingerprint !== confirmationFingerprint) {
      const summary = "Provenance confirmation mismatch: build inputs changed after preview; please re-preview before publishing.";
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, {
            status: "blocked",
            question: summary,
            result_summary: summary,
            progress: [...item.progress, { item_id: operationId, status: "blocked", message: "provenance confirmation mismatch" }],
          }) : item),
          audit: [...current.audit, {
            id: internalId("audit"),
            operation_id: operationId,
            event: "provenance.confirmation.rejected",
            actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { expected: options.expected_provenance_fingerprint, actual: confirmationFingerprint, build_snapshot_hash: buildSnapshotHash, codes: ["PROVENANCE_CONFIRMATION_STALE"] },
          }],
        };
      });
      return { status: "blocked", summary };
    }
    const build: BuildRecord = {
      id: internalId("build"),
      operation_id: operationId,
      status: errorDiagnostics.length > 0 || coverageDiagnostics.length > 0 ? "failed" : (isPublish ? "built" : "previewed"),
      artifact_ids: artifactIds,
      ...(errorDiagnostics.length === 0 && coverageDiagnostics.length === 0 ? { canonical_ir_ref: jsonBlobRef } : {}),
      content_hash: hash,
      diagnostics: [...coverageDiagnostics.map((item) => `${item.code}: ${item.message}`), ...diagnostics],
      created_at: now(),
      quality_policy_snapshot: qualityPolicy,
      ...(coverageSnapshot === undefined ? {} : { coverage_snapshot: coverageSnapshot }),
      provenance_summary: provenanceSummary,
    };

    if (errorDiagnostics.length > 0 || coverageDiagnostics.length > 0) {
      const summary = `Build failed: ${build.diagnostics.join(" ")}`;
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
          ...current,
          builds: [...current.builds, build],
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, {
                status: "blocked",
                question: build.diagnostics.join(" "),
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
            details: { build_id: build.id, artifact_ids: artifactIds, content_hash: hash, codes: [...errorDiagnostics.map((item) => item.code), ...coverageDiagnostics.map((item) => item.code)] },
          }],
        };
      });
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
      ...(coverageSnapshot === undefined ? {} : { coverage_snapshot: coverageSnapshot }),
      provenance_summary: provenanceSummary,
    } : undefined;

    const warningCount = buildWarnings.length + compiled.diagnostics.filter((item) => item.severity === "warning").length;
    const summary = `${isPublish ? "發布完成" : "Preview 完成"}，輸出 hash ${hash.slice(0, 12)}。${warningCount > 0 ? `（含 ${warningCount} 個警告）` : ""}`;
    const exportJsonPath = publishedCardExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts, modeSelection);
    const exportPngPath = publishedCardPngExportPath(initial.project_name, initial.project_id, normalized.latestArtifacts, modeSelection);
    const previousExportPaths = initial.publishes.flatMap((item) => [
      item.export_json_path,
      item.export_png_path,
    ]).filter((item): item is string => item !== undefined);
    const writeSet: RepositoryWriteSet = {
      blobs: [
        { hash: jsonBlobRef.hash, content: Buffer.from(canonicalIr, "utf8") },
        ...(isPublish ? [{ hash: pngBlobRef.hash, content: compiled.png }] : []),
      ],
      ...(isPublish ? {
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
      } : {}),
    };
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
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
            build_snapshot_hash: buildSnapshotHash,
            compiled_content_hash: hash,
            ...(options.expected_provenance_fingerprint === undefined ? {} : { confirmation_fingerprint: confirmationFingerprint }),
            ...(diagnostics.length > 0 ? { diagnostics } : {}),
            ...(coverageSnapshot === undefined ? {} : { coverage_snapshot_hash: coverageSnapshot.snapshot_hash }),
          },
        }],
      };
    }, writeSet);
    await assertExecutionLease(this.repository, execution);
    return { build_id: build.id, ...(publish === undefined ? {} : { publish_id: publish.id }), ...(modeSelection === undefined ? {} : { mode_selection: modeSelection }), status: "completed", summary };
  }
}
