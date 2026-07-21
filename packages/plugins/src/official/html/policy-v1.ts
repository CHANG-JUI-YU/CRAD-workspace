export const htmlPolicyVersion = "html-policy@1" as const;

export const allowedHtmlElements: ReadonlySet<string> = new Set([
  "div",
  "span",
  "p",
  "section",
  "header",
  "footer",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "button",
  "label",
  "input",
  "select",
  "option",
  "progress",
  "meter",
  "br",
  "strong",
  "em",
  "small",
]);

export const allowedHtmlAttributes: ReadonlySet<string> = new Set([
  "id",
  "class",
  "role",
  "tabindex",
  "name",
  "type",
  "value",
  "min",
  "max",
  "step",
  "checked",
  "disabled",
]);

export const allowedCssProperties: ReadonlySet<string> = new Set([
  "box-sizing",
  "display",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background",
  "background-color",
  "border",
  "border-radius",
  "padding",
  "margin",
  "max-width",
  "min-height",
  "gap",
  "outline",
  "outline-offset",
  "opacity",
  "transition",
  "scroll-behavior",
  "accent-color",
]);

export const allowedCssFunctions: ReadonlySet<string> = new Set(["calc", "min", "max", "clamp"]);
export const allowedCssAtRules: ReadonlySet<string> = new Set(["media"]);

export function isAllowedHtmlAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return allowedHtmlAttributes.has(normalized)
    || /^aria-[a-z0-9-]+$/u.test(normalized)
    || /^data-cw-[a-z0-9-]+$/u.test(normalized);
}

export function assertAllowedHtmlElement(name: string): void {
  if (!allowedHtmlElements.has(name.toLowerCase())) {
    throw new Error(`HTML element 不在 html-policy@1 allowlist: ${name}`);
  }
}

export function assertAllowedHtmlAttribute(name: string): void {
  if (!isAllowedHtmlAttribute(name)) {
    throw new Error(`HTML attribute 不在 html-policy@1 allowlist: ${name}`);
  }
}

export function componentDomId(componentId: string): string {
  return `cw-${componentId.replaceAll(".", "-")}`;
}

export function rootSelectorForComponent(componentId: string): string {
  return `#${componentDomId(componentId)}`;
}

export function assertRootSelector(selector: string): void {
  if (!/^#cw-[a-z0-9_-]+$/u.test(selector)) {
    throw new Error(`HTML root selector 不符合 html-policy@1: ${selector}`);
  }
}
