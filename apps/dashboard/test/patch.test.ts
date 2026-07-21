import { describe, expect, it } from "vitest";

import { buildPatch } from "../src/features/editor/patch";

describe("dashboard semantic patch", () => {
  it("creates stable nested operations", () => {
    expect(buildPatch(
      { title: "before", nested: { keep: true, remove: 1 }, list: [1] },
      { title: "after", nested: { keep: true, add: 2 }, list: [1, 2] },
    )).toEqual([
      { op: "replace", path: "/list", value: [1, 2] },
      { op: "remove", path: "/nested/remove" },
      { op: "add", path: "/nested/add", value: 2 },
      { op: "replace", path: "/title", value: "after" },
    ]);
  });

  it("escapes RFC 6901 keys and skips equal values", () => {
    expect(buildPatch({ "a/b": 1, "x~y": 2 }, { "a/b": 3, "x~y": 2 })).toEqual([
      { op: "replace", path: "/a~1b", value: 3 },
    ]);
    expect(buildPatch({ value: 1 }, { value: 1 })).toEqual([]);
  });
});
