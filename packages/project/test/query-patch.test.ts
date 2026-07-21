import { describe, expect, it } from "vitest";

import { applyJsonPatch, computeRevision, queryPointer } from "../src/index.js";

describe("queryPointer", () => {
  it("支援 RFC 6901 escape", () => {
    expect(queryPointer({ "a/b": { "~key": 3 } }, "/a~1b/~0key")).toBe(3);
  });

  it("找不到路徑時明確失敗", () => {
    expect(() => queryPointer({}, "/missing")).toThrow(/找不到/u);
  });

  it("支援根節點與陣列索引並拒絕無效 pointer", () => {
    const document = { items: ["zero", "one"] };
    expect(queryPointer(document, "")).toBe(document);
    expect(queryPointer(document, "/items/1")).toBe("one");
    expect(() => queryPointer(document, "items/0")).toThrow(/必須/u);
    expect(() => queryPointer(document, "/items/not-index")).toThrow(/陣列索引/u);
  });
});

describe("applyJsonPatch", () => {
  const document = { title: "before", nested: { keep: true } };

  it("套用 patch 且不修改原始物件", () => {
    const result = applyJsonPatch(document, [
      { op: "replace", path: "/title", value: "after" },
      { op: "add", path: "/nested/count", value: 1 },
    ], computeRevision(document));
    expect(result.value).toEqual({ title: "after", nested: { keep: true, count: 1 } });
    expect(document).toEqual({ title: "before", nested: { keep: true } });
    expect(result.differences).toHaveLength(2);
  });

  it("拒絕 prototype pollution 路徑", () => {
    expect(() =>
      applyJsonPatch(
        document,
        [{ op: "add", path: "/__proto__/polluted", value: true }],
        computeRevision(document),
      ),
    ).toThrow(/禁止/u);
  });

  it("拒絕 constructor 與 prototype 污染路徑", () => {
    for (const forbidden of ["constructor", "prototype"]) {
      expect(() =>
        applyJsonPatch(
          document,
          [{ op: "add", path: `/${forbidden}/polluted`, value: true }],
          computeRevision(document),
        ),
      ).toThrow(/禁止/u);
    }
  });

  it("expected revision 過期時拒絕修改", () => {
    expect(() =>
      applyJsonPatch(document, [{ op: "replace", path: "/title", value: "after" }], computeRevision({})),
    ).toThrow(/Revision 已變更/u);
  });
});
