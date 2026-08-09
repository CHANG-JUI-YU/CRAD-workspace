import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWardrobeMarkdown } from "../src/index.js";

describe("wardrobe Markdown parser", () => {
  it("accepts the documented comprehensive wardrobe fixture", () => {
    const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/wardrobe-sample.md");
    const result = parseWardrobeMarkdown(readFileSync(fixture, "utf8"));
    expect(result.ok).toBe(true);
    expect(result.document.total_items).toBe(200);
    expect(result.document.counted_items).toBe(200);
    expect(result.document.categories.map((category) => category.name)).toEqual(expect.arrayContaining(["內衣", "內褲", "襪類", "睡衣", "家居服", "運動服", "泳裝", "鞋類", "包包", "配件"]));
    for (const category of result.document.categories) {
      for (const item of category.items) {
        expect(Object.keys(item.attributes)).toEqual(expect.arrayContaining(["顏色", "材質", "主要場合", "狀態", "備註"]));
      }
    }
  });

  it("allows merged style rows while checking a large inventory total", () => {
    const content = `# Large wardrobe

## 衣櫃概況
- 總件數：200

## 上衣
| 款式 | 顏色／材質 | 數量 |
| --- | --- | ---: |
| Basic tee | cotton | 12 |

## 外套
| 款式 | 顏色／材質 | 數量 |
| --- | --- | ---: |
| Seasonal coat | wool | 188 |
`;
    const result = parseWardrobeMarkdown(content);
    expect(result.ok).toBe(true);
    expect(result.document.total_items).toBe(200);
    expect(result.document.counted_items).toBe(200);
    expect(result.document.categories[0]?.items[0]?.quantity).toBe(12);
  });

  it("reports malformed tables, total mismatches and missing outfit references", () => {
    const content = `# Broken wardrobe

## 衣櫃概況
- 總件數：2

## 內衣
| 款式 | 顏色／材質 | 數量 |
| --- | --- | ---: |
| Daily | neutral | 1 |

## 搭配組合
1. 使用：Missing style
`;
    const result = parseWardrobeMarkdown(content);
    expect(result.ok).toBe(false);
    expect(result.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["WARDROBE_TOTAL_MISMATCH", "WARDROBE_OUTFIT_REFERENCE_MISSING"]));
  });

  it("warns when a duplicate style could be merged", () => {
    const content = `# Duplicate wardrobe

## 衣櫃概況
- 總件數：2

## 上衣
| 款式 | 顏色 | 數量 |
| --- | --- | ---: |
| Tee | 黑 | 1 |
| Tee | 黑 | 1 |
`;
    const result = parseWardrobeMarkdown(content);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((item) => item.code === "WARDROBE_STYLE_DUPLICATE")).toBe(true);
  });

  it("treats the same cut in different colors as separate variants", () => {
    const content = `# Color variants

## 衣櫃概況
- 總件數：2

## 上衣
| 款式 | 顏色 | 數量 |
| --- | --- | ---: |
| Tee | 黑 | 1 |
| Tee | 白 | 1 |
`;
    const result = parseWardrobeMarkdown(content);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((item) => item.code === "WARDROBE_STYLE_DUPLICATE")).toBe(false);
  });
});
