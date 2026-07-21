import {
  allowedCssAtRules,
  allowedCssFunctions,
  allowedCssProperties,
  assertRootSelector,
  rootSelectorForComponent,
} from "./policy-v1.js";

interface CssRule {
  readonly selector: string;
  readonly declarations: Readonly<Record<string, string>>;
}

function assertDeclaration(property: string, value: string): void {
  if (!allowedCssProperties.has(property)) throw new Error(`CSS property 不在 html-policy@1 allowlist: ${property}`);
  if (/[{};]/u.test(value) || /@import|url\s*\(|expression\s*\(/iu.test(value)) {
    throw new Error(`CSS value 含有禁止語法: ${property}`);
  }
  for (const functionName of value.matchAll(/([a-z-]+)\s*\(/giu)) {
    const name = functionName[1]?.toLowerCase();
    if (name && !allowedCssFunctions.has(name)) throw new Error(`CSS function 不在 html-policy@1 allowlist: ${name}`);
  }
}

function renderRule(rootSelector: string, rule: CssRule): string {
  const selector = rule.selector ? `${rootSelector}${rule.selector}` : rootSelector;
  if (!selector.startsWith(rootSelector)) throw new Error("CSS selector 未被 root scope 限制");
  const declarations = Object.entries(rule.declarations).map(([property, value]) => {
    assertDeclaration(property, value);
    return `${property}:${value}`;
  }).join(";");
  return `${selector}{${declarations}}`;
}

export function generateScopedComponentCss(componentId: string): string {
  const rootSelector = rootSelectorForComponent(componentId);
  assertRootSelector(rootSelector);
  const rules: CssRule[] = [
    {
      selector: "",
      declarations: {
        "box-sizing": "border-box",
        display: "block",
        "max-width": "100%",
        "font-family": "system-ui,sans-serif",
        "line-height": "1.4",
      },
    },
    {
      selector: ":focus-visible",
      declarations: { outline: "2px solid currentColor", "outline-offset": "2px" },
    },
  ];
  const base = rules.map((rule) => renderRule(rootSelector, rule)).join("");
  const responsive = `@media (max-width:640px){${renderRule(rootSelector, {
    selector: "",
    declarations: { "font-size": "0.95rem" },
  })}}`;
  const reducedMotion = `@media (prefers-reduced-motion:reduce){${renderRule(rootSelector, {
    selector: "",
    declarations: { transition: "none", "scroll-behavior": "auto" },
  })}}`;
  for (const atRule of ["media"]) {
    if (!allowedCssAtRules.has(atRule)) throw new Error(`CSS at-rule 不在 html-policy@1 allowlist: ${atRule}`);
  }
  return `${base}${responsive}${reducedMotion}`;
}

export function generateScopedCss(components: readonly string[]): string {
  return components.map((componentId) => generateScopedComponentCss(componentId)).join("");
}
