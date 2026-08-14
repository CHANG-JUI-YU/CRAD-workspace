import { describe, expect, it } from "vitest";
import {
  canonicalProvenancePublishMatches,
  type CanonicalProvenancePublishPayload,
  type RequestResult,
} from "../src/index.js";

describe("Audit 7 Batch 6 - Core Canonical Command & Type Definitions", () => {
  it("matches identical canonical provenance_publish command", () => {
    const command = {
      version: 1,
      type: "provenance_publish",
      payload: {
        fingerprint: "fp-12345",
        mode_selection: "zhuji",
      },
    };
    const expected: CanonicalProvenancePublishPayload = {
      fingerprint: "fp-12345",
      mode_selection: "zhuji",
    };
    expect(canonicalProvenancePublishMatches(command, expected)).toBe(true);
  });

  it("matches canonical command when mode_selection is omitted on both sides", () => {
    const command = {
      version: 1,
      type: "provenance_publish",
      payload: {
        fingerprint: "fp-12345",
      },
    };
    const expected: CanonicalProvenancePublishPayload = {
      fingerprint: "fp-12345",
    };
    expect(canonicalProvenancePublishMatches(command, expected)).toBe(true);
  });

  it("rejects command when fingerprint differs", () => {
    const command = {
      version: 1,
      type: "provenance_publish",
      payload: {
        fingerprint: "fp-12345",
        mode_selection: "zhuji",
      },
    };
    const expected: CanonicalProvenancePublishPayload = {
      fingerprint: "fp-99999",
      mode_selection: "zhuji",
    };
    expect(canonicalProvenancePublishMatches(command, expected)).toBe(false);
  });

  it("rejects command when mode_selection differs", () => {
    const command = {
      version: 1,
      type: "provenance_publish",
      payload: {
        fingerprint: "fp-12345",
        mode_selection: "zhuji",
      },
    };
    const expected: CanonicalProvenancePublishPayload = {
      fingerprint: "fp-12345",
      mode_selection: "palette",
    };
    expect(canonicalProvenancePublishMatches(command, expected)).toBe(false);
  });

  it("rejects command when command is not provenance_publish", () => {
    const command = {
      version: 1,
      type: "template_proposal",
      payload: {
        fingerprint: "fp-12345",
      },
    };
    const expected: CanonicalProvenancePublishPayload = {
      fingerprint: "fp-12345",
    };
    expect(canonicalProvenancePublishMatches(command, expected)).toBe(false);
  });

  it("supports optional publish metadata and replay flag in RequestResult", () => {
    const result: RequestResult = {
      operation_id: "op-1",
      build_id: "build-1",
      publish_id: "publish-1",
      published_at: "2026-08-14T00:00:00.000Z",
      idempotent_replay: true,
      status: "completed",
      summary: "Published safely.",
      completed: ["build-1", "publish-1"],
      blocked: [],
    };
    expect(result.build_id).toBe("build-1");
    expect(result.publish_id).toBe("publish-1");
    expect(result.published_at).toBe("2026-08-14T00:00:00.000Z");
    expect(result.idempotent_replay).toBe(true);
  });
});
