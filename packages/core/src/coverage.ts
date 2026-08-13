import { z } from "zod";
import { canonicalJson, contentHash } from "./core-utilities.js";

export const COVERAGE_DIMENSIONS = [
  "identity",
  "appearance",
  "personality",
  "values",
  "motivation_goals",
  "background",
  "speech",
  "dialogue_example",
  "behavior",
  "emotion",
  "relationships",
  "preferences",
  "knowledge_abilities",
] as const;

export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number];

export const WORLD_COVERAGE_DIMENSION = "world_context" as const;

export const COVERAGE_ALL_DIMENSIONS = [...COVERAGE_DIMENSIONS, WORLD_COVERAGE_DIMENSION] as const;

export interface CoverageSatisfactionRule {
  min_accepted_facts: number;
  evidence_match: "any" | "all";
}

export interface CoverageRequirementDefinition {
  id: string;
  path: string;
  dimension: CoverageDimension | typeof WORLD_COVERAGE_DIMENSION;
  label: string;
  description: string;
  query_terms: string[];
  evidence_kinds: string[];
  satisfaction: CoverageSatisfactionRule;
  definition_revision: string;
}

export const COVERAGE_REQUIREMENT_DEFINITION_REVISION = contentHash("coverage-requirement-catalog-v1");

const requirementDefinitions: CoverageRequirementDefinition[] = [
  {
    id: "req.identity",
    path: "identity",
    dimension: "identity",
    label: "身分與背景定位",
    description: "角色的身分、姓名、別名、年齡、職業、種族等基本定位。",
    query_terms: ["identity", "name", "aliases", "age", "occupation", "身分", "姓名", "職業"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.appearance",
    path: "appearance",
    dimension: "appearance",
    label: "外貌",
    description: "外貌、身材、髮型、服裝與外觀特徵。",
    query_terms: ["appearance", "hair", "clothing", "looks", "外貌", "髮型", "服裝"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.personality",
    path: "personality",
    dimension: "personality",
    label: "人格特質",
    description: "人格特質、性格傾向與社交風格。",
    query_terms: ["personality", "traits", "temperament", "人格", "性格", "特質"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.values",
    path: "values",
    dimension: "values",
    label: "價值觀與信念",
    description: "價值觀、信念、原則與禁忌。",
    query_terms: ["values", "beliefs", "principles", "morals", "價值觀", "信念", "原則"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.motivation_goals",
    path: "motivation_goals",
    dimension: "motivation_goals",
    label: "動機與目標",
    description: "動機、欲望、目標、恐懼與內在衝突。",
    query_terms: ["motivation", "goals", "desire", "fear", "動機", "目標", "渴望"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.background",
    path: "background",
    dimension: "background",
    label: "背景與經歷",
    description: "出身、經歷、重要事件與成長背景。",
    query_terms: ["background", "origin", "history", "背景", "出身", "經歷"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.speech",
    path: "speech",
    dimension: "speech",
    label: "語言與語氣",
    description: "語言、聲線、語氣、用詞、句型與口頭禪。",
    query_terms: ["speech", "register", "catchphrases", "tone", "語氣", "口頭禪", "用詞"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.dialogue_example",
    path: "dialogue_example",
    dimension: "dialogue_example",
    label: "台詞範例",
    description: "原作台詞與情境化台詞範例。",
    query_terms: ["dialogue", "quotes", "speech examples", "台詞", "對白", "經典語錄"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.behavior",
    path: "behavior",
    dimension: "behavior",
    label: "行為模式",
    description: "行為模式、習慣、日常反應與做事方式。",
    query_terms: ["behavior", "habits", "routines", "行為", "習慣", "日常反應"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.emotion",
    path: "emotion",
    dimension: "emotion",
    label: "情緒",
    description: "情緒觸發、情緒表達、壓力反應與情緒調節。",
    query_terms: ["emotion", "feelings", "stress response", "情緒", "喜怒哀樂"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.relationships",
    path: "relationships",
    dimension: "relationships",
    label: "人際關係",
    description: "親友、敵我、所屬組織與互動模式。",
    query_terms: ["relationships", "friends", "enemies", "affiliation", "人際", "關係", "朋友"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.preferences",
    path: "preferences",
    dimension: "preferences",
    label: "喜好與偏好",
    description: "喜好、厭惡、興趣與偏好的事物。",
    query_terms: ["preferences", "likes", "dislikes", "interests", "喜好", "興趣", "厭惡"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.knowledge_abilities",
    path: "knowledge_abilities",
    dimension: "knowledge_abilities",
    label: "知識與能力",
    description: "知識範圍、技能、能力與限制。",
    query_terms: ["skills", "abilities", "knowledge", "limitations", "技能", "能力", "知識"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
  {
    id: "req.world_context",
    path: "world_context",
    dimension: "world_context",
    label: "世界觀背景",
    description: "世界規則、時代、地點、陣營與社會背景。",
    query_terms: ["world", "setting", "rules", "location", "世界觀", "設定", "時代"],
    evidence_kinds: [],
    satisfaction: { min_accepted_facts: 1, evidence_match: "any" },
    definition_revision: COVERAGE_REQUIREMENT_DEFINITION_REVISION,
  },
];

export const COVERAGE_REQUIREMENT_CATALOG: readonly CoverageRequirementDefinition[] = requirementDefinitions;

const catalogById = new Map(requirementDefinitions.map((definition) => [definition.id, definition]));

export function coverageRequirementById(id: string): CoverageRequirementDefinition | undefined {
  return catalogById.get(id);
}

export function isCoverageRequirementId(id: string): boolean {
  return catalogById.has(id);
}

export function coverageRequirementIdForDimension(dimension: string): string | undefined {
  return catalogById.has(`req.${dimension}`) ? `req.${dimension}` : undefined;
}

export const coverageRequirementIdSchema = z.string().refine((value) => isCoverageRequirementId(value), "Unknown coverage requirement id");

export type CoverageRequirementSource = "default" | "blueprint" | "director";

export interface CoverageRequirementCharacter {
  character_id: string;
  requirement_ids: string[];
}

export interface CoverageRequirementSet {
  id: string;
  revision: string;
  source: CoverageRequirementSource;
  blueprint_artifact_id?: string;
  blueprint_revision?: string;
  characters: CoverageRequirementCharacter[];
  world_requirement_ids: string[];
  based_on_revision?: string;
  decision_id?: string;
  created_by: string;
  created_at: string;
}

export const coverageRequirementCharacterSchema = z.object({
  character_id: z.string().min(1),
  requirement_ids: z.array(coverageRequirementIdSchema).min(1),
}).strict();

export const coverageRequirementSetSchema = z.object({
  id: z.string().min(1),
  revision: z.string().min(1),
  source: z.enum(["default", "blueprint", "director"]),
  blueprint_artifact_id: z.string().min(1).optional(),
  blueprint_revision: z.string().min(1).optional(),
  characters: z.array(coverageRequirementCharacterSchema).min(1),
  world_requirement_ids: z.array(coverageRequirementIdSchema),
  based_on_revision: z.string().min(1).optional(),
  decision_id: z.string().min(1).optional(),
  created_by: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export type CoverageAssessmentPass = "initial" | "formal";

export const COVERAGE_ASSESSMENT_PASSES = ["initial", "formal"] as const;

export type CoverageAssessmentItemStatus = "missing" | "candidate_signal" | "covered_by_source" | "covered_by_user_supplement" | "creative_completion_authorized" | "conflicted";

export const COVERAGE_ASSESSMENT_ITEM_STATUSES = ["missing", "candidate_signal", "covered_by_source", "covered_by_user_supplement", "creative_completion_authorized", "conflicted"] as const;

export const COVERAGE_INITIAL_ITEM_STATUSES: readonly CoverageAssessmentItemStatus[] = ["missing", "candidate_signal", "conflicted"];

export const COVERAGE_FORMAL_ITEM_STATUSES: readonly CoverageAssessmentItemStatus[] = ["missing", "covered_by_source", "covered_by_user_supplement", "creative_completion_authorized", "conflicted"];

export interface CoverageAssessmentInputSnapshot {
  blueprint_revision?: string;
  source_revisions: Array<{ source_id: string; revision: string }>;
  candidate_projection_revision?: string;
  fact_projection_revision?: string;
  fact_review_run_id?: string;
  fact_review_projection_revision?: string;
}

export interface CoverageAssessmentItem {
  character_id?: string;
  requirement_id: string;
  status: CoverageAssessmentItemStatus;
  candidate_fact_ids: string[];
  accepted_fact_ids: string[];
  research_task_ids: string[];
  resolution_ids: string[];
  reason?: string;
}

export interface CoverageAssessment {
  id: string;
  revision: string;
  pass: CoverageAssessmentPass;
  requirement_set_id: string;
  requirement_set_revision: string;
  input_snapshot: CoverageAssessmentInputSnapshot;
  items: CoverageAssessmentItem[];
  operation_id: string;
  created_by: string;
  created_at: string;
}

export const coverageAssessmentItemSchema = z.object({
  character_id: z.string().min(1).optional(),
  requirement_id: coverageRequirementIdSchema,
  status: z.enum(COVERAGE_ASSESSMENT_ITEM_STATUSES),
  candidate_fact_ids: z.array(z.string().min(1)),
  accepted_fact_ids: z.array(z.string().min(1)),
  research_task_ids: z.array(z.string().min(1)),
  resolution_ids: z.array(z.string().min(1)),
  reason: z.string().min(1).optional(),
}).strict();

export const coverageAssessmentSchema = z.object({
  id: z.string().min(1),
  revision: z.string().min(1),
  pass: z.enum(COVERAGE_ASSESSMENT_PASSES),
  requirement_set_id: z.string().min(1),
  requirement_set_revision: z.string().min(1),
  input_snapshot: z.object({
    blueprint_revision: z.string().min(1).optional(),
    source_revisions: z.array(z.object({ source_id: z.string().min(1), revision: z.string().min(1) }).strict()),
    candidate_projection_revision: z.string().min(1).optional(),
    fact_projection_revision: z.string().min(1).optional(),
    fact_review_run_id: z.string().min(1).optional(),
    fact_review_projection_revision: z.string().min(1).optional(),
  }).strict(),
  items: z.array(coverageAssessmentItemSchema).min(1),
  operation_id: z.string().min(1),
  created_by: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export type CoverageUserDecisionAction = "requirement_change" | "creative_completion" | "user_supplement" | "assessment_replacement";

export const COVERAGE_USER_DECISION_ACTIONS = ["requirement_change", "creative_completion", "user_supplement", "assessment_replacement"] as const;

export interface CoverageUserDecisionRecord {
  id: string;
  action: CoverageUserDecisionAction;
  requirement_ids: string[];
  character_id?: string;
  assessment_id?: string;
  assessment_revision?: string;
  requirement_set_revision: string;
  choice: string;
  rationale: string;
  user_input: string;
  actor: string;
  operation_id: string;
  supersedes?: string;
  created_at: string;
}

export const coverageUserDecisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(COVERAGE_USER_DECISION_ACTIONS),
  requirement_ids: z.array(coverageRequirementIdSchema),
  character_id: z.string().min(1).optional(),
  assessment_id: z.string().min(1).optional(),
  assessment_revision: z.string().min(1).optional(),
  requirement_set_revision: z.string().min(1),
  choice: z.string().min(1),
  rationale: z.string().min(1),
  user_input: z.string().min(1),
  actor: z.string().min(1),
  operation_id: z.string().min(1),
  supersedes: z.string().min(1).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export function coverageRequirementSetRevision(requirementSet: Omit<CoverageRequirementSet, "id" | "revision" | "created_at">): string {
  return contentHash(canonicalJson({ source: requirementSet.source, blueprint_artifact_id: requirementSet.blueprint_artifact_id, blueprint_revision: requirementSet.blueprint_revision, characters: requirementSet.characters, world_requirement_ids: requirementSet.world_requirement_ids }));
}

export function coverageAssessmentRevision(assessment: Omit<CoverageAssessment, "id" | "revision" | "created_at">): string {
  return contentHash(canonicalJson({ pass: assessment.pass, requirement_set_id: assessment.requirement_set_id, requirement_set_revision: assessment.requirement_set_revision, input_snapshot: assessment.input_snapshot, items: assessment.items, operation_id: assessment.operation_id }));
}
