import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, computeRevision } from "@card-workspace/project";

import { appendWorkflowEvent, commitWorkflowMutation, projectWorkflowEvents, rebuildWorkflowProjection, verifyWorkflowJournal, verifyWorkflowProjection } from "../src/index.js";
import { makeState } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function initialize(root: string, emptyJournal = false) {
  const journal = emptyJournal ? verifyWorkflowJournal("") : appendWorkflowEvent(verifyWorkflowJournal(""), { id: "initial-state", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z", state: makeState() });
  const state = emptyJournal ? makeState() : projectWorkflowEvents(journal.events);
  await mkdir(path.join(root, ".workflow"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "workflow.json"), canonicalJson(state)),
    writeFile(path.join(root, ".workflow", "journal.jsonl"), journal.rawText),
  ]);
  return state;
}

describe("workflow repository and recovery", () => {
  it("journal 與 projection 在同一 transaction 更新並做 workflow CAS", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const initial = await initialize(workspace.root);
    const next = await commitWorkflowMutation(workspace.root, {
      expectedRevision: 0,
      eventId: "advance-source",
      actor: "engine",
      occurredAt: "2026-07-14T00:00:01.000Z",
      update: (state) => ({ ...state, revision: 1, stage: "source_processing" }),
    });
    expect(next).toMatchObject({ revision: 1, stage: "source_processing" });
    expect(verifyWorkflowProjection(await readFile(path.join(workspace.root, "workflow.json"), "utf8"), await readFile(path.join(workspace.root, ".workflow", "journal.jsonl"), "utf8"))).toEqual(next);
    await expect(commitWorkflowMutation(workspace.root, { expectedRevision: initial.revision, eventId: "stale", actor: "engine", occurredAt: "2026-07-14T00:00:02.000Z", update: (state) => ({ ...state, revision: state.revision + 1 }) })).rejects.toMatchObject({ code: "WORKFLOW_REVISION_CONFLICT" });
    await expect(commitWorkflowMutation(workspace.root, { expectedRevision: 0, eventId: "advance-source", actor: "engine", occurredAt: "2027-01-01T00:00:00.000Z", update: (state) => ({ ...state, revision: 1, stage: "source_processing" }) })).resolves.toEqual(next);
    await expect(commitWorkflowMutation(workspace.root, { expectedRevision: 0, eventId: "advance-source", actor: "engine", occurredAt: "2027-01-01T00:00:00.000Z", update: (state) => ({ ...state, revision: 1, stage: "blueprint" }) })).rejects.toMatchObject({ code: "WORKFLOW_EVENT_ID_CONFLICT" });
  });

  it("相容 Task 3 的空 journal 與 migration baseline", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await initialize(workspace.root, true);
    await expect(commitWorkflowMutation(workspace.root, { expectedRevision: 0, eventId: "first-change", actor: "engine", occurredAt: "2026-07-14T00:00:01.000Z", update: (state) => ({ ...state, revision: 1, stage: "source_processing" }) })).resolves.toMatchObject({ revision: 1 });

    const payload = { from_schema_version: 1, to_schema_version: 2 };
    const semantic = { sequence: 1, kind: "workflow_migrated", actor: "project-migration", payload };
    const migration = { schema_version: 1, id: "migration-a", ...semantic, payload_hash: computeRevision(payload), occurred_at: "2026-07-14T00:00:00.000Z" };
    const rawJournal = `${JSON.stringify(migration)}\n`;
    const migrated = makeState({ journal_revision: computeRevision(semantic) });
    expect(verifyWorkflowProjection(canonicalJson(migrated), rawJournal)).toEqual(migrated);
  });

  it("可由 intact journal deterministic rebuild；失敗不改 projection", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const initial = await initialize(workspace.root);
    const projectionPath = path.join(workspace.root, "workflow.json");
    const journalPath = path.join(workspace.root, ".workflow", "journal.jsonl");
    const rawJournal = await readFile(journalPath, "utf8");
    await writeFile(projectionPath, canonicalJson({ ...initial, stage: "blueprint" }));
    const stale = await readFile(projectionPath, "utf8");
    await rebuildWorkflowProjection({ root: workspace.root, rawProjection: stale, rawJournal });
    expect(JSON.parse(await readFile(projectionPath, "utf8"))).toEqual(initial);
    const current = await readFile(projectionPath, "utf8");
    await expect(rebuildWorkflowProjection({ root: workspace.root, rawProjection: current, rawJournal: rawJournal.slice(0, -5) })).rejects.toThrow();
    expect(await readFile(projectionPath, "utf8")).toBe(current);
  });
});
