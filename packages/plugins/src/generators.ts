import {
  mvuSourceSchema,
  pluginSourceSchema,
  type MvuSource,
  type PluginContributions,
  type PluginSource,
} from "@card-workspace/schemas";

import { compileEjsSource } from "./official/ejs/index.js";
import { compileHtmlSource } from "./official/html/index.js";
import { compileMvuSource } from "./official/mvu/index.js";
import type { MvuPathRegistry } from "./official/mvu/paths.js";
import type { OfficialPluginImplementationRegistry } from "./registry.js";

export interface PluginGenerationContext {
  readonly greetingIds?: readonly string[];
  readonly mvuPathRegistry?: MvuPathRegistry;
  readonly implementationRegistry?: OfficialPluginImplementationRegistry;
}

function generateMvu(source: MvuSource): PluginContributions {
  return compileMvuSource(source).contributions;
}

export function generatePluginContributions(source: PluginSource, context: PluginGenerationContext = {}): PluginContributions {
  const parsed = pluginSourceSchema.parse(source);
  switch (parsed.plugin_id) {
    case "official.mvu-zod":
      return generateMvu(mvuSourceSchema.parse(parsed));
    case "official.ejs":
      return compileEjsSource(parsed, context.mvuPathRegistry).contributions;
    case "official.html":
      return compileHtmlSource(parsed, context).contributions;
  }
}
