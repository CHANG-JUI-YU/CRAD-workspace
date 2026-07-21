import { parsePngChunks, pngSignature, readCardMetadataFromPng, writeCardToPng } from "@card-workspace/adapters-png";
import { canonicalJson, canonicalYaml } from "@card-workspace/project";
import { describe, expect, it } from "vitest";

import { correctedCardV3, importCardSource, writeCorrectedCard } from "../src/index.js";

const legacy = {
  name: "Legacy",
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  first_mes: "Hello",
  mes_example: "Example",
  vendor_future: { retained: true },
};

function basePng(): Buffer {
  return Buffer.concat([
    pngSignature,
    Buffer.from([0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]),
    Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]),
  ]);
}

describe("corrected card copy", () => {
  it("normalizes V1 to canonical V3 without clearing semantic fields or unknown root fields", () => {
    const raw = Buffer.from(JSON.stringify(legacy), "utf8");
    const envelope = importCardSource(raw);
    const card = correctedCardV3(envelope);
    expect(card).toMatchObject({
      spec: "chara_card_v3",
      spec_version: "3.0",
      vendor_future: { retained: true },
      data: {
        description: "Description",
        personality: "Personality",
        scenario: "Scenario",
        mes_example: "Example",
      },
    });
    expect(writeCorrectedCard(raw, envelope, "json").toString("utf8")).toBe(canonicalJson(card));
    expect(writeCorrectedCard(raw, envelope, "yaml").toString("utf8")).toBe(canonicalYaml(card));
  });

  it("uses the PNG metadata writer and preserves non-card chunks", () => {
    const imported = importCardSource(Buffer.from(JSON.stringify(legacy), "utf8"));
    const source = writeCardToPng(basePng(), {
      ...imported.card,
      vendor_root: { retained: true },
      data: { ...imported.card.data, vendor_data: { retained: true } },
    });
    const output = writeCorrectedCard(source, importCardSource(source), "png");
    expect(readCardMetadataFromPng(output)).toMatchObject({
      authority: "ccv3",
      value: {
        vendor_root: { retained: true },
        data: { description: "Description", personality: "Personality", vendor_data: { retained: true } },
      },
    });
    expect(parsePngChunks(output).filter((chunk) => chunk.type === "IHDR")).toHaveLength(1);
  });

  it.each(["v2", "v3"] as const)("normalizes %s JSON and retains unknown root/data fields", (version) => {
    const v3 = {
      ...correctedCardV3(importCardSource(Buffer.from(JSON.stringify(legacy), "utf8"))),
      vendor_root: "root",
      data: {
        ...correctedCardV3(importCardSource(Buffer.from(JSON.stringify(legacy), "utf8"))).data,
        vendor_data: "data",
      },
    };
    const source = version === "v3" ? v3 : {
      ...v3,
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: Object.fromEntries(Object.entries(v3.data).filter(([key]) => key !== "group_only_greetings")),
    };
    const card = correctedCardV3(importCardSource(Buffer.from(JSON.stringify(source), "utf8")));
    expect(card).toMatchObject({
      spec: "chara_card_v3",
      spec_version: "3.0",
      vendor_root: "root",
      data: { vendor_data: "data", description: "Description" },
    });
  });
});
