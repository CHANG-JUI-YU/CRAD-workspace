import { z } from "zod";

/**
 * The wardrobe is intentionally persisted as Markdown.  This schema only
 * carries the small amount of routing information needed by the runtime; the
 * Markdown parser below owns the content validation.
 */
export const wardrobeCharacterIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const wardrobeCategoryNames = [
  "上衣",
  "下身",
  "洋裝",
  "外套",
  "內衣",
  "內褲",
  "襪類",
  "睡衣",
  "家居服",
  "制服",
  "工作服",
  "運動服",
  "泳裝",
  "鞋類",
  "包包",
  "配件",
] as const;

export type WardrobeDiagnosticSeverity = "error" | "warning";

export interface WardrobeDiagnostic {
  code: string;
  message: string;
  severity: WardrobeDiagnosticSeverity;
  line?: number;
}

export interface WardrobeItem {
  style: string;
  quantity: number;
  attributes: Record<string, string>;
  line: number;
}

export interface WardrobeCategory {
  name: string;
  items: WardrobeItem[];
}

export interface WardrobeOutfit {
  text: string;
  referenced_styles: string[];
  line: number;
}

export interface ParsedWardrobeMarkdown {
  title: string;
  total_items: number;
  counted_items: number;
  categories: WardrobeCategory[];
  outfits: WardrobeOutfit[];
  notes: string[];
  diagnostics: WardrobeDiagnostic[];
}

export interface WardrobeParseResult {
  ok: boolean;
  document: ParsedWardrobeMarkdown;
  errors: WardrobeDiagnostic[];
  warnings: WardrobeDiagnostic[];
}

export interface WardrobeProposalValue {
  kind: "wardrobe";
  character_id: string;
  content: string;
}

function diagnostic(code: string, message: string, severity: WardrobeDiagnosticSeverity, line?: number): WardrobeDiagnostic {
  return { code, message, severity, ...(line === undefined ? {} : { line }) };
}

function normalizeLines(markdown: string): string[] {
  return markdown.replace(/\r\n?/gu, "\n").split("\n");
}

function trimCell(value: string): string {
  return value.trim().replace(/^`|`$/gu, "").trim();
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  const withoutLeading = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEdges = withoutLeading.endsWith("|") ? withoutLeading.slice(0, -1) : withoutLeading;
  return withoutEdges.split("|").map(trimCell);
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && tableCells(trimmed).length > 0;
}

function headerIndex(headers: readonly string[], patterns: readonly RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function parseQuantity(value: string): number | undefined {
  const match = value.match(/(?:^|\D)(\d+)(?:\D|$)/u);
  if (match === null) return undefined;
  const quantity = Number(match[1]);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : undefined;
}

function parseTotal(lines: readonly string[]): { value?: number; line?: number } {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/(?:總件數|衣櫃總數|total\s*items?)\s*[:：]\s*(\d+)/iu);
    if (match === null || match === undefined || match[1] === undefined) continue;
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0) return { value, line: index + 1 };
  }
  return {};
}

function headingValue(line: string, level: 1 | 2): string | undefined {
  const prefix = "#".repeat(level);
  const match = line.match(new RegExp(`^${prefix}\\s+(.+?)\\s*$`, "u"));
  return match?.[1]?.trim();
}

function isSummaryHeading(value: string): boolean {
  return /^(?:衣櫃概況|概況|summary|overview)$/iu.test(value.trim());
}

function isOutfitHeading(value: string): boolean {
  return /^(?:搭配組合|搭配|outfits?|combinations?)$/iu.test(value.trim());
}

function isNotesHeading(value: string): boolean {
  return /^(?:推導與備註|推導|備註|notes?|assumptions?)$/iu.test(value.trim());
}

