import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, type OperationRecord } from "@st-workspace/core";
import { AuthoringService } from "../src/index.js";

function operation(id: string): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind: "authoring", request: "create wardrobe", status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

const content = `# Demo 的衣櫃

## 衣櫃概況
- 總件數：2

## 上衣
| 款式 | 顏色／材質 | 數量 |
| --- | --- | ---: |
| 白色 T 恤 | 棉質 | 2 |

## 搭配組合
1. 使用：白色 T 恤｜日常

## 推導與備註
- 依日常替換需求推導。
`;

describe("wardrobe authoring", () => {
  it("keeps high-level wardrobe requests on the formal proposal path", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-wardrobe-request")] }));
    const result = await new AuthoringService(repository).create("op-wardrobe-request", "建立衣櫃", "director");
    expect(result.status).toBe("needs_input");
    expect(result.summary).toContain("完整清單");
    expect((await repository.read()).artifacts).toHaveLength(0);
  });

  it("lets a high-level request skip or defer wardrobe without creating a placeholder", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-wardrobe-skip")] }));
    const result = await new AuthoringService(repository).create("op-wardrobe-skip", "先不要建立衣櫃，之後再做", "director");
    expect(result.status).toBe("completed");
    expect(result.summary).toContain("跳過或延後");
    expect((await repository.read()).artifacts).toHaveLength(0);
  });

  it("stores Markdown as a formal cross-mode artifact and creates a successor on change", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-wardrobe-1")] }));
    const service = new AuthoringService(repository);
    const first = await service.createTemplate("op-wardrobe-1", { kind: "wardrobe", character_id: "demo", content }, "wardrobe-creator");
    expect(first.status).toBe("completed");
    const firstState = await repository.read();
    expect(firstState.artifacts[0]).toMatchObject({ kind: "wardrobe", name: "demo/wardrobe", media_type: "text/markdown", content });

    await repository.commit(firstState.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-wardrobe-2")] }));
    const changed = content.replaceAll("白色 T 恤", "藍色 T 恤");
    const second = await service.createTemplate("op-wardrobe-2", { kind: "wardrobe", character_id: "demo", content: changed }, "wardrobe-creator");
    expect(second.status).toBe("completed");
    const finalState = await repository.read();
    expect(finalState.artifacts).toHaveLength(2);
    expect(finalState.artifacts.at(-1)).toMatchObject({ kind: "wardrobe", based_on: firstState.artifacts[0]?.revision, content: changed });
  });
});
