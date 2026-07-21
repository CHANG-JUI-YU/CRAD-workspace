import {
  officialPluginImplementationRegistry,
  type PluginGenerationContext,
  generateActivePluginContributions,
} from "@card-workspace/plugins";
import type { PluginContributions, PluginSource } from "@card-workspace/schemas";

export interface CompileActivePluginsOptions extends PluginGenerationContext {
  readonly projectKind: "character_card" | "worldbook";
}

export function compileActivePlugins(
  sources: readonly PluginSource[] = [],
  options: CompileActivePluginsOptions = { projectKind: "character_card" },
): PluginContributions[] {
  if (sources.length === 0) return [];
  if (options.projectKind !== "character_card") {
    throw new Error("第一版 official authoring plugins 僅支援 character_card");
  }
  return generateActivePluginContributions(sources, {
    ...options,
    implementationRegistry: options.implementationRegistry ?? officialPluginImplementationRegistry,
  });
}
