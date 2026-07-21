import {
  pluginContributionsSchema,
  type EjsSource,
  type PluginContributions,
  type Revision,
} from "@card-workspace/schemas";

import { revisionFor } from "../../canonical.js";
import type { MvuPathRegistry } from "../mvu/paths.js";
import { ejsMetadata, generateEjsLoreEntries } from "./generate-entries.js";
import { validateEjsSource } from "./validate.js";

export interface EjsCompilation {
  readonly source: EjsSource;
  readonly path_registry: MvuPathRegistry;
  readonly artifact_revision: Revision;
  readonly contributions: PluginContributions;
}

export function compileEjsSource(source: EjsSource, mvuPathRegistry: MvuPathRegistry | undefined): EjsCompilation {
  if (!mvuPathRegistry) throw new Error("EJS compile 需要 approved MVU path registry");
  const context = validateEjsSource(source, mvuPathRegistry);
  const loreEntries = generateEjsLoreEntries(context);
  const resolvedSourceHash = revisionFor({ source: context.source, path_registry: context.mvuPathRegistry, lore_entries: loreEntries });
  const artifactRevision = revisionFor({
    canonical_source_revision: revisionFor(context.source),
    resolved_source_hash: resolvedSourceHash,
    implementation: context.source.implementation,
  });
  const contributions = pluginContributionsSchema.parse({
    schema_version: 1,
    plugin_id: "official.ejs",
    implementation: context.source.implementation,
    artifact_revision: artifactRevision,
    lore_entries: loreEntries,
    regex_scripts: [],
    helper_scripts: [],
    greeting_operations: [],
    metadata: {
      source_schema_version: context.source.schema_version,
      project_kind: context.source.project_kind,
      resolved_source_hash: resolvedSourceHash,
      ...ejsMetadata(context),
    },
  });
  return { source: context.source, path_registry: context.mvuPathRegistry, artifact_revision: artifactRevision, contributions };
}

export { validateEjsSource };
export type { EjsValidationContext } from "./validate.js";
