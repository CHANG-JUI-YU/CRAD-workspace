import {
  buildTemplateContext,
  buildZhujiTemplateContext,
  canonicalJson,
  contentHash,
  parseWardrobeMarkdown,
  sourceContextFromRecord,
  templateJsonSchemaFor,
  zhujiProposalJsonSchema,
  type AuthoringKnowledgeContext,
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

export interface AuthoringApplicationDeps {
  repository: ProjectRepository;
  knowledge: {
    factReviewContext(): Promise<FactReviewContext>;
  };
}

function buildAuthoringKnowledgeContext(state: ProjectState, options?: { character_id?: string; related_character_ids?: ReadonlyArray<string>; coverage?: ReadonlyArray<string>; include_facts?: boolean; include_sources?: boolean }): AuthoringKnowledgeContext {
  const blueprint = latestBlueprintSnapshot(state);
  const candidateById = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
  const characterId = options?.character_id;
  const factRelevant = (fact: FactRecord): boolean => {
    if (characterId === undefined) return true;
    const subject = fact.subject ?? "";
    if (subject === characterId) return true;
    if ((fact.coverage ?? []).includes(characterId)) return true;
    if (fact.classification === "world") return true;
    if ((options?.related_character_ids ?? []).includes(subject)) return true;
    return false;
  };
  const coverageFiltered = (fact: FactRecord): boolean => {
    if (options?.coverage === undefined || options.coverage.length === 0) return true;
    return (fact.coverage ?? []).some((dimension) => options.coverage!.includes(dimension));
  };
  const includeFacts = options?.include_facts !== false;
  const acceptedFacts = includeFacts ? state.facts.filter((fact) => fact.status === "accepted" && factRelevant(fact) && coverageFiltered(fact)) : [];
  const unresolvedFacts = includeFacts ? state.facts.filter((fact) => fact.status !== "accepted" && factRelevant(fact) && coverageFiltered(fact)) : [];
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
  const knowledge = buildAuthoringKnowledgeContext(state, characterId === undefined ? undefined : { character_id: characterId });
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

export async function templateContext(deps: AuthoringApplicationDeps, kind: TemplateKind): Promise<{ schema: Record<string, unknown>; context: ReturnType<typeof buildTemplateContext> }> {
  const state = await deps.repository.read();
  const existing = state.artifacts.flatMap<TemplateInstance>((artifact): TemplateInstance[] => {
    if (kind === "wardrobe" && artifact.kind === "wardrobe") {
      const characterId = artifact.name.split("/")[0]?.trim();
      if (characterId === undefined || characterId.length === 0) return [];
      const content = artifact.content;
      const parsed = parseWardrobeMarkdown(content);
      return [{ artifact_id: artifact.id, kind, name: artifact.name, value: { kind: "wardrobe", character_id: characterId, content }, content: parsed.document, markdown: content, revision: artifact.revision }];
    }
    try {
      const value = JSON.parse(artifact.content) as { kind?: unknown; document?: unknown };
      const kindMatch = kind === "character" ? value.document !== undefined || value.kind === "character" : value.kind === kind;
      if (!kindMatch) return [];
      const name = artifact.name;
      return [{ artifact_id: artifact.id, kind, name, value, content: value, revision: artifact.revision }];
    } catch {
      return [];
    }
  });
  const factReview = kind === "fact_review" ? await deps.knowledge.factReviewContext() : undefined;
  const firstInstance = existing[0];
  const rawValue = firstInstance?.value as { character_id?: unknown; document?: { id?: unknown } } | undefined;
  const instanceCharacterId = typeof rawValue?.character_id === "string"
    ? rawValue.character_id
    : typeof rawValue?.document?.id === "string"
      ? rawValue.document.id
      : typeof firstInstance?.name === "string" && firstInstance.name.includes("/")
        ? firstInstance.name.split("/")[0]
        : undefined;
  const knowledge: AuthoringKnowledgeContext = {
    ...buildAuthoringKnowledgeContext(state, kind === "fact_review"
      ? { include_facts: false, include_sources: false }
      : instanceCharacterId === undefined ? undefined : { character_id: instanceCharacterId }),
    ...(factReview === undefined ? {} : { fact_review: factReview as FactReviewContext }),
  };
  const context = buildTemplateContext(kind, existing, knowledge);
  return { schema: templateJsonSchemaFor(kind), context };
}

export async function authoringKnowledgeContext(deps: AuthoringApplicationDeps): Promise<AuthoringKnowledgeContext> {
  return buildAuthoringKnowledgeContext(await deps.repository.read());
}
