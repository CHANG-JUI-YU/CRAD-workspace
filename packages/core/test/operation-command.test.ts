import { describe, expect, it } from "vitest";
import { decodeOperationCommand, operationCommandSchema, type OperationCommand } from "../src/index.js";

describe("versioned OperationCommand codec", () => {
  it("round-trips every supported command discriminant", () => {
    const commands: OperationCommand[] = [
      { version: 1, type: "request" },
      { version: 1, type: "import", attachment_refs: [{ id: "a1", name: "card.json" }] },
      { version: 1, type: "source_resume" },
      { version: 1, type: "source_search" },
      { version: 1, type: "source_select", payload: { decisions: [{ candidate_id: "c1", decision: "approve" }] } },
      { version: 1, type: "issue_update", payload: { issue_id: "i1", action: "resolve", reason: "fixed" } },
      { version: 1, type: "fact_review", payload: {} },
    ];
    for (const command of commands) {
      expect(operationCommandSchema.parse(JSON.parse(JSON.stringify(command)))).toEqual(command);
    }
  });

  it("migrates legacy missing version and source-select array payloads", () => {
    const command = decodeOperationCommand({
      type: "source_select",
      payload: [{ candidate_id: "c1", decision: "approved" }],
    });
    expect(command).toEqual({
      version: 1,
      type: "source_select",
      payload: { decisions: [{ candidate_id: "c1", decision: "approve" }] },
    });
  });

  it("normalizes the legacy source_selection alias", () => {
    const command = decodeOperationCommand({
      version: 1,
      type: "source_selection",
      payload: { decisions: [{ candidate_id: "c1", decision: "reject" }] },
    });
    expect(command.type).toBe("source_select");
  });

  it("returns a typed recoverable diagnostic for invalid payloads", () => {
    const command = decodeOperationCommand({ version: 1, type: "request", payload: { guessed: true } });
    expect(command.type).toBe("invalid");
    if (command.type === "invalid") {
      expect(command.payload.code).toBe("OPERATION_COMMAND_INVALID");
      expect(command.payload.recoverable).toBe(true);
    }
  });

  it("does not throw for non-object persisted command input", () => {
    const command = decodeOperationCommand(["not", "a", "command"]);
    expect(command.type).toBe("invalid");
  });
});
