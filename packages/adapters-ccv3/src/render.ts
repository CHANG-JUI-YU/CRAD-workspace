import type { CanonicalLoreEntry } from "@card-workspace/schemas";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderLoreEntry(entry: CanonicalLoreEntry): string {
  const sections = entry.fragments
    .map(
      (fragment) =>
        `<section id="${escapeAttribute(fragment.id)}" title="${escapeAttribute(fragment.title)}">\n${fragment.content}\n</section>`,
    )
    .join("\n");
  return `<lore_entry id="${escapeAttribute(entry.id)}" category="${escapeAttribute(entry.category)}">\n${sections}\n</lore_entry>`;
}
