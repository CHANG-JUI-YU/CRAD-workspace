import { z } from "zod";
import type { CoverageSnapshot } from "./coverage.js";
import type { ImageRecord, ProjectState } from "./project-state.js";
import type { BuildPlan } from "./project-projection.js";
import { canonicalJson, contentHash } from "./core-utilities.js";
import { derivePublishedOutputPlan, publishedOutputPlanSchema, type PublishedOutputPlan } from "./output-plan.js";
import type { CardExportMode } from "./export-paths.js";

export interface ProvenanceImageCrop {
  width: number;
  height: number;
  offset_x: number;
  offset_y: number;
}

export type CoverSelectionReason = "explicit" | "primary" | "global" | "placeholder";

export interface ProvenanceImageIdentity {
  mode: "uploaded" | "placeholder";
  image_id?: string;
  character_id?: string;
  blob_hash?: string;
  media_type?: string;
  width?: number;
  height?: number;
  aspect_ratio?: string;
  crop?: ProvenanceImageCrop;
  transformation_revision?: string;
  selection_reason?: CoverSelectionReason;
}

export interface ProvenanceCoverageRef {
  character_id?: string;
  requirement_id: string;
}

export interface ProvenanceOverrideRef {
  decision_id: string;
  action: string;
  requirement_ids: string[];
  rationale?: string;
  supersedes?: string;
}

export interface ProvenanceQualityOverrideRef {
  code: string;
  severity?: string;
  reason: string;
  by: string;
}

export interface ProvenanceCompositionSummary {
  source_backed: { refs: ProvenanceCoverageRef[]; count: number };
  user_supplement: { refs: ProvenanceCoverageRef[]; count: number };
  creative_completion: { refs: ProvenanceCoverageRef[]; count: number };
  overrides: ProvenanceOverrideRef[];
  quality_overrides: ProvenanceQualityOverrideRef[];
  assessment?: { id: string; revision: string };
  requirement_set?: { id: string; revision: string };
  fact_review_run?: { id: string; projection_revision?: string };
  fact_projection_revision?: string;
  source_revisions: Array<{ source_id: string; revision: string }>;
  resolution_ids: string[];
  authoring_binding_ids: string[];
  coverage_snapshot_hash?: string;
  build_snapshot_hash: string;
  compiled_content_hash?: string;
  image_identity?: ProvenanceImageIdentity;
  output_plan?: PublishedOutputPlan;
}

const provenanceCoverageRefSchema = z.object({
  character_id: z.string().min(1).optional(),
  requirement_id: z.string().min(1),
}).strict();

const provenanceOverrideRefSchema = z.object({
  decision_id: z.string().min(1),
  action: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  rationale: z.string().min(1).optional(),
  supersedes: z.string().min(1).optional(),
}).strict();

const provenanceQualityOverrideRefSchema = z.object({
  code: z.string().min(1),
  severity: z.string().min(1).optional(),
  reason: z.string().min(1),
  by: z.string().min(1),
}).strict();

const provenanceImageCropSchema = z.object({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  offset_x: z.number().nonnegative(),
  offset_y: z.number().nonnegative(),
}).strict();

export const provenanceImageIdentitySchema = z.object({
  mode: z.enum(["uploaded", "placeholder"]),
  image_id: z.string().min(1).optional(),
  character_id: z.string().min(1).optional(),
  blob_hash: z.string().min(1).optional(),
  media_type: z.string().min(1).optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  aspect_ratio: z.string().min(1).optional(),
  crop: provenanceImageCropSchema.optional(),
  transformation_revision: z.string().min(1).optional(),
  selection_reason: z.enum(["explicit", "primary", "global", "placeholder"]).optional(),
}).strict();

export const provenanceCompositionSummarySchema = z.object({
  source_backed: z.object({ refs: z.array(provenanceCoverageRefSchema), count: z.number().int().nonnegative() }).strict(),
  user_supplement: z.object({ refs: z.array(provenanceCoverageRefSchema), count: z.number().int().nonnegative() }).strict(),
  creative_completion: z.object({ refs: z.array(provenanceCoverageRefSchema), count: z.number().int().nonnegative() }).strict(),
  overrides: z.array(provenanceOverrideRefSchema),
  quality_overrides: z.array(provenanceQualityOverrideRefSchema),
  assessment: z.object({ id: z.string().min(1), revision: z.string().min(1) }).strict().optional(),
  requirement_set: z.object({ id: z.string().min(1), revision: z.string().min(1) }).strict().optional(),
  fact_review_run: z.object({ id: z.string().min(1), projection_revision: z.string().min(1).optional() }).strict().optional(),
  fact_projection_revision: z.string().min(1).optional(),
  source_revisions: z.array(z.object({ source_id: z.string().min(1), revision: z.string().min(1) }).strict()),
  resolution_ids: z.array(z.string().min(1)),
  authoring_binding_ids: z.array(z.string().min(1)),
  coverage_snapshot_hash: z.string().min(1).optional(),
  build_snapshot_hash: z.string().min(1),
  compiled_content_hash: z.string().min(1).optional(),
  image_identity: provenanceImageIdentitySchema.optional(),
  output_plan: publishedOutputPlanSchema.optional(),
}).strict();

