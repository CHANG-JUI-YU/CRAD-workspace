import { describe, expect, it } from "vitest";
import {
  InMemoryAttachmentStore,
  decodeOperationCommand,
  type OperationCommand,
} from "../src/index.js";

describe("Audit 7 Batch 3 - Core Attachment Contract & Migration (#71)", () => {
  it("#71 BUG7-03: InMemoryAttachmentStore inspects availability of attachment refs", async () => {
    const store = new InMemoryAttachmentStore();
    const opId = "op-audit7-test";
    const savedRefs = await store.save(opId, [
      { name: "doc1.txt", content: new TextEncoder().encode("Hello 1"), media_type: "text/plain" },
    ]);

    expect(savedRefs).toHaveLength(1);
    const inspected = await store.inspect(opId, [
      savedRefs[0]!,
      { id: "missing-ref", name: "missing.txt" },
    ]);

    expect(inspected).toEqual([
      { id: savedRefs[0]!.id, name: "doc1.txt", media_type: "text/plain", available: true },
      { id: "missing-ref", name: "missing.txt", available: false },
    ]);
  });

  it("#71 BUG7-03: decodeOperationCommand migrates legacy payload attachment_refs to top-level command.attachment_refs", () => {
    const legacy = {
      version: 1,
      type: "coverage_supplement",
      payload: {
        assessment_id: "assess-1",
        assessment_revision: "rev-1",
        requirement_id: "req.identity",
        text: "Some evidence text",
        attachment_refs: [
          { id: "att-1", name: "file1.txt", media_type: "text/plain" },
        ],
      },
    };

    const decoded = decodeOperationCommand(legacy);
    expect(decoded.type).toBe("coverage_supplement");
    expect(decoded.attachment_refs).toEqual([
      { id: "att-1", name: "file1.txt", media_type: "text/plain" },
    ]);
    // The payload itself should have the attachment_refs removed after migration
    expect((decoded.payload as Record<string, unknown>).attachment_refs).toBeUndefined();
  });
});
