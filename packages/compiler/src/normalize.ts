import {
  normalizedProjectIrSchema,
  type CompileOverride,
  type Diagnostic,
  type JsonObject,
  type NormalizedLoreNode,
  type NormalizedProjectIr,
  type ProvenanceRef,
} from "@card-workspace/schemas";
import { orderedYaml, type LoadedAuthorProject } from "@card-workspace/project";

export interface NormalizeResult {
  ok: boolean;
  ir?: NormalizedProjectIr;
  diagnostics: Diagnostic[];
}

function renderRelationships(document: NonNullable<LoadedAuthorProject["relationships"]>, names: Map<string, string>): string {
  const name = (characterId: string) => names.get(characterId) ?? characterId;
  const lines = [
    `<team_${document.team_code}>`,
    "角色概括",
    ...document.character_summaries.map((item) => `- ${name(item.character_id)}：${item.summary}`),
    "",
    "方向觀點矩陣",
    ...document.perspectives.map((item) =>
      `- ${name(item.source_character_id)} -> ${name(item.target_character_id)}：${item.summary}`),
    "",
    "小團體",
    ...(document.groups.length === 0
      ? ["- 無"]
      : document.groups.flatMap((group) => [
          `- ${group.name}（${group.member_ids.map(name).join("、")}）`,
          `  形成原因：${group.formation_cause}`,
          `  運作模式：${group.operating_pattern}`,
          `  排他性：${group.exclusivity}`,
          `  潛在衝突：${group.latent_conflicts.length > 0 ? group.latent_conflicts.join("；") : "無"}`,
          `  加入條件：${group.joining_conditions}`,
        ])),
    "",
    "關係網總結",
    `- 整體特徵：${document.summary.network_character}`,
    `- 群組間關係：${document.summary.inter_group_relations}`,
    `- 穩定性：${document.summary.stability}`,
    `- 衝突觸發：${document.summary.conflict_triggers.length > 0
      ? document.summary.conflict_triggers.map((item) => `${item.trigger}（${item.severity}）`).join("；")
      : "無"}`,
    `- 親密發展機會：${document.summary.intimacy_opportunities.length > 0
      ? document.summary.intimacy_opportunities.join("；")
      : "無"}`,
    `</team_${document.team_code}>`,
  ];
  return lines.join("\n");
}

function moduleCategory(module: string): string {
  const categories: Record<string, string> = {
    appearance: "character_identity",
    inner_nature: "personality_core",
    extension: "character_detail",
    expanded_extension: "character_detail",
    trait_refinement: "character_detail",
    trait_dialogue: "dialogue",
    scene_dialogue: "dialogue",
    self_introduction: "character_core",
    basic_information: "character_identity",
    personality_palette: "personality_core",
    tri_faceted: "personality_core",
    secondary_interpretation: "character_core",
  };
  return categories[module] ?? "character_detail";
}

function fragments(
  nodeId: string,
  document: {
    title: string;
    content: string;
    provenance: ProvenanceRef[];
    extensions: JsonObject;
    sections: Array<{
      id: string;
      title: string;
      content: string;
      provenance: ProvenanceRef[];
      extensions: JsonObject;
    }>;
  },
) {
  return [
    {
      id: `${nodeId}.main`,
      title: document.title,
      content: document.content,
      provenance: document.provenance,
      extensions: document.extensions,
    },
    ...document.sections.map((section) => ({
      id: `${nodeId}.section.${section.id}`,
      title: section.title,
      content: section.content,
      provenance: section.provenance,
      extensions: section.extensions,
    })),
  ];
}

export function normalizeAuthorProject(project: LoadedAuthorProject): NormalizeResult {
  if (!project.ok || !project.manifest || (project.manifest.kind === "character_card" && !project.greetings)) {
    return { ok: false, diagnostics: project.diagnostics };
  }
  const nodes: NormalizedLoreNode[] = [];
  const characters = [...project.characters]
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
    .map((character) => {
      for (const module of [...character.modules].sort((left, right) => left.module.localeCompare(right.module))) {
        const nodeId = `character.${character.manifest.id}.${module.module}`;
        nodes.push({
          id: nodeId,
          owner_id: character.manifest.id,
          category: module.compile.category ?? moduleCategory(module.module),
          title: module.title,
          aliases: [],
          fragments: "data" in module
            ? [{ id: `${nodeId}.main`, title: module.title, content: orderedYaml(module.data), provenance: module.provenance, extensions: module.extensions }]
            : fragments(nodeId, module),
          content_format: "workspace_xml",
          compile: module.compile as CompileOverride,
          provenance: module.provenance,
          extensions: module.extensions,
          passthrough: {},
        });
      }
      return {
        id: character.manifest.id,
        display_name: character.document.display_name,
        aliases: character.document.aliases,
        summary: character.document.summary,
        mode: character.manifest.mode,
        role: character.manifest.role,
        extensions: character.document.extensions,
      };
    });
  if (project.relationships) {
    const participantDocuments = project.relationships.character_ids.map((characterId) =>
      project.characters.find((character) => character.manifest.id === characterId)!);
    const names = new Map(participantDocuments.map((character) => [character.manifest.id, character.document.display_name]));
    const activationKeys = participantDocuments.flatMap((character) => [
      character.document.display_name,
      ...character.document.aliases,
    ]);
    const nodeId = "project.relationships";
    nodes.push({
      id: nodeId,
      category: project.relationships.compile.category ?? "project_relationships",
      title: "角色關係",
      aliases: [...new Set(activationKeys)],
      fragments: [{
        id: `${nodeId}.main`,
        title: "角色關係",
        content: renderRelationships(project.relationships, names),
        provenance: project.relationships.provenance,
        extensions: project.relationships.extensions,
      }],
      content_format: "raw",
      compile: project.relationships.compile,
      provenance: project.relationships.provenance,
      extensions: project.relationships.extensions,
      passthrough: {},
    });
  }
  for (const entry of [...project.world].sort((left, right) => left.id.localeCompare(right.id))) {
    const nodeId = `world.${entry.id}`;
    nodes.push({
      id: nodeId,
      category: `world_${entry.category}`,
      title: entry.title,
      aliases: entry.aliases,
      fragments: fragments(nodeId, entry),
      content_format: "workspace_xml",
      compile: entry.compile,
      provenance: entry.provenance,
      extensions: entry.extensions,
      passthrough: {},
    });
  }
  const ir = normalizedProjectIrSchema.parse({
    schema_version: 1,
    project_id: project.manifest.id,
    project_kind: project.manifest.kind,
    title: project.manifest.title,
    card: project.manifest.kind === "character_card"
      ? { ...project.manifest.card, name: project.manifest.title }
      : project.manifest.card,
    characters,
    greetings: [...(project.greetings?.greetings ?? [])]
      .sort((left, right) => {
        const rank = { primary: 0, alternate: 1, group_only: 2 };
        return rank[left.kind] - rank[right.kind] || left.id.localeCompare(right.id);
      })
      .map((greeting) => ({
        id: greeting.id,
        kind: greeting.kind,
        content: greeting.content,
        character_ids: greeting.character_ids,
        provenance: greeting.provenance,
        extensions: greeting.extensions,
      })),
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    extensions: project.manifest.extensions,
    passthrough: { root: {}, data: {}, character_book: {} },
  });
  return { ok: true, ir, diagnostics: [] };
}
