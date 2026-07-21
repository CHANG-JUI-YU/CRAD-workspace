import {
  characterCardV2Schema,
  type CharacterCardV2,
  type CharacterCardV3,
} from "@card-workspace/schemas";

export interface DowngradeLoss {
  path: string;
  reason: string;
}

export interface DowngradeV2Result {
  card: CharacterCardV2;
  losses: DowngradeLoss[];
}

function removeDecorators(content: string): string {
  return content
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("@@"))
    .join("\n");
}

export function downgradeCharacterCardV3ToV2(card: CharacterCardV3): DowngradeV2Result {
  const losses: DowngradeLoss[] = [];
  if (card.data.group_only_greetings.length > 0) {
    losses.push({ path: "/data/group_only_greetings", reason: "V2 不支援群組限定開場白" });
  }
  for (const field of [
    "assets",
    "nickname",
    "creator_notes_multilingual",
    "source",
    "creation_date",
    "modification_date",
  ] as const) {
    if (card.data[field] !== undefined) losses.push({ path: `/data/${field}`, reason: "V2 不支援此 V3 欄位" });
  }
  const characterBook = card.data.character_book
    ? {
        ...card.data.character_book,
        entries: card.data.character_book.entries.map((entry) => {
          const { use_regex: useRegex, ...legacyEntry } = entry;
          void useRegex;
          return { ...legacyEntry, content: removeDecorators(entry.content) };
        }),
      }
    : undefined;
  const result = characterCardV2Schema.parse({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: card.data.name,
      description: card.data.description,
      personality: card.data.personality,
      scenario: card.data.scenario,
      first_mes: card.data.first_mes,
      mes_example: card.data.mes_example,
      creator_notes: `[由 CCv3 降級；部分 V3 功能可能遺失]\n${card.data.creator_notes}`,
      system_prompt: card.data.system_prompt,
      post_history_instructions: card.data.post_history_instructions,
      alternate_greetings: card.data.alternate_greetings,
      tags: card.data.tags,
      creator: card.data.creator,
      character_version: card.data.character_version,
      extensions: card.data.extensions,
      ...(characterBook ? { character_book: characterBook } : {}),
    },
  });
  return { card: result, losses };
}
