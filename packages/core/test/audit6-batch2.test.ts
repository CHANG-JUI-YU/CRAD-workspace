import { describe, expect, it } from "vitest";
import { coverageSupplementCommandPayloadSchema, decodeOperationCommand } from "../src/operations.js";

describe("Audit 6 Batch 2 - Core Operations Schema", () => {
  it("#40: validates coverageSupplementCommandPayloadSchema with text-only", () => {
    const parsed = coverageSupplementCommandPayloadSchema.safeParse({
      assessment_id: "assess-1",
      assessment_revision: "rev-1",
      requirement_id: "req.identity",
      character_id: "char-1",
      text: "Text supplement",
    });
    expect(parsed.success).toBe(true);
  });

  it("#40: validates coverageSupplementCommandPayloadSchema with url-only", () => {
    const parsed = coverageSupplementCommandPayloadSchema.safeParse({
      assessment_id: "assess-1",
      assessment_revision: "rev-1",
      requirement_id: "req.identity",
      character_id: "char-1",
      url: "https://example.com/source",
    });
    expect(parsed.success).toBe(true);
  });

  it("#40: validates coverageSupplementCommandPayloadSchema with attachment_refs-only", () => {
    const parsed = coverageSupplementCommandPayloadSchema.safeParse({
      assessment_id: "assess-1",
      assessment_revision: "rev-1",
      requirement_id: "req.identity",
      character_id: "char-1",
      attachment_refs: [{ id: "att-1", name: "evidence.txt", media_type: "text/plain" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("#40: rejects coverage_supplement when no text, url, or attachment_refs provided", () => {
    const decoded = decodeOperationCommand({
      version: 1,
      type: "coverage_supplement",
      payload: {
        assessment_id: "assess-1",
        assessment_revision: "rev-1",
        requirement_id: "req.background_story",
        character_id: "char-1",
      },
    });
    expect(decoded.type).toBe("invalid");
  });
});
