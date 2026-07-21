import { describe, expect, it } from "vitest";

import { appendWorkflowEvent, computeWorkflowEventRevision, projectWorkflowEvents, verifyWorkflowJournal } from "../src/index.js";
import { makeState } from "./helpers.js";

describe("workflow logical journal", () => {
  it("建立 sequence、prior revision、payload hash，timestamp 不影響語意 revision", () => {
    const first = appendWorkflowEvent(verifyWorkflowJournal(""), { id: "event-a", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z", state: makeState() });
    const second = appendWorkflowEvent(first, { id: "event-b", actor: "engine", occurredAt: "2026-07-14T01:00:00.000Z", state: makeState({ revision: 1, stage: "source_processing" }) });
    expect(second.events[1]?.sequence).toBe(2);
    expect(second.events[1]?.prior_revision).toBe(computeWorkflowEventRevision(first.events[0]!));
    const changedTime = { ...first.events[0]!, occurred_at: "2027-01-01T00:00:00.000Z" };
    expect(computeWorkflowEventRevision(changedTime)).toBe(computeWorkflowEventRevision(first.events[0]!));
    expect(projectWorkflowEvents(second.events)).toMatchObject({ revision: 1, stage: "source_processing", journal_revision: second.revision });
  });

  it("duplicate retry idempotent，同 ID 不同 payload 拒絕", () => {
    const first = appendWorkflowEvent(verifyWorkflowJournal(""), { id: "event-a", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z", state: makeState() });
    expect(appendWorkflowEvent(first, { id: "event-a", actor: "engine", occurredAt: "2027-01-01T00:00:00.000Z", state: makeState() })).toBe(first);
    expect(() => appendWorkflowEvent(first, { id: "event-a", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z", state: makeState({ stage: "blueprint" }) })).toThrow(/不同 payload/u);
  });

  it("truncation、reordering 與 hash corruption fail closed", () => {
    const first = appendWorkflowEvent(verifyWorkflowJournal(""), { id: "event-a", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z", state: makeState() });
    const second = appendWorkflowEvent(first, { id: "event-b", actor: "engine", occurredAt: "2026-07-14T00:00:01.000Z", state: makeState({ revision: 1 }) });
    expect(() => verifyWorkflowJournal(second.rawText.slice(0, -10))).toThrow(/完整 JSON/u);
    expect(() => verifyWorkflowJournal(second.rawText.split("\n").filter(Boolean).reverse().join("\n") + "\n")).toThrow(/sequence/u);
    expect(() => verifyWorkflowJournal(first.rawText.replace(/sha256:[a-f0-9]{64}/u, `sha256:${"f".repeat(64)}`))).toThrow(/hash/u);
  });
});
