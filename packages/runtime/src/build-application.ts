import { canonicalCardJson, characterCardV3Schema, type CharacterCardV3 } from "@st-workspace/adapters-ccv3";
import { isBuiltInPlaceholderImage, readCardFromPng, readPngImageInfo } from "@st-workspace/adapters-png";
import { computeProjectProjection, contentHash, deriveCoverImageFreshness, publishedCardExportPath, publishedCardPngExportPath, type ProjectRepository, type RepairInspection, type RepairReport } from "@st-workspace/core";
import { buildRequiredArtifactManifest, resolveBuildModeSelection, reviewRunProjectionRevision, validateWorkflow, type WorkflowGateResult } from "@st-workspace/domain";
import { availableCardModesRuntime, latestByKey } from "./operation-runner.js";
import type { DashboardBlueprint, DashboardBuildReadiness, DashboardSnapshot, TavernCheckResult, TavernCompatibilityReport } from "./runtime-views.js";
import type { CardModeSelection } from "@st-workspace/compiler";

export interface BuildApplicationDeps {
  repository: ProjectRepository;
}

export async function dashboardSnapshot(deps: BuildApplicationDeps): Promise<DashboardSnapshot> {
  const state = await deps.repository.read();
  const repair = await deps.repository.inspectRepair();
  const blueprintArtifact = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint");
  let blueprint: DashboardBlueprint | undefined;
  if (blueprintArtifact !== undefined) {
    try {
      const parsed = JSON.parse(blueprintArtifact.content) as Record<string, unknown>;
      const characters = Array.isArray(parsed.characters) ? parsed.characters.map((item: unknown) => {
        const record = item as { id?: unknown; label?: unknown; mode?: unknown };
        return { id: String(record.id ?? ""), label: String(record.label ?? record.id ?? ""), mode: String(record.mode ?? "") };
      }) : [];
      const worldValue = parsed.world !== null && typeof parsed.world === "object" && !Array.isArray(parsed.world) ? parsed.world as Record<string, unknown> : undefined;
      blueprint = { revision: blueprintArtifact.revision, characters, ...(worldValue === undefined ? {} : { world: worldValue }) };
    } catch {
      blueprint = undefined;
    }
  }
  const imageManifest = buildRequiredArtifactManifest(state);
  const latestPublish = state.publishes.at(-1);
  const latestBuild = state.builds.at(-1);
  const recordedImageIdentity = latestBuild?.provenance_summary?.image_identity ?? latestPublish?.provenance_summary?.image_identity;
  const imageFreshness = latestPublish === undefined
    ? { status: "unknown" as const, reason: "尚未發布。" }
    : deriveCoverImageFreshness(state, recordedImageIdentity, imageManifest?.primary_character_id);
  const dashboardBase = {
    project: {
      project_id: state.project_id,
      ...(state.project_name === undefined ? {} : { project_name: state.project_name }),
      project_status: state.project_status,
      revision: state.revision,
      interview_status: state.interview.status,
      ...(state.interview.flow === undefined ? {} : { interview_flow: state.interview.flow }),
      answers_count: state.interview.answers.length,
    },
    ...(blueprint === undefined ? {} : { blueprint }),
    ...(imageManifest === undefined ? {} : {
      roster: imageManifest.characters.map((character) => ({
        id: character.character_id,
        label: character.display_name || character.character_id,
        ...(character.mode === undefined ? {} : { mode: character.mode }),
      })),
      ...(imageManifest.primary_character_id === undefined ? {} : { primary_character_id: imageManifest.primary_character_id }),
    }),
    images_stale: imageFreshness.status === "stale",
    ...(imageFreshness.reason === undefined ? {} : { images_stale_reason: imageFreshness.reason }),
    images_freshness: imageFreshness,
    prechecks: state.blueprint_prechecks.map((precheck) => ({
      id: precheck.id,
      status: precheck.status,
      candidate_blueprint_revision: precheck.candidate_blueprint_revision,
      checks_count: precheck.checks.length,
      checks: precheck.checks.map((check) => ({
        subject_id: check.subject_id,
        dimension: check.dimension,
        uncertainty: check.uncertainty,
        impact: check.impact,
        basis: check.basis,
        action: check.action,
        ...(check.user_answer === undefined ? {} : { user_answer: check.user_answer }),
        ...(check.intake_key === undefined ? {} : { intake_key: check.intake_key }),
      })),
    })),
  };
  const artifactViews: DashboardSnapshot["artifacts"] = state.artifacts.map((artifact) => ({
    id: artifact.id,
    key: artifact.key,
    kind: artifact.kind,
    name: artifact.name,
    revision: artifact.revision,
    status: artifact.status,
    ...(artifact.created_by === undefined ? {} : { created_by: artifact.created_by }),
    ...(artifact.based_on === undefined ? {} : { based_on: artifact.based_on }),
    content_hash: artifact.content_hash,
    ...(artifact.blueprint_precheck_id === undefined ? {} : { blueprint_precheck_id: artifact.blueprint_precheck_id }),
    ...(artifact.blueprint_precheck_revision === undefined ? {} : { blueprint_precheck_revision: artifact.blueprint_precheck_revision }),
    content: artifact.content,
    ...(artifact.media_type === undefined ? {} : { media_type: artifact.media_type }),
    created_at: artifact.created_at,
    ...(artifact.updated_at === undefined ? {} : { updated_at: artifact.updated_at }),
  }));
  const artifactGroups: DashboardSnapshot["artifact_groups"] = [];
  for (const view of artifactViews) {
    const groupIndex = artifactGroups.findIndex((candidate) => candidate.key === view.key);
    if (groupIndex === -1) {
      artifactGroups.push({ key: view.key, current: view, revisions: [view] });
    } else {
      const existingGroup = artifactGroups[groupIndex]!;
      existingGroup.revisions.push(view);
      existingGroup.current = view;
    }
  }
  return {
    ...dashboardBase,
    artifacts: artifactViews,
    artifact_groups: artifactGroups,
    images: state.images.map((image) => ({
      id: image.id,
      ...(image.character_id === undefined ? {} : { character_id: image.character_id }),
      width: image.width,
      height: image.height,
      ...(image.aspect_ratio === undefined ? {} : { aspect_ratio: image.aspect_ratio }),
      ...(image.source === undefined ? {} : { source: image.source }),
      ...(image.license === undefined ? {} : { license: image.license }),
      created_at: image.created_at,
      updated_at: image.updated_at,
    })),
    facts: state.facts.map((fact) => {
      const evidenceQuote = fact.evidence[0] ?? fact.evidence_refs?.[0]?.quote;
      const firstEvidenceRef = fact.evidence_refs?.[0];
      const decision = fact.decision_id === undefined ? undefined : state.fact_review_decisions.find((item) => item.id === fact.decision_id);
      return {
        id: fact.id,
        statement: fact.statement,
        status: fact.status,
        ...(fact.subject === undefined ? {} : { subject: fact.subject }),
        ...(fact.predicate === undefined ? {} : { predicate: fact.predicate }),
        ...(fact.value === undefined ? {} : { value: fact.value }),
        ...(fact.classification === undefined ? {} : { classification: fact.classification }),
        ...(fact.coverage === undefined ? {} : { coverage: fact.coverage }),
        source_ids: fact.source_ids,
        ...(fact.review_run_id === undefined ? {} : { review_run_id: fact.review_run_id }),
        ...(fact.decision_id === undefined ? {} : { decision_id: fact.decision_id }),
        ...(evidenceQuote === undefined ? {} : { evidence_quote: String(evidenceQuote) }),
        ...(fact.fact_revision === undefined ? {} : { fact_revision: fact.fact_revision }),
        ...(fact.evidence_refs === undefined ? {} : { evidence_refs_count: fact.evidence_refs.length }),
        ...(firstEvidenceRef === undefined ? {} : {
          ...(firstEvidenceRef.locator === undefined ? {} : { locator: firstEvidenceRef.locator }),
          ...(firstEvidenceRef.character_range === undefined ? {} : { character_range: firstEvidenceRef.character_range }),
          ...(firstEvidenceRef.chunk_id === undefined ? {} : { chunk_id: firstEvidenceRef.chunk_id }),
        }),
        ...(decision === undefined ? {} : { last_reviewer: decision.reviewer_identity, last_decision: decision.decision }),
      };
    }),
    sources: state.sources.map((source) => {
      const candidate = state.candidates.find((item) => item.id === source.candidate_id);
      return {
        id: source.id,
        candidate_id: source.candidate_id,
        title: source.title,
        revision: source.revision,
        media_type: source.media_type,
        ...(source.original_name === undefined ? {} : { original_name: source.original_name }),
        ...(candidate === undefined ? {} : { ...(candidate.url === undefined ? {} : { url: candidate.url }) }),
        ...(candidate === undefined ? {} : { ...(candidate.official === undefined ? {} : { official: candidate.official }) }),
        chunk_count: state.knowledge_chunks.filter((chunk) => chunk.source_id === source.id).length,
        canonical_chars: source.canonical_text.length,
        ...(source.selection_snapshot === undefined ? {} : { selection_snapshot: source.selection_snapshot }),
      };
    }),
    candidates: state.candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
      ...(candidate.url === undefined ? {} : { url: candidate.url }),
      ...(candidate.domain === undefined ? {} : { domain: candidate.domain }),
      status: candidate.status,
      ...(candidate.official === undefined ? {} : { official: candidate.official }),
      ...(candidate.failure === undefined ? {} : { failure: candidate.failure }),
      ...(candidate.selection_snapshot === undefined ? {} : { selection_snapshot: candidate.selection_snapshot }),
    })),
    operations: (() => {
      const failedClasses = new Map<string, "recoverable" | "fatal">();
      for (const entry of state.audit) {
        if (entry.operation_id !== undefined && entry.event === "operation.failed" && typeof entry.details.recoverable === "boolean") {
          failedClasses.set(entry.operation_id, entry.details.recoverable ? "recoverable" : "fatal");
        }
      }
      return state.operations.map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        status: operation.status,
        request: operation.request,
        ...(operation.actor === undefined ? {} : { actor: operation.actor }),
        ...(operation.question === undefined ? {} : { question: operation.question }),
        ...(operation.lease_owner === undefined ? {} : { lease_owner: operation.lease_owner }),
        ...(operation.lease_expires_at === undefined ? {} : { lease_expires_at: operation.lease_expires_at }),
        ...(operation.attempt === undefined ? {} : { attempt: operation.attempt }),
        ...(operation.last_error === undefined ? {} : { last_error: operation.last_error }),
        ...(failedClasses.get(operation.id) === undefined ? {} : { error_class: failedClasses.get(operation.id) }),
        created_at: operation.created_at,
        updated_at: operation.updated_at,
        progress_count: operation.progress.length,
        ...(operation.progress.length === 0 ? {} : { progress: operation.progress.slice(-3).map((item) => ({ status: item.status, message: item.message })) }),
      }));
    })(),
    issues: state.issues.map((issue) => {
      const overrideRecord = issue.override === undefined ? undefined : issue.override;
      return {
        id: issue.id,
        artifact_id: issue.artifact_id,
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
        effective_severity: issue.effective_severity,
        status: issue.status,
        created_at: issue.created_at,
        ...(issue.updated_at === undefined ? {} : { updated_at: issue.updated_at }),
        overridable: issue.overridable === true,
        ...(overrideRecord === undefined ? {} : {
          override: {
            ...(overrideRecord.severity === undefined ? {} : { severity: overrideRecord.severity }),
            against_effective_severity: overrideRecord.against_effective_severity,
            reason: overrideRecord.reason,
            by: overrideRecord.by,
            timestamp: overrideRecord.timestamp,
          },
        }),
      };
    }),
    reviews: state.reviews.map((review) => ({ id: review.id, artifact_id: review.artifact_id, artifact_revision: review.artifact_revision, reviewer: review.reviewer, status: review.status })),
    quality: { ...(state.quality_profile.level === undefined ? {} : { level: state.quality_profile.level }), blocking_severity: state.quality_profile.blocking_severity, overrides: state.quality_profile.overrides },
    review_runs: state.fact_review_runs.map((run) => ({
      id: run.id,
      status: run.status,
      candidate_occurrence_ids: run.candidate_occurrence_ids,
      candidate_set_revision: run.candidate_set_revision,
      projection_revision: reviewRunProjectionRevision(state, run.id),
      policy_revision: run.policy_revision,
      created_by: run.created_by,
      created_at: run.created_at,
      ...(run.completed_at === undefined ? {} : { completed_at: run.completed_at }),
      ...(run.curation_run_id === undefined ? {} : { curation_run_id: run.curation_run_id }),
      source_revisions: run.source_revisions,
      decisions: state.fact_review_decisions.filter((item) => item.review_run_id === run.id).map((item) => ({
        candidate_occurrence_id: item.candidate_occurrence_id,
        decision: item.decision,
        reviewer_identity: item.reviewer_identity,
        reason: item.reason,
      })),
      candidates: run.candidate_occurrence_ids.map((occurrenceId) => {
        const fact = state.facts.find((item) => item.candidate_occurrence_id === occurrenceId);
        return {
          candidate_occurrence_id: occurrenceId,
          statement: fact?.statement ?? "（候選事實不存在）",
          status: fact?.status ?? "candidate",
        };
      }),
    })),
    publishes: state.publishes.map((publish) => ({ id: publish.id, content_hash: publish.content_hash, created_at: publish.created_at, ...(publish.export_json_path === undefined ? {} : { export_json_path: publish.export_json_path }), ...(publish.export_png_path === undefined ? {} : { export_png_path: publish.export_png_path }) })),
    builds: state.builds.map((build) => ({ id: build.id, status: build.status, content_hash: build.content_hash, created_at: build.created_at })),
    repair,
  };
}

