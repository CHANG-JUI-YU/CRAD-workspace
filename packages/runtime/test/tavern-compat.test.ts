import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { emitCharacterCardV3, type Ccv3Project } from "@st-workspace/adapters-ccv3";
import { writeCardToPng, pngSignature, encodePngChunk } from "@st-workspace/adapters-png";
import { WorkspaceRuntime } from "../src/index.js";

describe("Tavern compatibility verifier (BUG2-16)", () => {
  const sampleProject: Ccv3Project = {
    project_id: "demo-project",
    title: "測試角色",
    name: "測試角色",
    description: "測試角色描述",
    personality: "冷靜",
    scenario: "場景",
    first_mes: "你好",
    alternate_greetings: ["哈囉"],
    group_only_greetings: [],
    lore_entries: [],
    extensions: {
      "card-workspace": {
        plugins: {
          "plugin.test-1": { version: "1.0.0" },
        },
      },
    },
  };

  it("reports match for valid JSON and matching PNG", async () => {
    const repository = new MemoryProjectRepository("compat-match");
    const card = emitCharacterCardV3(sampleProject);
    const jsonStr = JSON.stringify(card);
    const png = writeCardToPng(undefined, card);

    await repository.commit(0, (state) => ({
      ...state,
      publishes: [
        {
          id: "pub-1",
          operation_id: "op-pub-1",
          artifact_ids: [],
          content_hash: "0".repeat(64),
          export_json_path: "exports/card.json",
          content: jsonStr,
          png_base64: png.toString("base64"),
          created_at: new Date().toISOString(),
        },
      ],
    }));

    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.tavernCompat();
    expect(result.available).toBe(true);
    expect(result.report).toContain("PNG 內嵌卡片與 JSON 內容一致。");
    expect(result.report.some((line) => line.includes("plugin.test-1"))).toBe(true);
  });

  it("reports mismatch when card data differs", async () => {
    const repository = new MemoryProjectRepository("compat-mismatch");
    const card1 = emitCharacterCardV3(sampleProject);
    const card2 = emitCharacterCardV3({ ...sampleProject, description: "修改後的不同描述" });
    const jsonStr = JSON.stringify(card1);
    const png = writeCardToPng(undefined, card2);

    await repository.commit(0, (state) => ({
      ...state,
      publishes: [
        {
          id: "pub-2",
          operation_id: "op-pub-2",
          artifact_ids: [],
          content_hash: "0".repeat(64),
          export_json_path: "exports/card.json",
          content: jsonStr,
          png_base64: png.toString("base64"),
          created_at: new Date().toISOString(),
        },
      ],
    }));

    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.tavernCompat();
    expect(result.available).toBe(true);
    expect(result.report.some((line) => line.includes("不一致"))).toBe(true);
  });

  it("does not classify real 512x768 user images as built-in placeholders", async () => {
    const repository = new MemoryProjectRepository("compat-real-image");
    const card = emitCharacterCardV3(sampleProject);

    // Create a real 512x768 PNG image (with blue pixels instead of solid 0xd8d8d8)
    const width = 512;
    const height = 768;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const scanline = Buffer.alloc(1 + width * 4);
    scanline[0] = 0;
    for (let offset = 1; offset < scanline.length; offset += 4) {
      scanline[offset] = 0x10;
      scanline[offset + 1] = 0x20;
      scanline[offset + 2] = 0x80;
      scanline[offset + 3] = 0xff;
    }
    const imageData = Buffer.alloc(scanline.length * height);
    for (let row = 0; row < height; row += 1) scanline.copy(imageData, row * scanline.length);
    const customBasePng = Buffer.concat([
      pngSignature,
      encodePngChunk("IHDR", ihdr),
      encodePngChunk("IDAT", (await import("node:zlib")).deflateSync(imageData)),
      encodePngChunk("IEND", Buffer.alloc(0)),
    ]);
    const customPng = writeCardToPng(customBasePng, card);

    await repository.commit(0, (state) => ({
      ...state,
      publishes: [
        {
          id: "pub-3",
          operation_id: "op-pub-3",
          artifact_ids: [],
          content_hash: "0".repeat(64),
          export_json_path: "exports/card.json",
          content: JSON.stringify(card),
          png_base64: customPng.toString("base64"),
          created_at: new Date().toISOString(),
        },
      ],
    }));

    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.tavernCompat();
    expect(result.available).toBe(true);
    expect(result.report).toContain("PNG 尺寸 512×768px（已嵌入角色圖像）。");
    expect(result.report).not.toContain("使用內建佔位圖");
  });

  it("produces clear diagnostics for schema-invalid JSON", async () => {
    const repository = new MemoryProjectRepository("compat-invalid-json");
    const invalidJson = JSON.stringify({ spec: "invalid_spec", data: {} });
    const card = emitCharacterCardV3(sampleProject);
    const png = writeCardToPng(undefined, card);

    await repository.commit(0, (state) => ({
      ...state,
      publishes: [
        {
          id: "pub-4",
          operation_id: "op-pub-4",
          artifact_ids: [],
          content_hash: "0".repeat(64),
          export_json_path: "exports/card.json",
          content: invalidJson,
          png_base64: png.toString("base64"),
          created_at: new Date().toISOString(),
        },
      ],
    }));

    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.tavernCompat();
    expect(result.available).toBe(true);
    expect(result.report.some((line) => line.includes("內容 JSON Schema 驗證失敗"))).toBe(true);
    expect(result.report).toContain("JSON Schema 不符，無法比對 PNG 內嵌卡片。");
  });
});
