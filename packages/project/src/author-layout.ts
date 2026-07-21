import type { LegacyZhujiModuleKind, PaletteModuleKind, ZhujiModuleKind } from "@card-workspace/schemas";

export const zhujiModuleFiles: ReadonlyArray<{ kind: ZhujiModuleKind; file: string; title: string }> = [
  { kind: "appearance", file: "01-appearance.yaml", title: "外顯" },
  { kind: "inner_nature", file: "02-inner-nature.yaml", title: "內質" },
  { kind: "extension", file: "03-extension.yaml", title: "外延" },
  { kind: "trait_refinement", file: "04-trait-refinement.yaml", title: "特質細化" },
  { kind: "trait_dialogue", file: "05-trait-dialogue.yaml", title: "特質語料" },
  { kind: "scene_dialogue", file: "06-scene-dialogue.yaml", title: "場景語料" },
  { kind: "self_introduction", file: "07-self-introduction.yaml", title: "自我介紹" },
];

export const legacyZhujiModuleFiles: ReadonlyArray<{ kind: LegacyZhujiModuleKind; file: string; title: string }> = [
  { kind: "appearance", file: "01-appearance.yaml", title: "外顯" },
  { kind: "inner_nature", file: "02-inner-nature.yaml", title: "內質" },
  { kind: "extension", file: "03-extension.yaml", title: "外延" },
  { kind: "expanded_extension", file: "04-expanded-extension.yaml", title: "外延擴展" },
  { kind: "trait_refinement", file: "05-trait-refinement.yaml", title: "特質細化" },
  { kind: "scene_dialogue", file: "06-scene-dialogue.yaml", title: "場景語料" },
  { kind: "self_introduction", file: "07-self-introduction.yaml", title: "自我介紹" },
];

export const paletteModuleFiles: ReadonlyArray<{ kind: PaletteModuleKind; file: string; title: string }> = [
  { kind: "basic_information", file: "01-basic-information.yaml", title: "基礎信息" },
  { kind: "personality_palette", file: "02-personality-palette.yaml", title: "性格調色盤" },
  { kind: "tri_faceted", file: "03-tri-faceted.yaml", title: "三面性" },
  { kind: "secondary_interpretation", file: "04-secondary-interpretation.yaml", title: "二次解釋" },
];

export const sourcesFactsProjectionFiles = {
  sourceManifest: "sources/manifest.yaml",
  factRegister: "facts/register.yaml",
  conflictRegister: "facts/conflicts.yaml",
} as const;

export const sourcesFactsJournalFiles = [
  "sources/journals/source-events.jsonl",
  "facts/decisions.jsonl",
] as const;

export const relationshipsFile = "relationships.yaml";

export { blueprintFile, workflowJournalFile, workflowProjectionFile } from "./workflow-layout.js";