export async function publishPreview(deps: BuildApplicationDeps, mode?: CardModeSelection): Promise<WorkflowGateResult> {
  const state = await deps.repository.read();
  const resolution = resolveBuildModeSelection(state, mode);
  if (resolution.status === "invalid") {
    return {
      ok: false,
      diagnostics: [{ code: "BUILD_MODE_INVALID", message: resolution.reason ?? "所要求的建置模式無效。", severity: "error" }],
    };
  }
  if (resolution.status === "needs_input") {
    return {
      ok: false,
      diagnostics: [{ code: "MODE_SELECTION_REQUIRED", message: resolution.reason ?? "同時存在 Zhuji 與 Palette 模組；請先選擇本次打包模式（zhuji、palette 或 both）再檢查就緒狀態。", severity: "error" }],
    };
  }
  const effective = resolution.mode_selection;
  const manifest = buildRequiredArtifactManifest(state, effective === "both" ? undefined : effective);
  return validateWorkflow(state, "publish", manifest);
}

export async function buildReadiness(deps: BuildApplicationDeps): Promise<DashboardBuildReadiness> {
  const state = await deps.repository.read();
  const projection = computeProjectProjection(state);
  const manifest = buildRequiredArtifactManifest(state);
  const current = [...projection.currentArtifacts];
  const modes = availableCardModesRuntime(state);
  let primary: { id: string; label: string; mode: string } | undefined;
  if (manifest !== undefined && manifest.primary_character_id !== undefined) {
    const rosterEntry = manifest.characters.find((character) => character.character_id === manifest.primary_character_id);
    if (rosterEntry !== undefined) {
      primary = { id: rosterEntry.character_id, label: rosterEntry.display_name, mode: rosterEntry.mode ?? "" };
    }
  }
  if (primary === undefined) {
    const first = projection.roster.find((character) => character.is_primary) ?? projection.roster[0];
    if (first !== undefined) {
      const mode = projection.blueprint?.characters.find((character) => character.id === first.id)?.mode ?? "";
      primary = { id: first.id, label: first.label, mode };
    }
  }
  const entryKinds: ReadonlySet<string> = new Set(["world_lore", "relationship", "greeting", "wardrobe", "plugin", "zhuji", "palette"]);
  const entries = current.filter((artifact) => entryKinds.has(artifact.kind))
    .filter((artifact) => {
      if (artifact.kind === "zhuji") return modes.zhuji;
      if (artifact.kind === "palette") return modes.palette;
      return true;
    })
    .map((artifact) => ({
      kind: artifact.kind,
      name: artifact.name,
      char_count: artifact.content.length,
      estimated_tokens: Math.ceil(artifact.content.length / 4),
      artifact_id: artifact.id,
      revision: artifact.revision,
    }));
  let firstGreeting: string | undefined;
  let alternateGreetingCount = 0;
  let groupGreetingCount = 0;
  let greetingTotal = 0;
  for (const artifact of current) {
    if (artifact.kind !== "greeting") continue;
    try {
      const value = JSON.parse(artifact.content) as { document?: { greetings?: Array<{ kind?: unknown; content?: unknown }> } };
      const greetings = Array.isArray(value.document?.greetings) ? value.document.greetings : [];
      for (const greeting of greetings) {
        greetingTotal += 1;
        if (greeting.kind === "primary" && firstGreeting === undefined && typeof greeting.content === "string") {
          firstGreeting = greeting.content.length > 120 ? `${greeting.content.slice(0, 120)}…` : greeting.content;
        } else if (greeting.kind === "alternate") {
          alternateGreetingCount += 1;
        } else if (greeting.kind === "group_only") {
          groupGreetingCount += 1;
        }
      }
    } catch {
      // Malformed greeting artifacts surface through normal gate diagnostics.
    }
  }
  const contentKinds: ReadonlySet<string> = new Set(["character", "relationship", "world_lore", "greeting", "zhuji", "palette", "wardrobe", "plugin"]);
  const pngExpected = current.some((artifact) => contentKinds.has(artifact.kind));
  const pluginIds = current.filter((artifact) => artifact.kind === "plugin").flatMap((artifact) => {
    try {
      const value = JSON.parse(artifact.content) as { plugin_id?: unknown };
      return typeof value.plugin_id === "string" ? [value.plugin_id] : [];
    } catch {
      return [];
    }
  });
  const cardName = state.project_name ?? state.project_id;
  const exportModes = manifest?.export_modes;
  const outputMode = exportModes === "zhuji" || exportModes === "palette" ? exportModes : exportModes === "both" ? "both" : undefined;
  const outputPaths = {
    json: publishedCardExportPath(state.project_name, state.project_id, current, outputMode),
    png: publishedCardPngExportPath(state.project_name, state.project_id, current, outputMode),
  };
  const bothAvailable = modes.zhuji && modes.palette;
  const bothBlockers: Array<{ mode: "zhuji" | "palette"; reason: string; diagnostics: Array<{ code: string; message: string }> }> = [];
  if (!modes.zhuji) {
    const zhujiDiag = (manifest?.diagnostics ?? []).filter((d) => d.code.toLowerCase().includes("zhuji") || d.message.toLowerCase().includes("zhuji"));
    bothBlockers.push({
      mode: "zhuji",
      reason: "Zhuji 模式未就緒（缺少必要模組或審查未通過）",
      diagnostics: zhujiDiag.length > 0 ? zhujiDiag : [{ code: "ZHUJI_MODULES_INCOMPLETE", message: "Zhuji 模組未完全準備完成" }],
    });
  }
  if (!modes.palette) {
    const paletteDiag = (manifest?.diagnostics ?? []).filter((d) => d.code.toLowerCase().includes("palette") || d.message.toLowerCase().includes("palette"));
    bothBlockers.push({
      mode: "palette",
      reason: "Palette 模式未就緒（缺少必要模組或審查未通過）",
      diagnostics: paletteDiag.length > 0 ? paletteDiag : [{ code: "PALETTE_MODULES_INCOMPLETE", message: "Palette 模組未完全準備完成" }],
    });
  }

  const missing = manifest === undefined ? [] : manifest.characters.flatMap((character) => character.missing_modules.map((module) => `${character.character_id}:${module}`));
  const latestBuild = [...state.builds].reverse().find((build) => build.status === "previewed" || build.status === "built");
  return {
    modes,
    both_available: bothAvailable,
    ...(bothBlockers.length === 0 ? {} : { both_blockers: bothBlockers }),
    ...(primary === undefined ? {} : { primary_character: primary }),
    ...(manifest === undefined ? {} : { export_modes: manifest.export_modes }),
    ...(outputMode === undefined || outputMode === "both" ? {} : { selected_mode: outputMode }),
    card_name: cardName,
    world_book_name: `${cardName}_世界書`,
    ...(firstGreeting === undefined ? {} : { first_greeting: firstGreeting }),
    alternate_greeting_count: alternateGreetingCount,
    group_greeting_count: groupGreetingCount,
    plugin_ids: pluginIds,
    output_paths: outputPaths,
    entries,
    greeting_entries: greetingTotal,
    png_expected: pngExpected,
    missing,
    diagnostics: manifest?.diagnostics ?? [],
    ...(latestBuild?.provenance_summary === undefined ? {} : { provenance_summary: latestBuild.provenance_summary }),
  };
}

