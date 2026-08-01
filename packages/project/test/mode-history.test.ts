import { mkdir } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { describe, expect, it } from "vitest";

import { prepareModeHistoryArchive } from "../src/index.js";

const report = {
  schema_version: 1 as const,
  conversion_id: "conversion-1",
  character_id: "alice",
  source_mode: "zhuji" as const,
  target_mode: "palette" as const,
  source_revisions: {},
  target_revisions: {},
  mappings: [],
  provenance: [],
  expected_semantic_loss: [],
};

describe("mode history archive", () => {
  it("rejects an empty source mode directory", async () => {
    const workspace = await makeTemporaryWorkspace();
    try {
      const projectRoot = path.join(workspace.root, "project");
      await mkdir(path.join(projectRoot, "characters", "alice", "zhuji"), { recursive: true });
      await expect(prepareModeHistoryArchive({
        projectRoot,
        characterId: "alice",
        conversionId: "conversion-1",
        sourceMode: "zhuji",
        report,
      })).rejects.toMatchObject({ code: "MODE_HISTORY_SOURCE_EMPTY" });
    } finally {
      await workspace.cleanup();
    }
  });
});
