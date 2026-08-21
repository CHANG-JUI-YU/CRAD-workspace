import {
  buildTemplateContext,
  buildZhujiTemplateContext,
  canonicalJson,
  computeProjectProjection,
  contentHash,
  CoreError,
  createEntityMatcher,
  factReferencesAnyEntity,
  parseWardrobeMarkdown,
  sourceContextFromRecord,
  templateJsonSchemaFor,
  zhujiProposalJsonSchema,
  type ArtifactKind,
  type AuthoringKnowledgeContext,
  type ExecutionContext,
  type FactRecord,
  type FactReviewContext,
  type ProjectRepository,
  type ProjectState,
  type SourceAdaptationIntent,
  type TemplateInstance,
  type TemplateKind,
  type ZhujiModuleKind,
} from "@st-workspace/core";
import { latestBlueprintSnapshot, objectValue } from "./interview-application.js";

const TEMPLATE_ARTIFACT_KINDS: Readonly<Record<TemplateKind, ArtifactKind>> = {
  character: "character",
  zhuji: "zhuji",
  palette: "palette",
  wardrobe: "wardrobe",
  greetings: "greeting",
  relationships: "relationship",
  world: "world_lore",
  conversion: "conversion",
  import_analysis: "import_analysis",
  review: "review",
  source_research: "source_research",
  fact_curation: "fact_curation",
  fact_review: "fact_review",
  plugin: "plugin",
  director_routing: "director_routing",
};

const CHARACTER_SCOPED_TEMPLATE_KINDS = new Set<TemplateKind>(["character", "zhuji", "palette", "wardrobe", "conversion"]);
const PARTICIPANT_SCOPED_TEMPLATE_KINDS = new Set<TemplateKind>(["relationships", "greetings"]);

export interface TemplateContextTarget {
  readonly character_id?: string;
  readonly participant_ids?: readonly string[];
}

export type TemplateContextResult = ReturnType<typeof buildTemplateContext> & { readonly target?: TemplateContextTarget };