function extractOutfitReferences(text: string): string[] {
  const match = text.match(/(?:使用|items?|衣物)\s*[:：]\s*([^|｜。；;]+)/iu);
  if (match === null || match[1] === undefined) return [];
  return match[1]
    .split(/[、,，/／]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseCategoryTable(
  lines: readonly string[],
  headingLine: number,
  category: string,
  diagnostics: WardrobeDiagnostic[],
): { category: WardrobeCategory; nextLine: number } {
  let cursor = headingLine + 1;
  while (cursor < lines.length && lines[cursor]?.trim() === "") cursor += 1;
  if (!isTableRow(lines[cursor] ?? "") || !isTableSeparator(lines[cursor + 1] ?? "")) {
    diagnostics.push(diagnostic("WARDROBE_CATEGORY_TABLE_REQUIRED", `衣服種類「${category}」需要 Markdown table。`, "error", headingLine + 1));
    return { category: { name: category, items: [] }, nextLine: cursor };
  }

  const headers = tableCells(lines[cursor] ?? "");
  const styleIndex = headerIndex(headers, [/^款式$/iu, /^品項$/iu, /^名稱$/iu, /^style$/iu, /^item$/iu, /^name$/iu]);
  const colorIndex = headerIndex(headers, [/^顏色(?:\/材質)?$/iu, /^色彩$/iu, /^color(?:\/material)?$/iu]);
  const quantityIndex = headerIndex(headers, [/^數量$/iu, /^件數$/iu, /^quantity$/iu, /^count$/iu]);
  if (styleIndex < 0) diagnostics.push(diagnostic("WARDROBE_STYLE_COLUMN_REQUIRED", `衣服種類「${category}」缺少款式欄位。`, "error", cursor + 1));
  if (quantityIndex < 0) diagnostics.push(diagnostic("WARDROBE_QUANTITY_COLUMN_REQUIRED", `衣服種類「${category}」缺少數量欄位。`, "error", cursor + 1));

  const items: WardrobeItem[] = [];
  cursor += 2;
  while (cursor < lines.length && isTableRow(lines[cursor] ?? "")) {
    const rowLine = cursor + 1;
    const cells = tableCells(lines[cursor] ?? "");
    if (styleIndex >= 0 && quantityIndex >= 0) {
      const style = cells[styleIndex] ?? "";
      const quantityText = cells[quantityIndex] ?? "";
      const quantity = parseQuantity(quantityText);
      if (style.length === 0) diagnostics.push(diagnostic("WARDROBE_STYLE_REQUIRED", `衣服種類「${category}」有空白款式。`, "error", rowLine));
      if (quantity === undefined) diagnostics.push(diagnostic("WARDROBE_QUANTITY_INVALID", `衣服種類「${category}」的「${style || "未命名款式"}」數量無效。`, "error", rowLine));
      if (style.length > 0 && quantity !== undefined) {
        const attributes: Record<string, string> = {};
        headers.forEach((header, index) => {
          if (index === styleIndex || index === quantityIndex) return;
          const value = cells[index]?.trim() ?? "";
          if (header.length > 0 && value.length > 0) attributes[header] = value;
        });
        items.push({ style, quantity, attributes, line: rowLine });
      }
    }
    cursor += 1;
  }
  if (items.length === 0) diagnostics.push(diagnostic("WARDROBE_ITEMS_REQUIRED", `衣服種類「${category}」至少要有一項衣物。`, "error", headingLine + 1));
  const variants = new Set<string>();
  for (const item of items) {
    const color = colorIndex >= 0 ? item.attributes[headers[colorIndex] ?? ""] ?? "" : "";
    const variantKey = `${item.style}\u0000${color}`;
    if (variants.has(variantKey)) diagnostics.push(diagnostic("WARDROBE_STYLE_DUPLICATE", `衣服種類「${category}」的款式／色款「${item.style}${color.length === 0 ? "" : `（${color}）`}」重複列出；只有完全相同的色款才可合併數量。`, "warning", item.line));
    variants.add(variantKey);
  }
  return { category: { name: category, items }, nextLine: cursor };
}

export function parseWardrobeMarkdown(markdown: string): WardrobeParseResult {
  const lines = normalizeLines(markdown);
  const diagnostics: WardrobeDiagnostic[] = [];
  const title = lines.map((line) => headingValue(line, 1)).find((value): value is string => value !== undefined) ?? "";
  if (title.length === 0) diagnostics.push(diagnostic("WARDROBE_TITLE_REQUIRED", "衣櫃 Markdown 需要一個一級標題。", "error", 1));

  const total = parseTotal(lines);
  if (total.value === undefined) diagnostics.push(diagnostic("WARDROBE_TOTAL_REQUIRED", "衣櫃概況需要標示「總件數」。", "error"));

  const categories: WardrobeCategory[] = [];
  const outfits: WardrobeOutfit[] = [];
  const notes: string[] = [];
  let section: "summary" | "outfits" | "notes" | "category" | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = headingValue(line, 2);
    if (heading !== undefined) {
      if (isSummaryHeading(heading)) section = "summary";
      else if (isOutfitHeading(heading)) section = "outfits";
      else if (isNotesHeading(heading)) section = "notes";
      else {
        const parsed = parseCategoryTable(lines, index, heading, diagnostics);
        categories.push(parsed.category);
        section = "category";
        index = Math.max(index, parsed.nextLine - 1);
      }
      continue;
    }
    if (section === "outfits") {
      const match = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/u);
      if (match !== null && match[1] !== undefined) outfits.push({ text: match[1], referenced_styles: extractOutfitReferences(match[1]), line: index + 1 });
    } else if (section === "notes" && line.trim().length > 0) {
      notes.push(line.trim().replace(/^[-*]\s+/u, ""));
    }
  }

  if (categories.length === 0) diagnostics.push(diagnostic("WARDROBE_INVENTORY_REQUIRED", "衣櫃至少需要一個衣服種類與清單。", "error"));
  const countedItems = categories.flatMap((category) => category.items).reduce((sum, item) => sum + item.quantity, 0);
  if (total.value !== undefined && countedItems !== total.value) {
    diagnostics.push(diagnostic("WARDROBE_TOTAL_MISMATCH", `衣櫃總件數標示為 ${total.value}，但清單加總為 ${countedItems}。`, "error", total.line));
  }
  const availableStyles = new Set(categories.flatMap((category) => category.items.map((item) => item.style)));
  for (const outfit of outfits) {
    const missing = outfit.referenced_styles.filter((style) => !availableStyles.has(style));
    if (missing.length > 0) diagnostics.push(diagnostic("WARDROBE_OUTFIT_REFERENCE_MISSING", `搭配引用不存在的款式：${missing.join("、")}。`, "error", outfit.line));
  }

  const document: ParsedWardrobeMarkdown = {
    title,
    total_items: total.value ?? countedItems,
    counted_items: countedItems,
    categories,
    outfits,
    notes,
    diagnostics,
  };
  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    document,
    errors: diagnostics.filter((item) => item.severity === "error"),
    warnings: diagnostics.filter((item) => item.severity === "warning"),
  };
}

export const wardrobeProposalValueSchema = z
  .object({
    kind: z.literal("wardrobe"),
    character_id: wardrobeCharacterIdSchema,
    content: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const result = parseWardrobeMarkdown(value.content);
    for (const error of result.errors) {
      context.addIssue({ code: "custom", path: ["content"], message: error.message });
    }
  });

export type WardrobeProposal = z.infer<typeof wardrobeProposalValueSchema>;
