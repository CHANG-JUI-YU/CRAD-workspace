import {
  htmlSourceSchema,
  type HtmlSource,
} from "@card-workspace/schemas";

import type { MvuPathBinding, MvuPathRegistry } from "../mvu/paths.js";
import { rootSelectorForComponent } from "./policy-v1.js";

export interface HtmlValidationContext {
  readonly source: HtmlSource;
  readonly mvuPathRegistry?: MvuPathRegistry;
  readonly greetingIds?: readonly string[];
  readonly bindingsByComponent: ReadonlyMap<string, readonly MvuPathBinding[]>;
}

function bindingForPath(registry: MvuPathRegistry | undefined, path: string): MvuPathBinding {
  const binding = registry?.paths[path];
  if (!binding) throw new Error(`HTML binding path 未在 MVU registry 宣告: ${path}`);
  return binding;
}

export function validateHtmlSource(
  source: HtmlSource,
  context: { readonly mvuPathRegistry?: MvuPathRegistry; readonly greetingIds?: readonly string[] } = {},
): HtmlValidationContext {
  const parsed = htmlSourceSchema.parse(source);
  if (new Set(parsed.features).size !== parsed.features.length) {
    throw new Error("HTML feature 不可重複");
  }
  const selectors = new Set<string>();
  const bindingsByComponent = new Map<string, readonly MvuPathBinding[]>();
  for (const component of parsed.components) {
    const selector = rootSelectorForComponent(component.id);
    if (selectors.has(selector)) throw new Error(`HTML root selector collision: ${selector}`);
    selectors.add(selector);
    if ((component.feature === "status_bar" || component.binding_paths.length > 0) && !context.mvuPathRegistry) {
      throw new Error(`HTML component ${component.id} 需要 MVU path registry`);
    }
    const bindings = component.binding_paths.map((path) => bindingForPath(context.mvuPathRegistry, path));
    bindingsByComponent.set(component.id, bindings);
  }
  for (const feature of parsed.features) {
    if (!parsed.components.some((component) => component.feature === feature)) {
      throw new Error(`HTML feature 沒有對應 component: ${feature}`);
    }
  }
  if (parsed.features.includes("greeting_selector") && context.greetingIds === undefined) {
    throw new Error("HTML greeting selector 需要已核准的 greeting IDs");
  }
  return {
    source: parsed,
    ...(context.mvuPathRegistry ? { mvuPathRegistry: context.mvuPathRegistry } : {}),
    ...(context.greetingIds ? { greetingIds: context.greetingIds } : {}),
    bindingsByComponent,
  };
}
