import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalJson, computeRevision } from "../src/index.js";

describe("canonical serialization", () => {
  it("不同物件鍵順序得到相同 revision", () => {
    expect(computeRevision({ b: 2, a: 1 })).toBe(computeRevision({ a: 1, b: 2 }));
  });

  it("對任意 JSON 值重複執行皆穩定", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalJson(value);
        const twice = canonicalJson(JSON.parse(once) as unknown);
        expect(twice).toBe(once);
      }),
    );
  });
});
