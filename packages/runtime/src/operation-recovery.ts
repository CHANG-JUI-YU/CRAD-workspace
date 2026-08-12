import type { ArtifactKind, ArtifactRecord, ProjectState, TemplateProposalValue } from "@st-workspace/core";

const TECHNICAL_REVIEW_ARTIFACT_KINDS: ReadonlySet<ArtifactKind> = new Set(["review", "source_research", "fact_curation", "fact_review"]);

function pluginIdOf(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { plugin_id?: unknown };
    return typeof parsed.plugin_id === "string" ? parsed.plugin_id : undefined;
  } catch {
    return undefined;
  }
}

function reviewCriticForArtifactKind(kind: ArtifactKind, content: string): string {
  if (kind === "greeting") return "greetings-critic";
  if (kind === "world_lore") return "world-lore-critic";
  if (kind === "plugin") {
    const pluginId = pluginIdOf(content);
    if (pluginId === "official.ejs") return "ejs-critic";
    if (pluginId === "official.html") return "html-critic";
    return "mvu-critic";
  }
  return "character-critic";
}

type NaturalReviewTarget = { target: ArtifactRecord } | "ambiguous" | undefined;

const REVIEW_KIND_HINTS: Array<{ pattern: RegExp; matches: (artifact: ArtifactRecord) => boolean }> = [
  { pattern: /character|角色|人物/iu, matches: (artifact) => artifact.kind === "character" },
  { pattern: /world|lore|世界|設定/iu, matches: (artifact) => artifact.kind === "world_lore" },
  { pattern: /greeting|開場|問候/iu, matches: (artifact) => artifact.kind === "greeting" },
  { pattern: /mvu/iu, matches: (artifact) => artifact.kind === "plugin" && (pluginIdOf(artifact.content) ?? "").includes("mvu") },
  { pattern: /ejs/iu, matches: (artifact) => artifact.kind === "plugin" && (pluginIdOf(artifact.content) ?? "").includes("ejs") },
  { pattern: /html/iu, matches: (artifact) => artifact.kind === "plugin" && (pluginIdOf(artifact.content) ?? "").includes("html") },
];

function resolveNaturalReviewTarget(request: string, artifacts: readonly ArtifactRecord[]): NaturalReviewTarget {
  const pool = artifacts.filter((artifact) => !TECHNICAL_REVIEW_ARTIFACT_KINDS.has(artifact.kind));
  const named = request.match(/(?:審查|review|檢查|inspect)\s*[:：]?\s*([^\n，,。；;]+)/iu)?.[1]?.trim();
  if (named !== undefined) {
    const matches = pool.filter((artifact) => artifact.name.includes(named) || artifact.key.includes(named));
    if (matches.length === 1) return { target: matches[0]! };
    if (matches.length > 1) return "ambiguous";
  }
  for (const hint of REVIEW_KIND_HINTS) {
    if (hint.pattern.test(request)) {
      const matches = pool.filter(hint.matches);
      if (matches.length === 1) return { target: matches[0]! };
      if (matches.length > 1) return "ambiguous";
      return undefined;
    }
  }
  if (pool.length === 1) return { target: pool[0]! };
  if (pool.length > 1) return "ambiguous";
  return undefined;
}

function defaultAgentForTemplate(proposal: TemplateProposalValue): string {
  if (proposal.kind === "plugin") {
    if (proposal.plugin_id === "official.ejs") return "ejs-creator";
    if (proposal.plugin_id === "official.html") return "html-creator";
    return "mvu-creator";
  }
  if (proposal.kind === "review") {
    const target = `${proposal.target.kind} ${proposal.target.name}`.toLocaleLowerCase();
    if (/world|lore/iu.test(target)) return "world-lore-critic";
    if (/greeting/iu.test(target)) return "greetings-critic";
    if (/mvu/iu.test(target)) return "mvu-critic";
    if (/ejs/iu.test(target)) return "ejs-critic";
    if (/html/iu.test(target)) return "html-critic";
    return "character-critic";
  }
  switch (proposal.kind) {
    case "director_routing": return "director";
    case "source_research": return "source-researcher";
    case "fact_curation": return "fact-curator";
    case "fact_review": return "fact-reviewer-1";
    case "zhuji": return "zhuji-creator";
    case "palette": return "palette-creator";
    case "wardrobe": return "wardrobe-creator";
    case "character": return "director";
    case "relationships": return "relationship-creator";
    case "greetings": return "greetings-creator";
    case "world": return "world-lore-creator";
    case "conversion": return "mode-conversion";
    case "import_analysis": return "card-import-analyst";
  }
}

function proposalCapability(proposal: TemplateProposalValue): string | undefined {
  if (proposal.kind === "plugin") return proposal.plugin_id;
  if (proposal.kind === "review") return `${proposal.target.kind} ${proposal.target.name}`;
  return undefined;
}

function nextFactReviewer(state: ProjectState): string {
  const reviewers = ["fact-reviewer-1", "fact-reviewer-2", "fact-reviewer-3"] as const;
  const counts = new Map(reviewers.map((reviewer) => [reviewer, 0]));
  for (const decision of state.fact_review_decisions) {
    if (counts.has(decision.reviewer_identity as (typeof reviewers)[number])) {
      const reviewer = decision.reviewer_identity as (typeof reviewers)[number];
      counts.set(reviewer, (counts.get(reviewer) ?? 0) + 1);
    }
  }
  return [...reviewers].sort((left, right) => (counts.get(left)! - counts.get(right)!) || left.localeCompare(right))[0]!;
}

export {
  pluginIdOf,
  reviewCriticForArtifactKind,
  resolveNaturalReviewTarget,
  defaultAgentForTemplate,
  proposalCapability,
  nextFactReviewer,
  type NaturalReviewTarget,
};
