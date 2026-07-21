import {
  canonicalProjectIrSchema,
  type CanonicalActivation,
  type CanonicalLoreEntry,
  type CanonicalPlacement,
  type CanonicalProjectIr,
  type CanonicalRecursion,
  type Diagnostic,
  type NormalizedLoreNode,
  type NormalizedProjectIr,
} from "@card-workspace/schemas";
import { legacyZhujiModuleFiles, paletteModuleFiles, zhujiModuleFiles } from "@card-workspace/project";

export interface PlanResult {
  ok: boolean;
  ir?: CanonicalProjectIr;
  diagnostics: Diagnostic[];
}

const categoryRanks: Record<string, number> = {
  character_identity: 10,
  personality_core: 20,
  character_core: 30,
  character_detail: 40,
  dialogue: 50,
  project_relationships: 55,
  world_people: 60,
  world_organizations: 70,
  world_geography: 80,
  world_history: 90,
  world_concepts: 100,
  world_systems: 110,
  world_items: 120,
  world_events: 130,
};

function activation(node: NormalizedLoreNode, project: NormalizedProjectIr): CanonicalActivation {
  const override = node.compile.activation;
  if (override.type !== "default") return override;
  const owner = project.characters.find((character) => character.id === node.owner_id);
  const keys = node.id === "project.relationships"
    ? [...new Set(node.aliases)]
    : owner
    ? [...new Set([owner.display_name, ...owner.aliases])]
    : [...new Set([node.title, ...node.aliases])];
  return {
    type: "keyed",
    keys,
    secondary_keys: [],
    secondary_logic: "any",
    use_regex: false,
    case_sensitive: false,
    match_whole_words: false,
    triggers: [],
  };
}

function placement(node: NormalizedLoreNode): CanonicalPlacement {
  const override = node.compile.placement;
  if (override.type !== "default") return override;
  return { type: node.category === "character_identity" ? "before_character" : "after_character" };
}

function recursion(node: NormalizedLoreNode): CanonicalRecursion {
  const override = node.compile.recursion;
  if (override.type === "chain") {
    return {
      incoming: override.incoming,
      outgoing: override.outgoing,
      ...(override.delay_until_recursion === undefined
        ? {}
        : { delay_until_recursion: override.delay_until_recursion }),
      max_depth: override.max_depth,
      depends_on: override.depends_on,
    };
  }
  return {
    incoming: false,
    outgoing: false,
    max_depth: 4,
    depends_on: [],
  };
}

function cycleDiagnostics(entries: CanonicalLoreEntry[]): Diagnostic[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const visit = (id: string, chain: string[]) => {
    if (visiting.has(id)) {
      diagnostics.push({
        code: "RECURSION_DEPENDENCY_CYCLE",
        severity: "error",
        message: `遞迴依賴形成循環：${[...chain, id].join(" -> ")}`,
        location: { file: ".build/ir.json", path: ["entries", id, "recursion", "depends_on"] },
        evidence: [],
        fixability: "manual",
      });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.recursion.depends_on ?? []) {
      if (byId.has(dependency)) visit(dependency, [...chain, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const entry of entries) visit(entry.id, []);
  return diagnostics;
}

function moduleKind(node: NormalizedLoreNode): string {
  if (!node.owner_id) return "";
  return node.id.slice(`character.${node.owner_id}.`.length);
}

function characterModuleRank(node: NormalizedLoreNode, project: NormalizedProjectIr): number {
  if (!node.owner_id) return Number.MAX_SAFE_INTEGER;
  const character = project.characters.find((item) => item.id === node.owner_id);
  if (!character) return Number.MAX_SAFE_INTEGER;
  const layout = character.mode === "palette"
    ? paletteModuleFiles
    : project.nodes.some((item) => item.owner_id === node.owner_id && moduleKind(item) === "expanded_extension")
      ? legacyZhujiModuleFiles
      : zhujiModuleFiles;
  const rank = layout.findIndex((item) => item.kind === moduleKind(node));
  return rank === -1 ? layout.length : rank;
}

function compareNodes(left: NormalizedLoreNode, right: NormalizedLoreNode, project: NormalizedProjectIr): number {
  const leftCharacter = left.owner_id
    ? project.characters.findIndex((character) => character.id === left.owner_id)
    : Number.MAX_SAFE_INTEGER;
  const rightCharacter = right.owner_id
    ? project.characters.findIndex((character) => character.id === right.owner_id)
    : Number.MAX_SAFE_INTEGER;
  if (leftCharacter !== rightCharacter) return leftCharacter - rightCharacter;
  if (left.owner_id && right.owner_id) {
    const moduleDifference = characterModuleRank(left, project) - characterModuleRank(right, project);
    if (moduleDifference) return moduleDifference;
  }
  const categoryDifference = (categoryRanks[left.category] ?? 1000) - (categoryRanks[right.category] ?? 1000);
  return categoryDifference || left.id.localeCompare(right.id);
}

export function planCanonicalProject(project: NormalizedProjectIr): PlanResult {
  const sorted = [...project.nodes].sort((left, right) => compareNodes(left, right, project));
  const entries: CanonicalLoreEntry[] = sorted.map((node, index) => ({
    id: node.id,
    ...(node.owner_id ? { owner_id: node.owner_id } : {}),
    category: node.category,
    title: node.title,
    fragments: node.fragments,
    content_format: node.content_format,
    activation: activation(node, project),
    placement: placement(node),
    recursion: recursion(node),
    insertion_order: index,
    priority: node.compile.priority,
    ...(node.compile.token_budget === undefined ? {} : { token_budget: node.compile.token_budget }),
    provenance: node.provenance,
    extensions: { ...node.extensions, ...node.compile.extensions },
    passthrough: node.passthrough,
    decisions: [
      {
        field: "activation",
        source: node.compile.activation.type === "default" ? "category_default" : "author_override",
        explanation: node.compile.activation.type === "default" ? "依內容類別選擇預設觸發" : "採用作者觸發覆寫",
      },
      {
        field: "placement",
        source: node.compile.placement.type === "default" ? "category_default" : "author_override",
        explanation: node.compile.placement.type === "default" ? "依內容類別選擇語意位置" : "採用作者位置覆寫",
      },
      {
        field: "recursion",
        source: node.compile.recursion.type === "default" ? "category_default" : "author_override",
        explanation: node.compile.recursion.type === "default" ? "採用工作區隔離預設" : "採用作者遞迴覆寫",
      },
      {
        field: "insertion_order",
        source: "stable_order",
        explanation: node.owner_id ? "按角色作者模組檔案順序決定" : "按專案共享與世界類別順位及 stable ID 決定",
      },
    ],
  }));
  const diagnostics = cycleDiagnostics(entries);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    ir: canonicalProjectIrSchema.parse({
      schema_version: project.schema_version,
      project_id: project.project_id,
      project_kind: project.project_kind,
      title: project.title,
      card: project.card,
      characters: project.characters,
      greetings: project.greetings,
      entries,
      extensions: project.extensions,
      passthrough: project.passthrough,
    }),
    diagnostics: [],
  };
}
