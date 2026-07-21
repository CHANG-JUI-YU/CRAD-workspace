import type { HtmlSource } from "@card-workspace/schemas";

import { safeHtmlText } from "../../canonical.js";
import { generateScopedComponentCss } from "./css-scope.js";
import { componentDomId, rootSelectorForComponent } from "./policy-v1.js";
import { reparseGeneratedCss, reparseGeneratedMarkup } from "./sanitize.js";

export interface RenderedHtmlComponent {
  readonly id: string;
  readonly feature: HtmlSource["components"][number]["feature"];
  readonly markup: string;
  readonly css: string;
  readonly root_selector: string;
}

export function renderHtmlComponent(component: HtmlSource["components"][number]): RenderedHtmlComponent {
  const domId = componentDomId(component.id);
  const rootSelector = rootSelectorForComponent(component.id);
  const className = `cw-component cw-feature-${component.feature.replaceAll("_", "-")}`;
  const bindingAttributes = component.binding_paths
    .map((path, index) => ` data-cw-bind-${index}="${safeHtmlText(path)}"`)
    .join("");
  const text = component.text.map((node) => safeHtmlText(node.value)).join("");
  const markup = ["input", "br"].includes(component.tag)
    ? `<${component.tag} id="${safeHtmlText(domId)}" class="${className}" role="region" aria-label="${safeHtmlText(component.label)}" data-cw-feature="${component.feature}"${bindingAttributes}>`
    : `<${component.tag} id="${safeHtmlText(domId)}" class="${className}" role="region" aria-label="${safeHtmlText(component.label)}" data-cw-feature="${component.feature}"${bindingAttributes}>${text}</${component.tag}>`;
  const css = generateScopedComponentCss(component.id);
  reparseGeneratedMarkup(markup, domId);
  reparseGeneratedCss(css, rootSelector);
  return { id: component.id, feature: component.feature, markup, css, root_selector: rootSelector };
}
