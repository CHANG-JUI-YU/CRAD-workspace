import { describe, expect, it } from "vitest";
import { publishedCardExportPath, publishedCardPngExportPath, type ArtifactRecord } from "@st-workspace/core";

const zhuji = { kind: "zhuji" } as Pick<ArtifactRecord, "kind">;
const palette = { kind: "palette" } as Pick<ArtifactRecord, "kind">;
const character = { kind: "character" } as Pick<ArtifactRecord, "kind">;

describe("card export path naming", () => {
  it("applies the export name suffix from the selected mode rather than existing artifacts", () => {
    expect(publishedCardExportPath("Demo", "demo", [zhuji, palette], "zhuji")).toBe("exports/Demo-珠璣角色卡.json");
    expect(publishedCardExportPath("Demo", "demo", [zhuji, palette], "palette")).toBe("exports/Demo-調色盤角色卡.json");
    expect(publishedCardExportPath("Demo", "demo", [zhuji, palette], "both")).toBe("exports/Demo-雙模式角色卡.json");
    expect(publishedCardExportPath("Demo", "demo", [character], "zhuji")).toBe("exports/Demo-珠璣角色卡.json");
  });

  it("keeps the legacy fallback when no mode is provided", () => {
    expect(publishedCardExportPath("Demo", "demo", [zhuji])).toBe("exports/Demo-珠璣角色卡.json");
    expect(publishedCardExportPath("Demo", "demo", [character, palette])).toBe("exports/Demo-角色卡.json");
  });

  it("applies the same mode suffix to the PNG export path", () => {
    expect(publishedCardPngExportPath("Demo", "demo", [zhuji, palette], "palette")).toBe("exports/Demo-調色盤角色卡.png");
    expect(publishedCardPngExportPath("Demo", "demo", [zhuji, palette], "both")).toBe("exports/Demo-雙模式角色卡.png");
    expect(publishedCardPngExportPath("Demo", "demo", [character])).toBe("exports/Demo-角色卡.png");
  });
});
