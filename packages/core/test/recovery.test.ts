import { describe, expect, it } from "vitest";
import { CoreError, MemoryProjectRepository } from "../src/index.js";

describe("core recovery after a failed commit", () => {
  it("allows a later valid commit after a failed mutation", async () => {
    const repository = new MemoryProjectRepository("demo");
    await expect(repository.commit(0, () => {
      throw new CoreError("INJECTED_FAILURE", "simulated failure", true);
    })).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
    const result = await repository.commit(0, (state) => ({ ...state, candidates: [{ id: "candidate-1", title: "Recovered", status: "pending" }] }));
    expect(result.revision).toBe(1);
    expect(result.candidates[0]?.title).toBe("Recovered");
  });
});