function refsFrom(values: readonly { character_id?: string; requirement_id: string }[]): ProvenanceCoverageRef[] {
  return values.map((value) => (value.character_id === undefined ? { requirement_id: value.requirement_id } : { character_id: value.character_id, requirement_id: value.requirement_id }));
}

function optionalRef(values: readonly { character_id?: string; requirement_id: string }[]): { refs: ProvenanceCoverageRef[]; count: number } {
  const refs = refsFrom(values);
  return { refs, count: refs.length };
}

function compareRefs(a: ProvenanceCoverageRef, b: ProvenanceCoverageRef): number {
  const ac = a.character_id ?? "";
  const bc = b.character_id ?? "";
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  if (a.requirement_id < b.requirement_id) return -1;
  if (a.requirement_id > b.requirement_id) return 1;
  return 0;
}

function sortedRefs(values: readonly { character_id?: string; requirement_id: string }[]): ProvenanceCoverageRef[] {
  return refsFrom(values).sort(compareRefs);
}

function sortedRevisions(values: readonly { source_id: string; revision: string }[]): Array<{ source_id: string; revision: string }> {
  return [...values].sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0));
}

export function deriveActiveDecisionRefs(state: ProjectState, coverageSnapshot: CoverageSnapshot | undefined): ProvenanceOverrideRef[] {
  if (coverageSnapshot === undefined) {
    return [];
  }
  const resolutionIds = new Set(coverageSnapshot.resolution_ids);
  const activeDecisionIds = new Set<string>();
  for (const resolution of state.coverage_resolutions) {
    if (resolutionIds.has(resolution.id) && resolution.user_decision_id !== undefined) {
      activeDecisionIds.add(resolution.user_decision_id);
    }
  }
  const seen = new Set<string>();
  return state.coverage_user_decisions
    .filter((decision) => {
      if (!activeDecisionIds.has(decision.id) || seen.has(decision.id)) {
        return false;
      }
      seen.add(decision.id);
      return true;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((decision) => ({
      decision_id: decision.id,
      action: decision.action,
      requirement_ids: [...decision.requirement_ids].sort(),
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
      ...(decision.supersedes === undefined ? {} : { supersedes: decision.supersedes }),
    }));
}

export function deriveHistoricalDecisionRefs(state: ProjectState, coverageSnapshot: CoverageSnapshot | undefined): ProvenanceOverrideRef[] {
  const activeIds = new Set(deriveActiveDecisionRefs(state, coverageSnapshot).map((ref) => ref.decision_id));
  return state.coverage_user_decisions
    .filter((decision) => !activeIds.has(decision.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((decision) => ({
      decision_id: decision.id,
      action: decision.action,
      requirement_ids: [...decision.requirement_ids].sort(),
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
      ...(decision.supersedes === undefined ? {} : { supersedes: decision.supersedes }),
    }));
}

export const BUILD_SNAPSHOT_PAYLOAD_VERSION = "build-snapshot-v3";

export function imageTransformationRevision(crop: ProvenanceImageCrop | undefined, aspectRatio: string | undefined): string | undefined {
  if (crop === undefined && aspectRatio === undefined) {
    return undefined;
  }
  return contentHash(canonicalJson({ crop: crop ?? null, aspect_ratio: aspectRatio ?? null }));
}

function coverIdentityFor(selected: ImageRecord, reason: CoverSelectionReason): { identity: ProvenanceImageIdentity; selected: ImageRecord } {
  const crop: ProvenanceImageCrop | undefined = selected.crop === undefined ? undefined : { width: selected.crop.width, height: selected.crop.height, offset_x: selected.crop.offset_x, offset_y: selected.crop.offset_y };
  const transformationRevision = imageTransformationRevision(crop, selected.aspect_ratio);
  const identity: ProvenanceImageIdentity = {
    mode: "uploaded",
    image_id: selected.id,
    ...(selected.character_id === undefined ? {} : { character_id: selected.character_id }),
    blob_hash: selected.blob_hash,
    ...(selected.media_type === undefined ? {} : { media_type: selected.media_type }),
    ...(selected.width === undefined ? {} : { width: selected.width }),
    ...(selected.height === undefined ? {} : { height: selected.height }),
    ...(selected.aspect_ratio === undefined ? {} : { aspect_ratio: selected.aspect_ratio }),
    ...(crop === undefined ? {} : { crop }),
    ...(transformationRevision === undefined ? {} : { transformation_revision: transformationRevision }),
    selection_reason: reason,
  };
  return { identity, selected };
}

export function resolveCoverImageIdentity(state: ProjectState, primaryCharacterId: string | undefined): { identity: ProvenanceImageIdentity; selected: ImageRecord | undefined } {
  let activeSelection: { image_id?: string; placeholder: boolean } | undefined;
  for (let index = state.cover_selections.length - 1; index >= 0; index -= 1) {
    const candidate = state.cover_selections[index];
    if (candidate !== undefined) {
      activeSelection = candidate;
      break;
    }
  }
  if (activeSelection !== undefined) {
    if (activeSelection.placeholder) {
      return { identity: { mode: "placeholder", selection_reason: "explicit" }, selected: undefined };
    }
    if (activeSelection.image_id !== undefined) {
      const explicit = state.images.find((image) => image.id === activeSelection.image_id);
      if (explicit !== undefined) {
        return coverIdentityFor(explicit, "explicit");
      }
    }
  }
  if (state.images.length === 0) {
    return { identity: { mode: "placeholder", selection_reason: activeSelection === undefined ? "placeholder" : "placeholder" }, selected: undefined };
  }
  let selected: ImageRecord | undefined;
  if (primaryCharacterId !== undefined) {
    for (let index = state.images.length - 1; index >= 0; index -= 1) {
      const candidate = state.images[index];
      if (candidate !== undefined && candidate.character_id === primaryCharacterId) {
        selected = candidate;
        break;
      }
    }
  }
  if (selected !== undefined) {
    return coverIdentityFor(selected, "primary");
  }
  for (let index = state.images.length - 1; index >= 0; index -= 1) {
    const candidate = state.images[index];
    if (candidate !== undefined && candidate.character_id === undefined) {
      selected = candidate;
      break;
    }
  }
  if (selected !== undefined) {
    return coverIdentityFor(selected, "global");
  }
  return { identity: { mode: "placeholder", selection_reason: "placeholder" }, selected: undefined };
}

export type CoverImageFreshnessStatus = "fresh" | "stale" | "unknown";

export interface CoverImageFreshnessResult {
  status: CoverImageFreshnessStatus;
  reason?: string;
}

export function deriveCoverImageFreshness(state: ProjectState, recordedIdentity: ProvenanceImageIdentity | undefined, primaryCharacterId?: string): CoverImageFreshnessResult {
  if (recordedIdentity === undefined) {
    return { status: "unknown", reason: "此發布為舊版記錄，未保存封面 identity，無法判定封面是否已變更。" };
  }
  const current = resolveCoverImageIdentity(state, primaryCharacterId).identity;
  if (canonicalJson(current) === canonicalJson(recordedIdentity)) {
    return { status: "fresh" };
  }
  if (current.mode !== recordedIdentity.mode) {
    return {
      status: "stale",
      reason: current.mode === "placeholder"
        ? "目前依正式規則解析為內建佔位圖，與已發布封面不同。"
        : "目前依正式規則解析為正式圖片，與已發布的佔位封面不同。",
    };
  }
  if (current.image_id !== recordedIdentity.image_id) {
    return { status: "stale", reason: "目前依正式規則選取的封面圖片與已發布封面不同。" };
  }
  if (current.blob_hash !== recordedIdentity.blob_hash) {
    return { status: "stale", reason: "封面圖片內容（blob）已變更。" };
  }
  return { status: "stale", reason: "封面圖片屬性（裁切、比例或變換）已變更。" };
}

export function computeBuildSnapshotHash(
  state: ProjectState,
  plan: BuildPlan,
  modeSelection: string | null | undefined,
  coverageSnapshot: CoverageSnapshot | undefined,
  imageIdentity?: ProvenanceImageIdentity,
  outputPlan?: PublishedOutputPlan,
): string {
  const artifactHashes = new Map<string, string | null>();
  for (const artifact of state.artifacts) {
    artifactHashes.set(artifact.id, artifact.content_hash ?? null);
  }
  const artifacts = plan.entries
    .map((entry) => ({
      key: entry.key,
      artifact_id: entry.artifact_id,
      kind: entry.kind,
      revision: entry.revision,
      content_hash: artifactHashes.get(entry.artifact_id) ?? null,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const overrideEntries = Object.entries(state.quality_profile.overrides ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const overrideAudit = (state.quality_profile.override_audit ?? [])
    .map((item) => ({ code: item.code, configured_severity: item.configured_severity, against_effective_severity: item.against_effective_severity, actor: item.actor }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const payload = {
    version: BUILD_SNAPSHOT_PAYLOAD_VERSION,
    mode_selection: modeSelection ?? null,
    artifacts,
    coverage: coverageSnapshot === undefined ? null : {
      assessment_id: coverageSnapshot.assessment_id,
      assessment_revision: coverageSnapshot.assessment_revision,
      requirement_set_id: coverageSnapshot.requirement_set_id,
      requirement_set_revision: coverageSnapshot.requirement_set_revision,
      snapshot_hash: coverageSnapshot.snapshot_hash,
      fact_review_run_id: coverageSnapshot.fact_review_run_id ?? null,
      fact_review_projection_revision: coverageSnapshot.fact_review_projection_revision ?? null,
      fact_projection_revision: coverageSnapshot.fact_projection_revision ?? null,
      source_revisions: sortedRevisions(coverageSnapshot.source_revisions),
      resolution_ids: [...coverageSnapshot.resolution_ids].sort(),
      authoring_binding_ids: [...coverageSnapshot.authoring_binding_ids].sort(),
      source_covered_requirements: sortedRefs(coverageSnapshot.source_covered_requirements),
      user_supplement_requirements: sortedRefs(coverageSnapshot.user_supplement_requirements),
      creative_completion_requirements: sortedRefs(coverageSnapshot.creative_completion_requirements),
    },
    quality_policy: {
      level: state.quality_profile.level ?? null,
      blocking_severity: state.quality_profile.blocking_severity ?? null,
      overrides: overrideEntries,
      override_audit: overrideAudit,
    },
    image: imageIdentity ?? null,
    output_plan: outputPlan ?? null,
  };
  return contentHash(canonicalJson(payload));
}

export const PROVENANCE_CONFIRMATION_VERSION = "provenance-confirmation-v3";

export function provenanceConfirmationFingerprint(composition: ProvenanceCompositionSummary): string {
  const payload = {
    version: PROVENANCE_CONFIRMATION_VERSION,
    build_snapshot_hash: composition.build_snapshot_hash,
    source_backed: sortedRefs(composition.source_backed.refs),
    user_supplement: sortedRefs(composition.user_supplement.refs),
    creative_completion: sortedRefs(composition.creative_completion.refs),
    overrides: composition.overrides
      .map((ref) => ({
        decision_id: ref.decision_id,
        action: ref.action,
        requirement_ids: [...ref.requirement_ids].sort(),
        supersedes: ref.supersedes ?? null,
      }))
      .sort((a, b) => (a.decision_id < b.decision_id ? -1 : a.decision_id > b.decision_id ? 1 : 0)),
    resolution_ids: [...composition.resolution_ids].sort(),
    authoring_binding_ids: [...composition.authoring_binding_ids].sort(),
    assessment_id: composition.assessment?.id ?? null,
    assessment_revision: composition.assessment?.revision ?? null,
    requirement_set_id: composition.requirement_set?.id ?? null,
    requirement_set_revision: composition.requirement_set?.revision ?? null,
    fact_review_run_id: composition.fact_review_run?.id ?? null,
    fact_projection_revision: composition.fact_projection_revision ?? null,
    coverage_snapshot_hash: composition.coverage_snapshot_hash ?? null,
    image: composition.image_identity ?? null,
    output_plan: composition.output_plan ?? null,
  };
  return contentHash(canonicalJson(payload));
}

export function buildProvenanceCompositionSummary(state: ProjectState, coverageSnapshot: CoverageSnapshot | undefined, buildSnapshotHash: string, compiledContentHash?: string, imageIdentity?: ProvenanceImageIdentity, outputPlan?: PublishedOutputPlan): ProvenanceCompositionSummary {
  const qualityAudit = state.quality_profile.override_audit ?? [];
  const qualityOverrides: ProvenanceQualityOverrideRef[] = qualityAudit.length > 0
    ? qualityAudit
        .map((item) => ({ code: item.code, severity: item.configured_severity, reason: `quality override configured ${item.configured_severity} against effective ${item.against_effective_severity}`, by: item.actor }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    : Object.entries(state.quality_profile.overrides).map(([code, severity]) => ({ code, severity, reason: "quality override", by: "system" })).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    source_backed: optionalRef(coverageSnapshot?.source_covered_requirements ?? []),
    user_supplement: optionalRef(coverageSnapshot?.user_supplement_requirements ?? []),
    creative_completion: optionalRef(coverageSnapshot?.creative_completion_requirements ?? []),
    overrides: deriveActiveDecisionRefs(state, coverageSnapshot),
    quality_overrides: qualityOverrides,
    ...(coverageSnapshot === undefined ? {} : {
      assessment: { id: coverageSnapshot.assessment_id, revision: coverageSnapshot.assessment_revision },
      requirement_set: { id: coverageSnapshot.requirement_set_id, revision: coverageSnapshot.requirement_set_revision },
    }),
    ...(coverageSnapshot?.fact_review_run_id === undefined ? {} : {
      fact_review_run: {
        id: coverageSnapshot.fact_review_run_id,
        ...(coverageSnapshot.fact_review_projection_revision === undefined ? {} : { projection_revision: coverageSnapshot.fact_review_projection_revision }),
      },
    }),
    ...(coverageSnapshot?.fact_projection_revision === undefined ? {} : { fact_projection_revision: coverageSnapshot.fact_projection_revision }),
    source_revisions: sortedRevisions(coverageSnapshot?.source_revisions ?? []),
    resolution_ids: [...(coverageSnapshot?.resolution_ids ?? [])].sort(),
    authoring_binding_ids: [...(coverageSnapshot?.authoring_binding_ids ?? [])].sort(),
    ...(coverageSnapshot === undefined ? {} : { coverage_snapshot_hash: coverageSnapshot.snapshot_hash }),
    build_snapshot_hash: buildSnapshotHash,
    ...(compiledContentHash === undefined ? {} : { compiled_content_hash: compiledContentHash }),
    ...(imageIdentity === undefined ? {} : { image_identity: imageIdentity }),
    ...(outputPlan === undefined ? {} : { output_plan: outputPlan }),
  };
}

export interface CanonicalProvenancePublishPayload {
  fingerprint: string;
  mode_selection?: string;
}

export function canonicalProvenancePublishMatches(
  command: unknown,
  expected: CanonicalProvenancePublishPayload,
): boolean {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    return false;
  }
  const cmd = command as { type?: unknown; payload?: unknown };
  if (cmd.type !== "provenance_publish") {
    return false;
  }
  if (cmd.payload === null || typeof cmd.payload !== "object" || Array.isArray(cmd.payload)) {
    return false;
  }
  const payload = cmd.payload as { fingerprint?: unknown; mode_selection?: unknown };
  if (typeof payload.fingerprint !== "string" || payload.fingerprint !== expected.fingerprint) {
    return false;
  }
  const expectedMode = expected.mode_selection ?? undefined;
  const actualMode = typeof payload.mode_selection === "string" ? payload.mode_selection : undefined;
  return expectedMode === actualMode;
}

export type InputGroupStatus = "included" | "not_applicable" | "legacy_unavailable";

export interface PreparedArtifactEntry {
  key: string;
  artifact_id: string;
  kind: string;
  revision: string;
  content_hash?: string;
}

export interface PreparedOutputSummary {
  mode: string;
  json_path?: string;
  png_path?: string;
  is_dual_mode: boolean;
  character_count: number;
  artifact_count: number;
  files: string[];
}

export interface PreparedGroupInfo<T = unknown> {
  status: InputGroupStatus;
  data?: T;
  summary: string;
}

export interface PreparedPublishSnapshot {
  version: "prepared-snapshot-v2";
  project_id: string;
  mode_selection?: string | undefined;
  image_identity?: ProvenanceImageIdentity | undefined;
  artifacts: PreparedArtifactEntry[];
  artifact_count: number;
  coverage?: {
    assessment_id?: string | undefined;
    assessment_revision?: string | undefined;
    requirement_set_id?: string | undefined;
    requirement_set_revision?: string | undefined;
    fact_review_run_id?: string | undefined;
    fact_review_projection_revision?: string | undefined;
    fact_projection_revision?: string | undefined;
    source_revisions: Array<{ source_id: string; revision: string }>;
    resolution_ids: string[];
    authoring_binding_ids: string[];
    source_backed_count: number;
    user_supplement_count: number;
    creative_completion_count: number;
  } | undefined;
  quality_policy: {
    level?: string | undefined;
    blocking_severity?: string | undefined;
    overrides: Array<{ code: string; severity: string }>;
    override_audit: Array<{ code: string; configured_severity: string; against_effective_severity?: string | undefined; actor: string }>;
  };
  composition: ProvenanceCompositionSummary;
  predicted_outputs: PreparedOutputSummary;
  historical_decisions: ProvenanceOverrideRef[];
  build_snapshot_hash: string;
  fingerprint: string;
  human_acknowledgement: string;
  groups: {
    mode: PreparedGroupInfo<{ mode: string }>;
    image: PreparedGroupInfo<ProvenanceImageIdentity | undefined>;
    artifacts: PreparedGroupInfo<{ count: number; revisions: Record<string, string> }>;
    coverage: PreparedGroupInfo<{ assessment_revision?: string | undefined; source_revisions: Array<{ source_id: string; revision: string }> } | undefined>;
    quality_policy: PreparedGroupInfo<{ level?: string | undefined; overrides: Record<string, string> }>;
    outputs: PreparedGroupInfo<PreparedOutputSummary>;
  };
}

export type StaleDiffCategory =
  | "mode"
  | "image"
  | "artifact_revisions"
  | "coverage"
  | "facts_sources"
  | "quality_policy"
  | "output_selection";

export interface ChangedInputItem {
  category: StaleDiffCategory;
  label: string;
  before_summary: string;
  after_summary: string;
  target_panel: string;
  anchor: string;
}

export interface ProvenanceStaleReport {
  is_stale: boolean;
  changed_inputs: ChangedInputItem[];
  reason?: string | undefined;
}

export function buildPreparedPublishSnapshot(
  state: ProjectState,
  plan: BuildPlan,
  modeSelection: string | null | undefined,
  coverageSnapshot: CoverageSnapshot | undefined,
  composition: ProvenanceCompositionSummary,
  fingerprint: string,
  imageIdentity?: ProvenanceImageIdentity,
): PreparedPublishSnapshot {
  const artifactHashes = new Map<string, string | null>();
  for (const artifact of state.artifacts) {
    artifactHashes.set(artifact.id, artifact.content_hash ?? null);
  }

  const artifacts: PreparedArtifactEntry[] = plan.entries
    .map((entry) => ({
      key: entry.key,
      artifact_id: entry.artifact_id,
      kind: entry.kind,
      revision: entry.revision,
      ...(artifactHashes.get(entry.artifact_id) ? { content_hash: artifactHashes.get(entry.artifact_id)! } : {}),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const artifactRevisions: Record<string, string> = {};
  for (const a of artifacts) {
    artifactRevisions[a.key] = a.revision;
  }

  const effectiveMode = modeSelection ?? "default";
  const isDualMode = effectiveMode === "both";
  const characterCount = plan.entries.filter((e) => e.kind === "character").length;
  const outputPlan = derivePublishedOutputPlan(state, modeSelection === null || modeSelection === undefined ? undefined : modeSelection as CardExportMode);
  const jsonPath = outputPlan.json_path;
  const pngPath = outputPlan.png_path;
  const files = [jsonPath, pngPath];

  const predictedOutputs: PreparedOutputSummary = {
    mode: effectiveMode,
    json_path: jsonPath,
    png_path: pngPath,
    is_dual_mode: isDualMode,
    character_count: characterCount,
    artifact_count: artifacts.length,
    files,
  };

  const overrideEntries = Object.entries(state.quality_profile.overrides ?? {})
    .map(([code, severity]) => ({ code, severity }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const overrideAudit = (state.quality_profile.override_audit ?? [])
    .map((item) => ({
      code: item.code,
      configured_severity: item.configured_severity,
      against_effective_severity: item.against_effective_severity,
      actor: item.actor,
    }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const qualityOverridesRecord: Record<string, string> = {};
  for (const item of overrideEntries) {
    qualityOverridesRecord[item.code] = item.severity;
  }

  const hasCoverage = coverageSnapshot !== undefined;
  const hasImage = imageIdentity !== undefined && imageIdentity.mode === "uploaded";

  const groups = {
    mode: {
      status: "included" as InputGroupStatus,
      data: { mode: effectiveMode },
      summary: `發布模式：${effectiveMode}${isDualMode ? "（雙模式整合輸出）" : ""}`,
    },
    image: {
      status: (hasImage ? "included" : "not_applicable") as InputGroupStatus,
      data: imageIdentity,
      summary: hasImage ? `已配置封面圖片（Blob ${imageIdentity?.blob_hash?.slice(0, 12) ?? "無"}）` : "未配置封面圖片（使用預設佔位）",
    },
    artifacts: {
      status: "included" as InputGroupStatus,
      data: { count: artifacts.length, revisions: artifactRevisions },
      summary: `共 ${artifacts.length} 個發布組件 Artifacts`,
    },
    coverage: {
      status: (hasCoverage ? "included" : "not_applicable") as InputGroupStatus,
      data: hasCoverage
        ? {
            assessment_revision: coverageSnapshot?.assessment_revision,
            source_revisions: sortedRevisions(coverageSnapshot?.source_revisions ?? []),
          }
        : undefined,
      summary: hasCoverage
        ? `Coverage 評估 ${coverageSnapshot?.assessment_id ?? ""}, ${composition.source_backed.count} 來源佐證, ${composition.user_supplement.count} 使用者補充, ${composition.creative_completion.count} 創作補全`
        : "非來源改編專案（不適用 Coverage 評估）",
    },
    quality_policy: {
      status: "included" as InputGroupStatus,
      data: { level: state.quality_profile.level, overrides: qualityOverridesRecord },
      summary: `品質門檻：${state.quality_profile.level ?? "預設"}，${overrideEntries.length} 項覆寫`,
    },
    outputs: {
      status: "included" as InputGroupStatus,
      data: predictedOutputs,
      summary: `預期輸出：${files.join("、")}`,
    },
  };

  const humanAcknowledgement =
    "我確認並批准目前畫面所顯示的模式、圖片、Artifacts、Coverage、Facts、來源、品質政策與輸出組成；本次發布只適用於這份不可變快照。";

  return {
    version: "prepared-snapshot-v2",
    project_id: state.project_id || "",
    mode_selection: modeSelection ?? undefined,
    image_identity: imageIdentity,
    artifacts,
    artifact_count: artifacts.length,
    coverage: hasCoverage
      ? {
          assessment_id: coverageSnapshot?.assessment_id,
          assessment_revision: coverageSnapshot?.assessment_revision,
          requirement_set_id: coverageSnapshot?.requirement_set_id,
          requirement_set_revision: coverageSnapshot?.requirement_set_revision,
          fact_review_run_id: coverageSnapshot?.fact_review_run_id,
          fact_review_projection_revision: coverageSnapshot?.fact_review_projection_revision,
          fact_projection_revision: coverageSnapshot?.fact_projection_revision,
          source_revisions: sortedRevisions(coverageSnapshot?.source_revisions ?? []),
          resolution_ids: [...(coverageSnapshot?.resolution_ids ?? [])].sort(),
          authoring_binding_ids: [...(coverageSnapshot?.authoring_binding_ids ?? [])].sort(),
          source_backed_count: composition.source_backed.count,
          user_supplement_count: composition.user_supplement.count,
          creative_completion_count: composition.creative_completion.count,
        }
      : undefined,
    quality_policy: {
      level: state.quality_profile.level,
      blocking_severity: state.quality_profile.blocking_severity,
      overrides: overrideEntries,
      override_audit: overrideAudit,
    },
    composition,
    predicted_outputs: predictedOutputs,
    historical_decisions: deriveHistoricalDecisionRefs(state, coverageSnapshot),
    build_snapshot_hash: composition.build_snapshot_hash,
    fingerprint,
    human_acknowledgement: humanAcknowledgement,
    groups,
  };
}

export function comparePreparedSnapshotDiff(
  prepared: PreparedPublishSnapshot,
  current: PreparedPublishSnapshot,
): ProvenanceStaleReport {
  const changedInputs: ChangedInputItem[] = [];

  // 1. Mode comparison
  if (prepared.mode_selection !== current.mode_selection) {
    changedInputs.push({
      category: "mode",
      label: "發布模式",
      before_summary: `原模式：${prepared.mode_selection ?? "預設"}`,
      after_summary: `現模式：${current.mode_selection ?? "預設"}`,
      target_panel: "publish",
      anchor: "readiness-mode",
    });
  }

  // 2. Image comparison
  const prepImg = prepared.image_identity;
  const currImg = current.image_identity;
  if (
    prepImg?.mode !== currImg?.mode ||
    prepImg?.image_id !== currImg?.image_id ||
    prepImg?.blob_hash !== currImg?.blob_hash ||
    prepImg?.transformation_revision !== currImg?.transformation_revision
  ) {
    changedInputs.push({
      category: "image",
      label: "封面圖片",
      before_summary: prepImg?.mode === "uploaded" ? `圖片 ID ${prepImg.image_id ?? "未知"}（Blob ${prepImg.blob_hash?.slice(0, 8) ?? ""}）` : "預設佔位",
      after_summary: currImg?.mode === "uploaded" ? `圖片 ID ${currImg.image_id ?? "未知"}（Blob ${currImg.blob_hash?.slice(0, 8) ?? ""}）` : "預設佔位",
      target_panel: "publish",
      anchor: "provenance-summary",
    });
  }

  // 3. Artifact revisions comparison
  const prepArtifacts = new Map(prepared.artifacts.map((a) => [a.key, a]));
  const currArtifacts = new Map(current.artifacts.map((a) => [a.key, a]));
  const artifactDiffs: string[] = [];

  for (const [key, pArt] of prepArtifacts.entries()) {
    const cArt = currArtifacts.get(key);
    if (!cArt) {
      artifactDiffs.push(`已移除組件 ${key}`);
    } else if (pArt.revision !== cArt.revision || pArt.content_hash !== cArt.content_hash) {
      artifactDiffs.push(`組件 ${key}（${pArt.revision.slice(0, 8)} → ${cArt.revision.slice(0, 8)}）`);
    }
  }
  for (const key of currArtifacts.keys()) {
    if (!prepArtifacts.has(key)) {
      artifactDiffs.push(`新增組件 ${key}`);
    }
  }

  if (artifactDiffs.length > 0) {
    changedInputs.push({
      category: "artifact_revisions",
      label: "Artifact 組件版本",
      before_summary: `${prepared.artifacts.length} 個組件`,
      after_summary: `${artifactDiffs.join("；")}`,
      target_panel: "artifacts",
      anchor: "artifact-list",
    });
  }

  // 4. Coverage snapshot comparison
  const prepCov = prepared.coverage;
  const currCov = current.coverage;
  if (
    prepCov?.assessment_id !== currCov?.assessment_id ||
    prepCov?.assessment_revision !== currCov?.assessment_revision ||
    prepCov?.requirement_set_revision !== currCov?.requirement_set_revision ||
    prepCov?.source_backed_count !== currCov?.source_backed_count ||
    prepCov?.user_supplement_count !== currCov?.user_supplement_count ||
    prepCov?.creative_completion_count !== currCov?.creative_completion_count ||
    JSON.stringify(prepCov?.resolution_ids) !== JSON.stringify(currCov?.resolution_ids) ||
    JSON.stringify(prepCov?.authoring_binding_ids) !== JSON.stringify(currCov?.authoring_binding_ids)
  ) {
    changedInputs.push({
      category: "coverage",
      label: "Coverage 評估快照",
      before_summary: prepCov ? `評估版本 ${prepCov.assessment_revision?.slice(0, 8) ?? "無"}，佐證 ${prepCov.source_backed_count}` : "無",
      after_summary: currCov ? `評估版本 ${currCov.assessment_revision?.slice(0, 8) ?? "無"}，佐證 ${currCov.source_backed_count}` : "無",
      target_panel: "coverage",
      anchor: "coverage-assessment-panel",
    });
  }

  // 5. Facts / Sources comparison
  const prepSources = JSON.stringify(prepCov?.source_revisions ?? []);
  const currSources = JSON.stringify(currCov?.source_revisions ?? []);
  if (
    prepCov?.fact_review_run_id !== currCov?.fact_review_run_id ||
    prepCov?.fact_projection_revision !== currCov?.fact_projection_revision ||
    prepSources !== currSources
  ) {
    changedInputs.push({
      category: "facts_sources",
      label: "來源與事實審查",
      before_summary: `審查 Run ${prepCov?.fact_review_run_id ?? "無"}，投影 ${prepCov?.fact_projection_revision?.slice(0, 8) ?? "無"}`,
      after_summary: `審查 Run ${currCov?.fact_review_run_id ?? "無"}，投影 ${currCov?.fact_projection_revision?.slice(0, 8) ?? "無"}`,
      target_panel: "sources",
      anchor: "source-fact-heading",
    });
  }

  // 6. Quality policy comparison
  const prepQuality = JSON.stringify(prepared.quality_policy);
  const currQuality = JSON.stringify(current.quality_policy);
  if (prepQuality !== currQuality) {
    changedInputs.push({
      category: "quality_policy",
      label: "品質門檻與覆寫",
      before_summary: `門檻 ${prepared.quality_policy.level ?? "預設"}，${prepared.quality_policy.overrides.length} 項覆寫`,
      after_summary: `門檻 ${current.quality_policy.level ?? "預設"}，${current.quality_policy.overrides.length} 項覆寫`,
      target_panel: "quality",
      anchor: "quality-heading",
    });
  }

  // 7. Output selection comparison
  if (JSON.stringify(prepared.predicted_outputs) !== JSON.stringify(current.predicted_outputs)) {
    changedInputs.push({
      category: "output_selection",
      label: "預期輸出檔案",
      before_summary: prepared.predicted_outputs.files.join(", "),
      after_summary: current.predicted_outputs.files.join(", "),
      target_panel: "publish",
      anchor: "provenance-summary",
    });
  }

  const isStale = changedInputs.length > 0 || prepared.fingerprint !== current.fingerprint;
  return {
    is_stale: isStale,
    changed_inputs: changedInputs,
    reason: isStale ? `Provenance 組成已變更（共 ${changedInputs.length} 項差異），請重新準備發布確認。` : undefined,
  };
}
