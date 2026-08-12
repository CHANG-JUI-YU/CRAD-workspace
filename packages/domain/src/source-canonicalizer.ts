import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { CoreError } from "@st-workspace/core";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;

export interface CanonicalSource {
  text: string;
  mediaType: string;
}

const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const PLAIN_MEDIA_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
]);

const EXCLUDED_TAGS = new Set([
  "applet",
  "audio",
  "button",
  "canvas",
  "dialog",
  "embed",
  "form",
  "footer",
  "iframe",
  "input",
  "menu",
  "meta",
  "nav",
  "noscript",
  "object",
  "option",
  "script",
  "select",
  "style",
  "template",
  "textarea",
  "video",
]);

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "caption",
  "dd",
  "details",
  "div",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
  "ol",
]);

const JUNK_MARKERS = /(?:^|[-_\s])(advert(?:isement)?|breadcrumb|cookie(?:-|\s)?consent|metadata|navigation|navbar|sidebar|social|share|related|recommend(?:ation)?|toc|table[-_\s]?of[-_\s]?contents)(?:$|[-_\s])/iu;

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function isTextNode(node: Node): node is TextNode {
  return node.nodeName === "#text";
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

function normalizedAttributeText(element: Element): string {
  return [attr(element, "id"), attr(element, "class")].filter((value): value is string => value !== undefined).join(" ").trim();
}

function isExcludedElement(element: Element): boolean {
  const tag = element.tagName.toLocaleLowerCase();
  if (EXCLUDED_TAGS.has(tag)) return true;
  if (attr(element, "hidden") !== undefined || attr(element, "aria-hidden")?.toLocaleLowerCase() === "true") return true;
  const style = attr(element, "style") ?? "";
  if (/(?:^|[;\s])(?:display|visibility|content-visibility)\s*:\s*(?:none|hidden)/iu.test(style)) return true;
  return JUNK_MARKERS.test(normalizedAttributeText(element));
}

function normalizedText(value: string): string {
  return value.replace(/[\uFEFF\u200B]/gu, "").replace(/\s+/gu, " ").replace(/\s+([,.;:!?，。；：！？])/gu, "$1").trim();
}

function addLine(lines: string[], value: string): void {
  const line = normalizedText(value);
  if (line.length === 0 || lines.at(-1) === line) return;
  lines.push(line);
}

function flush(buffer: string[], lines: string[]): void {
  if (buffer.length === 0) return;
  addLine(lines, buffer.join(" "));
  buffer.length = 0;
}

function walkVisibleText(node: Node, buffer: string[], lines: string[]): void {
  if (isTextNode(node)) {
    buffer.push(node.value);
    return;
  }
  if (!isElement(node)) {
    if ("childNodes" in node) for (const child of node.childNodes) walkVisibleText(child, buffer, lines);
    return;
  }
  if (isExcludedElement(node)) return;
  const tag = node.tagName.toLocaleLowerCase();
  const isBlock = BLOCK_TAGS.has(tag) || tag === "br";
  if (isBlock) flush(buffer, lines);
  for (const child of node.childNodes) walkVisibleText(child, buffer, lines);
  if (isBlock) flush(buffer, lines);
}

function findFirstElement(node: Node, tagName: string): Element | undefined {
  if (isElement(node) && node.tagName.toLocaleLowerCase() === tagName) return node;
  if (!("childNodes" in node)) return undefined;
  for (const child of node.childNodes) {
    const found = findFirstElement(child, tagName);
    if (found !== undefined) return found;
  }
  return undefined;
}

function textContent(node: Node): string {
  if (isTextNode(node)) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join(" ");
}

function canonicalizeHtml(text: string): string {
  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(text);
  } catch (error) {
    throw new CoreError("SOURCE_HTML_PARSE_FAILED", error instanceof Error ? error.message : String(error), true);
  }

  const lines: string[] = [];
  const title = findFirstElement(document, "title");
  if (title !== undefined && !isExcludedElement(title)) addLine(lines, textContent(title));
  const body = findFirstElement(document, "body");
  const bodyLines: string[] = [];
  const bodyBuffer: string[] = [];
  walkVisibleText(body ?? document, bodyBuffer, bodyLines);
  flush(bodyBuffer, bodyLines);
  for (const line of bodyLines) addLine(lines, line);
  if (bodyLines.length === 0) {
    throw new CoreError("SOURCE_EMPTY", "The HTML source has no usable visible body text", true);
  }
  return lines.join("\n");
}

function normalizeMediaType(mediaType: string | undefined): string | undefined {
  const normalized = mediaType?.split(";", 1)[0]?.trim().toLocaleLowerCase();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/iu.test(text);
}

function mediaTypeFor(text: string, mediaType: string | undefined): string {
  const normalized = normalizeMediaType(mediaType);
  if (normalized !== undefined) return normalized;
  return looksLikeHtml(text) ? "text/html" : "text/plain";
}

function decodeText(content: Uint8Array): string {
  let nulCount = 0;
  for (const byte of content) if (byte === 0) nulCount += 1;
  if (content.length > 0 && nulCount * 100 > content.length) {
    throw new CoreError("SOURCE_BINARY_UNSUPPORTED", "The source content contains binary bytes", true);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new CoreError("SOURCE_DECODE_FAILED", "The source content is not valid UTF-8", true);
  }
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) throw new CoreError("SOURCE_EMPTY", "The source content is empty", true);
  return normalized;
}

export function canonicalizeSource(content: Uint8Array, mediaType?: string): CanonicalSource {
  const decoded = decodeText(content);
  const normalizedMediaType = mediaTypeFor(decoded, mediaType);
  if (HTML_MEDIA_TYPES.has(normalizedMediaType)) return { text: canonicalizeHtml(decoded), mediaType: normalizedMediaType };
  if (!normalizedMediaType.startsWith("text/") && !PLAIN_MEDIA_TYPES.has(normalizedMediaType)) {
    throw new CoreError("SOURCE_MEDIA_TYPE_UNSUPPORTED", `Unsupported source media type: ${normalizedMediaType}`, true);
  }
  return { text: decoded, mediaType: normalizedMediaType };
}

/** Normalize URL identity without changing query semantics. Fragments are not source content. */
export function canonicalizeSourceUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function extractSourceUrl(request: string): string | undefined {
  const match = /https?:\/\/[^\s<>"']+/iu.exec(request);
  if (match === null) return undefined;
  let value = match[0];
  while (value.length > 0 && /[),.;!?，。；！？]$/u.test(value) && canonicalizeSourceUrl(value) === undefined) value = value.slice(0, -1);
  return canonicalizeSourceUrl(value) ?? value;
}
