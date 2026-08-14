import { z } from "zod";
import type { CoverageSnapshot } from "./coverage.js";
import type { ImageRecord, ProjectState } from "./project-state.js";
import type { BuildPlan } from "./project-projection.js";
import { canonicalJson, contentHash } from "./core-utilities.js";

export interface ProvenanceImageCrop {
  width: number;
  height: number;
  offset_x: number;
  offset_y: number;
}

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

export const BUILD_SNAPSHOT_PAYLOAD_VERSION = "build-snapshot-v2";

export function imageTransformationRevision(crop: ProvenanceImageCrop | undefined, aspectRatio: string | undefined): string | undefined {
  if (crop === undefined && aspectRatio === undefined) {
    return undefined;
  }
  return contentHash(canonicalJson({ crop: crop ?? null, aspect_ratio: aspectRatio ?? null }));
}

export function resolveCoverImageIdentity(state: ProjectState, primaryCharacterId: string | undefined): { identity: ProvenanceImageIdentity; selected: ImageRecord | undefined } {
  if (state.images.length === 0) {
    return { identity: { mode: "placeholder" }, selected: undefined };
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
  if (selected === undefined) {
    for (let index = state.images.length - 1; index >= 0; index -= 1) {
      const candidate = state.images[index];
      if (candidate !== undefined && candidate.character_id === undefined) {
        selected = candidate;
        break;
      }
    }
  }
  if (selected === undefined) {
    return { identity: { mode: "placeholder" }, selected: undefined };
  }
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
  };
  return { identity, selected };
}

export function computeBuildSnapshotHash(
  state: ProjectState,
  plan: BuildPlan,
  modeSelection: string | null | undefined,
  coverageSnapshot: CoverageSnapshot | undefined,
  imageIdentity?: ProvenanceImageIdentity,
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
  };
  return contentHash(canonicalJson(payload));
}

export const PROVENANCE_CONFIRMATION_VERSION = "provenance-confirmation-v2";

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
  };
  return contentHash(canonicalJson(payload));
}

export function buildProvenanceCompositionSummary(state: ProjectState, coverageSnapshot: CoverageSnapshot | undefined, buildSnapshotHash: string, compiledContentHash?: string, imageIdentity?: ProvenanceImageIdentity): ProvenanceCompositionSummary {
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
  };
}