export async function tavernCompat(deps: BuildApplicationDeps): Promise<TavernCompatibilityReport> {
  const state = await deps.repository.read();
  const latest = state.publishes.at(-1);
  if (latest === undefined) {
    return { available: false, checks: [], summary: "尚未有 publish 記錄，先完成打包再檢查相容性。" };
  }
  const checks: TavernCheckResult[] = [];
  const summaryParts: string[] = [];
  let jsonText: string | undefined;
  let jsonBlobHash: string | undefined;
  if (latest.content_ref !== undefined) {
    const blob = await deps.repository.readBlob(latest.content_ref.hash);
    if (blob === undefined) {
      checks.push({ id: "json_load", label: "JSON 內容", status: "FAIL", detail: "content blob 遺失，請執行專案修復。" });
    } else {
      jsonText = new TextDecoder("utf-8").decode(blob);
      jsonBlobHash = latest.content_ref.hash;
    }
  } else {
    jsonText = latest.content;
  }
  let parsedJsonCard: CharacterCardV3 | undefined;
  if (jsonText !== undefined) {
    checks.push({ id: "json_load", label: "JSON 內容", status: "PASS", detail: `長度 ${jsonText.length} 字元${jsonBlobHash === undefined ? "" : `（blob sha256 前 12：${jsonBlobHash.slice(0, 12)}）`}。` });
    checks.push({ id: "json_hash", label: "JSON hash", status: "PASS", detail: `sha256 ${contentHash(jsonText).slice(0, 12)}。` });
    try {
      const rawJson = JSON.parse(jsonText);
      parsedJsonCard = characterCardV3Schema.parse(rawJson);
      const data = parsedJsonCard.data;
      checks.push({ id: "ccv3_schema", label: "CCv3 schema", status: "PASS", detail: `spec=${String(parsedJsonCard.spec)} spec_version=${String(parsedJsonCard.spec_version)}。` });
      const book = data.character_book;
      checks.push(book === undefined || !Array.isArray(book.entries)
        ? { id: "worldbook", label: "世界書", status: "WARN", detail: "無 character_book 條目。" }
        : { id: "worldbook", label: "世界書", status: "PASS", detail: `「${String(book.name ?? "未命名")}」共 ${book.entries.length} 條目。` });
      let greetings = 0;
      if (typeof data.first_mes === "string" && data.first_mes.length > 0) greetings += 1;
      if (Array.isArray(data.alternate_greetings)) greetings += data.alternate_greetings.filter((item) => typeof item === "string" && item.length > 0).length;
      checks.push(greetings === 0
        ? { id: "greetings", label: "開場白", status: "WARN", detail: "無首發或備選開場白。" }
        : { id: "greetings", label: "開場白", status: "PASS", detail: `首發＋備選共 ${greetings} 組。` });
      const extensions = (data.extensions ?? {}) as Record<string, unknown>;
      const workspaceExt = extensions["card-workspace"] !== null && typeof extensions["card-workspace"] === "object" && !Array.isArray(extensions["card-workspace"])
        ? extensions["card-workspace"] as Record<string, unknown>
        : undefined;
      const pluginsObj = workspaceExt?.plugins !== null && typeof workspaceExt?.plugins === "object" && !Array.isArray(workspaceExt?.plugins)
        ? workspaceExt.plugins as Record<string, unknown>
        : undefined;
      const pluginIds = pluginsObj !== undefined ? Object.keys(pluginsObj) : [];
      checks.push({ id: "plugins", label: "Plugin 依賴", status: "PASS", detail: pluginIds.length === 0 ? "無 plugin 依賴。" : `plugin 需求：${pluginIds.join(", ")}。` });
    } catch (error) {
      checks.push({ id: "ccv3_schema", label: "CCv3 schema", status: "FAIL", detail: `內容 JSON Schema 驗證失敗：${error instanceof Error ? error.message : String(error)}。` });
    }
  } else {
    checks.push({ id: "json_load", label: "JSON 內容", status: "FAIL", detail: "無內容 JSON（publish 只含 PNG 或 blob 遺失）。" });
  }
  let pngBytes: Uint8Array | undefined;
  let pngBlobHash: string | undefined;
  if (latest.png_ref !== undefined) {
    pngBytes = await deps.repository.readBlob(latest.png_ref.hash);
    pngBlobHash = latest.png_ref.hash;
  } else if (latest.png_base64 !== undefined) {
    pngBytes = Buffer.from(latest.png_base64, "base64");
  }
  if (pngBytes !== undefined) {
    checks.push({ id: "png_hash", label: "PNG hash", status: "PASS", detail: `sha256 ${contentHash(pngBytes).slice(0, 12)}${pngBlobHash === undefined ? "" : `（blob 前 12：${pngBlobHash.slice(0, 12)}）`}。` });
    const imageInfo = readPngImageInfo(pngBytes);
    if (imageInfo !== undefined) {
      const placeholder = isBuiltInPlaceholderImage(pngBytes);
      checks.push({ id: "png_dimensions", label: "PNG 尺寸", status: placeholder ? "WARN" : "PASS", detail: `${imageInfo.width}×${imageInfo.height}px（${placeholder ? "使用內建佔位圖，請上傳角色圖後重新打包" : "已嵌入角色圖像"}）。` });
    } else {
      checks.push({ id: "png_dimensions", label: "PNG 尺寸", status: "FAIL", detail: "PNG 簽名不符（可能不是有效 PNG）。" });
    }
    try {
      const decoded = readCardFromPng(pngBytes);
      checks.push({ id: "png_card_parse", label: "PNG 內嵌卡片", status: "PASS", detail: `以 ${decoded.authority} 解析成功。` });
      if (parsedJsonCard !== undefined) {
        const canonicalPng = canonicalCardJson(decoded.card);
        const canonicalJsonStr = canonicalCardJson(parsedJsonCard);
        checks.push({ id: "png_json_match", label: "JSON/PNG 一致", status: canonicalPng === canonicalJsonStr ? "PASS" : "FAIL", detail: canonicalPng === canonicalJsonStr ? "PNG 內嵌卡片與 JSON 內容一致。" : "PNG 內嵌卡片與 JSON 內容不一致（欄位順序或版本差異）。" });
      } else {
        checks.push({ id: "png_json_match", label: "JSON/PNG 一致", status: "WARN", detail: "JSON Schema 不符，無法比對 PNG 內嵌卡片。" });
      }
    } catch (error) {
      checks.push({ id: "png_card_parse", label: "PNG 內嵌卡片", status: "FAIL", detail: `PNG 卡片解析失敗：${error instanceof Error ? error.message : String(error)}。` });
    }
  } else {
    checks.push({ id: "png_dimensions", label: "PNG 尺寸", status: "FAIL", detail: "無 PNG 輸出。" });
  }
  const passCount = checks.filter((check) => check.status === "PASS").length;
  const warnCount = checks.filter((check) => check.status === "WARN").length;
  const failCount = checks.filter((check) => check.status === "FAIL").length;
  summaryParts.push(`${passCount} 項通過`);
  if (warnCount > 0) summaryParts.push(`${warnCount} 項警告`);
  if (failCount > 0) summaryParts.push(`${failCount} 項失敗`);
  return {
    available: true,
    ...(latest.export_json_path === undefined ? {} : { json_path: latest.export_json_path }),
    ...(latest.export_png_path === undefined ? {} : { png_path: latest.export_png_path }),
    ...(jsonBlobHash === undefined ? {} : { json_sha256: jsonBlobHash }),
    ...(pngBlobHash === undefined ? {} : { png_sha256: pngBlobHash }),
    checks,
    summary: `Tavern 相容性：${summaryParts.join("，")}。`,
  };
}

export async function repairPreview(deps: BuildApplicationDeps): Promise<RepairInspection> {
  return deps.repository.inspectRepair();
}

export async function repairRun(deps: BuildApplicationDeps, planHash?: string): Promise<RepairReport> {
  return deps.repository.runRepair(planHash);
}
