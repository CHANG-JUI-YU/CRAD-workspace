import { parseFragment } from "parse5";
import * as cssTree from "css-tree";

import {
  allowedCssAtRules,
  allowedCssFunctions,
  allowedCssProperties,
  assertAllowedHtmlAttribute,
  assertAllowedHtmlElement,
  assertRootSelector,
} from "./policy-v1.js";

interface ParsedAttribute {
  readonly name: string;
  readonly value: string;
}

interface ParsedNode {
  readonly nodeName?: string;
  readonly tagName?: string;
  readonly attrs?: readonly ParsedAttribute[];
  readonly childNodes?: readonly ParsedNode[];
}

interface ParsedFragment extends ParsedNode {
  readonly childNodes: readonly ParsedNode[];
}

function visitNode(node: ParsedNode): void {
  const name = node.tagName ?? node.nodeName ?? "";
  if (name === "#text") return;
  if (name.startsWith("#")) throw new Error(`HTML node 不在 html-policy@1 allowlist: ${name}`);
  assertAllowedHtmlElement(name);
  const seen = new Set<string>();
  for (const attribute of node.attrs ?? []) {
    const normalized = attribute.name.toLowerCase();
    if (seen.has(normalized)) throw new Error(`HTML duplicate attribute: ${normalized}`);
    seen.add(normalized);
    assertAllowedHtmlAttribute(normalized);
    if (/^(?:javascript|data|vbscript):/iu.test(attribute.value)) {
      throw new Error("HTML attribute URL scheme 不被允許");
    }
  }
  for (const child of node.childNodes ?? []) visitNode(child);
}

export function reparseGeneratedMarkup(markup: string, expectedDomId: string): string {
  if (/<(?:script|style|svg|math|iframe|form|object|embed|template)\b/iu.test(markup)) {
    throw new Error("HTML generated markup 含有禁止元素");
  }
  const parseErrors: string[] = [];
  const fragment = parseFragment(markup, {
    onParseError: (error) => parseErrors.push(error.code),
  }) as unknown as ParsedFragment;
  if (parseErrors.length > 0) throw new Error(`HTML generated markup parse error: ${parseErrors[0]}`);
  const elements = fragment.childNodes.filter((node) => node.tagName !== undefined);
  if (elements.length !== 1) throw new Error("HTML generated markup 必須只有一個 root element");
  visitNode(elements[0]!);
  const rootId = elements[0]!.attrs?.find((attribute) => attribute.name === "id")?.value;
  if (rootId !== expectedDomId) throw new Error(`HTML root id 不符合預期: ${rootId ?? "missing"}`);
  return markup;
}

export function reparseGeneratedCss(css: string, rootSelector: string): string {
  if (css.includes("\\") || /\/\*/u.test(css)) throw new Error("HTML generated CSS 不允許 escape 或 comment");
  assertRootSelector(rootSelector);
  const ast = cssTree.parse(css, { context: "stylesheet" });
  cssTree.walk(ast, (node) => {
    const candidate = node as unknown as {
      readonly type?: string;
      readonly name?: string;
      readonly property?: string;
      readonly prelude?: unknown;
    };
    switch (candidate.type) {
      case "Atrule": {
        const name = candidate.name?.toLowerCase() ?? "";
        if (!allowedCssAtRules.has(name)) throw new Error(`CSS at-rule 不在 html-policy@1 allowlist: ${name}`);
        const prelude = candidate.prelude === undefined ? "" : cssTree.generate(candidate.prelude as Parameters<typeof cssTree.generate>[0]);
        if (/url\s*\(|expression\s*\(|javascript:|[<>]/iu.test(prelude)) {
          throw new Error("HTML generated CSS at-rule 含有禁止語法");
        }
        break;
      }
      case "Declaration": {
        const property = candidate.property?.toLowerCase() ?? "";
        if (!allowedCssProperties.has(property)) throw new Error(`CSS property 不在 html-policy@1 allowlist: ${property}`);
        break;
      }
      case "Function": {
        const name = candidate.name?.toLowerCase() ?? "";
        if (!allowedCssFunctions.has(name)) throw new Error(`CSS function 不在 html-policy@1 allowlist: ${name}`);
        break;
      }
      case "Url":
        throw new Error("HTML generated CSS 不允許 URL");
      case "Raw":
        throw new Error("HTML generated CSS 不允許未解析語法");
      case "Selector": {
        const selector = cssTree.generate(node).trim();
        const scoped = selector === rootSelector
          || selector.startsWith(`${rootSelector}:`)
          || selector.startsWith(`${rootSelector}.`)
          || selector.startsWith(`${rootSelector}[`)
          || selector.startsWith(`${rootSelector} `)
          || selector.startsWith(`${rootSelector}>`)
          || selector.startsWith(`${rootSelector}+`)
          || selector.startsWith(`${rootSelector}~`);
        if (!scoped) throw new Error("HTML CSS selector 未被 root scope 限制");
        break;
      }
      default:
        break;
    }
  });
  return css;
}