function artifactMatchesTemplateKind(kind: TemplateKind, artifactKind: ArtifactKind): boolean {
  return TEMPLATE_ARTIFACT_KINDS[kind] === artifactKind;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function legacyCharacterValue(value: { kind?: unknown; document?: unknown }): boolean {
  if (value.kind !== undefined) return false;
  const document = record(value.document);
  return typeof document?.id === "string"
    && document.id.trim().length > 0
    && typeof document.display_name === "string"
    && document.display_name.trim().length > 0;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function blueprintRosterIds(state: ProjectState): string[] {
  const blueprint = latestBlueprintSnapshot(state);
  if (!Array.isArray(blueprint?.characters)) return [];
  return uniqueStrings(blueprint.characters.flatMap((candidate) => {
    const id = record(candidate)?.id;
    return typeof id === "string" ? [id] : [];
  }));
}

function validateRosterTarget(characterId: string, rosterIds: readonly string[]): string {
  const normalized = characterId.trim();
  if (normalized.length === 0 || !rosterIds.includes(normalized)) {
    throw new CoreError(
      "TEMPLATE_CHARACTER_TARGET_INVALID",
      `Character target ${normalized || "(empty)"} is not in the current Blueprint roster.`,
      true,
    );
  }
  return normalized;
}

function validateParticipantTargets(participantIds: readonly string[], rosterIds: readonly string[]): string[] {
  const normalized = uniqueStrings(participantIds);
  const invalid = normalized.filter((characterId) => !rosterIds.includes(characterId));
  if (normalized.length === 0 || invalid.length > 0) {
    throw new CoreError(
      "TEMPLATE_PARTICIPANT_TARGET_INVALID",
      invalid.length > 0
        ? `Participant targets are not in the current Blueprint roster: ${invalid.join(", ")}.`
        : "At least one participant target is required.",
      true,
    );
  }
  return normalized;
}

function relationshipBlueprintParticipants(state: ProjectState, rosterIds: readonly string[]): string[] {
  const relationships = objectValue(latestBlueprintSnapshot(state)?.relationships);
  const configured = stringValues(relationships?.character_ids);
  return relationships?.scope === "participant_subset" && configured.length > 0 ? configured : [...rosterIds];
}

function resolveTemplateTarget(state: ProjectState, kind: TemplateKind, requested: TemplateContextTarget = {}): TemplateContextTarget {
  const rosterIds = blueprintRosterIds(state);
  if (CHARACTER_SCOPED_TEMPLATE_KINDS.has(kind)) {
    if (requested.participant_ids !== undefined) {
      throw new CoreError("TEMPLATE_CHARACTER_TARGET_INVALID", `${kind} requires character_id, not participant_ids.`, true);
    }
    if (requested.character_id !== undefined) {
      return { character_id: validateRosterTarget(requested.character_id, rosterIds) };
    }
    if (rosterIds.length === 1) return { character_id: rosterIds[0]! };
    if (rosterIds.length > 1) {
      throw new CoreError("TEMPLATE_CHARACTER_TARGET_REQUIRED", `${kind} requires character_id for a multi-character Blueprint.`, true);
    }
    return {};
  }

  if (PARTICIPANT_SCOPED_TEMPLATE_KINDS.has(kind)) {
    if (requested.character_id !== undefined) {
      throw new CoreError("TEMPLATE_PARTICIPANT_TARGET_INVALID", `${kind} requires participant_ids, not character_id.`, true);
    }
    if (requested.participant_ids !== undefined) {
      return { participant_ids: validateParticipantTargets(requested.participant_ids, rosterIds) };
    }
    if (rosterIds.length === 0) return {};
    const participantIds = kind === "relationships" ? relationshipBlueprintParticipants(state, rosterIds) : rosterIds;
    return { participant_ids: validateParticipantTargets(participantIds, rosterIds) };
  }

  if (requested.character_id !== undefined || requested.participant_ids !== undefined) {
    throw new CoreError("TEMPLATE_TARGET_NOT_APPLICABLE", `${kind} does not accept a character or participant target.`, true);
  }
  return {};
}

function characterIdFromTemplateValue(kind: TemplateKind, value: unknown, name: string): string | undefined {
  const root = record(value);
  if (kind === "wardrobe") return name.split("/")[0]?.trim();
  if (kind === "character") {
    const id = record(root?.document)?.id;
    return typeof id === "string" ? id.trim() : undefined;
  }
  if (kind === "zhuji" || kind === "palette" || kind === "conversion") {
    const id = root?.character_id;
    return typeof id === "string" ? id.trim() : undefined;
  }
  return undefined;
}

function participantIdsFromTemplateValue(kind: TemplateKind, value: unknown): string[] {
  const root = record(value);
  const document = record(root?.document);
  if (kind === "relationships") return uniqueStrings(stringValues(document?.character_ids));
  if (kind === "greetings") {
    return uniqueStrings(Array.isArray(document?.greetings)
      ? document.greetings.flatMap((greeting) => stringValues(record(greeting)?.character_ids))
      : []);
  }
  return [];
}

function instanceMatchesTarget(kind: TemplateKind, value: unknown, name: string, target: TemplateContextTarget): boolean {
  if (target.character_id !== undefined) return characterIdFromTemplateValue(kind, value, name) === target.character_id;
  if (target.participant_ids === undefined) return true;
  const participants = participantIdsFromTemplateValue(kind, value);
  if (kind === "relationships") return sameStringSet(participants, target.participant_ids);
  if (kind === "greetings") {
    const targetSet = new Set(target.participant_ids);
    return participants.length > 0 && participants.every((characterId) => targetSet.has(characterId));
  }
  return true;
}

function isTemplateContextTarget(value: TemplateContextTarget | ExecutionContext["executionAgent"] | undefined): value is TemplateContextTarget {
  return value !== undefined && ("character_id" in value || "participant_ids" in value);
}

export interface AuthoringApplicationDeps {
  repository: ProjectRepository;
  knowledge: {
    factReviewContext(options?: { reviewer_identity?: string }): Promise<FactReviewContext>;
  };
}

function buildAuthoringKnowledgeContext(state: ProjectState, options?: { scope?: "character" | "relationship" | "greeting" | "world"; character_id?: string; related_character_ids?: ReadonlyArray<string>; coverage?: ReadonlyArray<string>; include_facts?: boolean; include_sources?: boolean }): AuthoringKnowledgeContext {
  const blueprint = latestBlueprintSnapshot(state);
  const candidateById = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
  const matcher = createEntityMatcher(state);
  const characterId = options?.character_id;
  const relatedCharacterIds = [...(options?.related_character_ids ?? [])];
  const factRelevant = (fact: FactRecord): boolean => {
    const isWorldFact = fact.classification === "world" || fact.coverage?.includes("world_context") === true;
    if (options?.scope === "world") return isWorldFact;
    if (options?.scope === "relationship" || options?.scope === "greeting") {
      return factReferencesAnyEntity(fact, matcher, relatedCharacterIds);
    }
    if (characterId !== undefined) {
      return isWorldFact || factReferencesAnyEntity(fact, matcher, [characterId]);
    }
    if (relatedCharacterIds.length > 0) return factReferencesAnyEntity(fact, matcher, relatedCharacterIds);
    return true;
  };
  const coverageFiltered = (fact: FactRecord): boolean => {
    if (options?.coverage === undefined || options.coverage.length === 0) return true;
    return (fact.coverage ?? []).some((dimension) => options.coverage!.includes(dimension));
  };
  const includeFacts = options?.include_facts !== false;
  const acceptedFacts = includeFacts ? state.facts.filter((fact) => fact.status === "accepted" && factRelevant(fact) && coverageFiltered(fact)) : [];
  const unresolvedFacts = includeFacts ? state.facts.filter((fact) => (fact.status === "candidate" || fact.status === "conflict") && factRelevant(fact) && coverageFiltered(fact)) : [];
  return {
    ...(blueprint === undefined ? {} : { blueprint }),
    ...(objectValue(blueprint?.source_adaptation)?.subject_name === undefined ? {} : { source_adaptation: blueprint?.source_adaptation as SourceAdaptationIntent }),
    accepted_facts: acceptedFacts,
    unresolved_facts: unresolvedFacts,
    sources: options?.include_sources === false ? [] : state.sources.map((source) => sourceContextFromRecord(source, candidateById.get(source.candidate_id))),
    fact_register_revision: contentHash(canonicalJson(state.facts.map((fact) => ({ id: fact.id, status: fact.status, updated_at: fact.updated_at })))),
    adaptation_decisions: [...state.adaptation_decisions],
  };
}

export async function zhujiContext(deps: AuthoringApplicationDeps, characterId?: string): Promise<{ schema: Record<string, unknown>; context: ReturnType<typeof buildZhujiTemplateContext> }> {
  const state = await deps.repository.read();
  const knowledge = buildAuthoringKnowledgeContext(state, characterId === undefined ? undefined : { scope: "character", character_id: characterId });
  const existing = state.artifacts.flatMap((artifact) => {
    if (artifact.kind !== "zhuji") return [];
    try {
      const value = JSON.parse(artifact.content) as { character_id?: unknown; module?: { module?: unknown; title?: unknown } };
      if (typeof value.character_id !== "string" || typeof value.module?.module !== "string" || typeof value.module.title !== "string") return [];
      if (characterId !== undefined && value.character_id !== characterId) return [];
      return [{ artifact_id: artifact.id, character_id: value.character_id, module: value.module.module as ZhujiModuleKind, title: value.module.title, content: value, revision: artifact.revision }];
    } catch {
      return [];
    }
  });
  return { schema: zhujiProposalJsonSchema as Record<string, unknown>, context: buildZhujiTemplateContext(existing, knowledge) };
}

export async function templateContext(
  deps: AuthoringApplicationDeps,
  kind: TemplateKind,
  targetOrExecutionAgent?: TemplateContextTarget | ExecutionContext["executionAgent"],
  explicitExecutionAgent?: ExecutionContext["executionAgent"],
): Promise<{ schema: Record<string, unknown>; context: TemplateContextResult }> {
  const state = await deps.repository.read();
  const hasRequestedTarget = isTemplateContextTarget(targetOrExecutionAgent);
  const requestedTarget = hasRequestedTarget ? targetOrExecutionAgent : {};
  const executionAgent = hasRequestedTarget ? explicitExecutionAgent : targetOrExecutionAgent;
  const target = resolveTemplateTarget(state, kind, requestedTarget);
  const existing = computeProjectProjection(state).currentArtifacts.flatMap<TemplateInstance>((artifact): TemplateInstance[] => {
    if (kind === "wardrobe" && artifact.kind === "wardrobe") {
      const characterId = artifact.name.split("/")[0]?.trim();
      if (characterId === undefined || characterId.length === 0) return [];
      const content = artifact.content;
      const parsed = parseWardrobeMarkdown(content);
      const value = { kind: "wardrobe", character_id: characterId, content };
      if (!instanceMatchesTarget(kind, value, artifact.name, target)) return [];
      return [{ artifact_id: artifact.id, kind, name: artifact.name, value, content: parsed.document, markdown: content, revision: artifact.revision }];
    }
    if (!artifactMatchesTemplateKind(kind, artifact.kind)) return [];
    try {
      const value = JSON.parse(artifact.content) as { kind?: unknown; document?: unknown };
      if (value.kind !== kind && !(kind === "character" && legacyCharacterValue(value))) return [];
      const name = artifact.name;
      if (!instanceMatchesTarget(kind, value, name, target)) return [];
      return [{ artifact_id: artifact.id, kind, name, value, content: value, revision: artifact.revision }];
    } catch {
      return [];
    }
  });
  const factReview = kind === "fact_review"
    ? await deps.knowledge.factReviewContext(executionAgent === undefined ? {} : { reviewer_identity: executionAgent.id })
    : undefined;
  const knowledgeOptions = kind === "fact_review"
    ? { include_facts: false, include_sources: false }
    : kind === "world"
      ? { scope: "world" as const }
      : target.participant_ids !== undefined
        ? { scope: kind === "relationships" ? "relationship" as const : "greeting" as const, related_character_ids: target.participant_ids }
        : target.character_id !== undefined
          ? { scope: "character" as const, character_id: target.character_id }
          : undefined;
  const knowledge: AuthoringKnowledgeContext = {
    ...buildAuthoringKnowledgeContext(state, knowledgeOptions),
    ...(factReview === undefined ? {} : { fact_review: factReview as FactReviewContext }),
  };
  const baseContext = buildTemplateContext(kind, existing, knowledge);
  const context: TemplateContextResult = target.character_id === undefined && target.participant_ids === undefined
    ? baseContext
    : { ...baseContext, target };
  return { schema: templateJsonSchemaFor(kind), context };
}

export async function authoringKnowledgeContext(deps: AuthoringApplicationDeps): Promise<AuthoringKnowledgeContext> {
  return buildAuthoringKnowledgeContext(await deps.repository.read());
}
