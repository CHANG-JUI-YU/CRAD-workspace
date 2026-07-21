import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initializeProject } from "@card-workspace/project";
import { projectManifestSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";

export const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

export async function setupMcpWorkspace(
  id = "mcp-demo",
  entryKind: "original" | "source_adaptation" | "card_import" | "mode_conversion" = "original",
  collaborationMode: "free" | "assisted" = "free",
  options: { secondCharacter?: boolean; relationships?: boolean } = {},
) {
  const workspace = await makeTemporaryWorkspace();
  await cp(path.join(repositoryRoot, "workflow"), path.join(workspace.root, "workflow"), { recursive: true });
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id,
      title: "MCP test",
      kind: "character_card",
      card: { name: "MCP" },
      characters: [
        { id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" },
        ...(options.secondCharacter ? [{ id: "beth", display_name: "Beth", mode: "palette" as const, role: "supporting" as const }] : []),
      ],
    }),
    entryKind,
    collaborationMode,
    ...(options.relationships ? { relationships: { enabled: true as const, character_ids: ["alice", "beth"] } } : {}),
  });
  return { workspace, projectRoot, environment: {
    CARD_WORKSPACE_ROOT: workspace.root,
    CARD_WORKSPACE_AGENT_ID: "director",
  } };
}
