# BUG-28 修復設計（V3.11）

- 日期：2026-08-10
- 範圍：packages/core/src/index.ts、packages/core/src/blob-store.ts（新）、packages/core/test/file-repository.test.ts、packages/domain/src/build.ts、packages/domain/test/build-import.test.ts
- Commit：`V3.11: 修復 BUG-28(DS)`
- 邊界：不改 packages/adapters-png/**、packages/compiler/**、packages/domain/src/conversion.ts、packages/domain/test/conversion.test.ts、packages/core/src/templates.ts、packages/core/test/templates.test.ts（BUG-29/30 Agent 範圍）；保留 compiler 的 CompileResult.png: Buffer 合約。

## 背景

每次 build 把完整 card JSON 放進 BuildRecord.canonical_ir；publish 又保存 JSON 與 PNG base64，之後整份 state 寫進 .workspace/workflow.json 與 state.json。長期反覆打包會多重複製大 payload，每次 commit 重寫越來越大的 state。

## 設計原則

- 大型 payload（compiled JSON、PNG bytes）以 content-addressed immutable blob 保存，state 只留 `{hash, size}` 引用。
- 向後相容：舊欄位（canonical_ir/content/png_base64）保留 optional，舊資料仍可讀；新資料不再寫入。
- PNG 生成方式與 compiler 合約完全不動；只改變「編譯輸出如何保存」。

## 實作

### blob-store.ts（新檔案，packages/core/src/blob-store.ts）

```ts
export interface BlobStore {
  put(hash: string, content: Uint8Array): Promise<void>;
  get(hash: string): Promise<Uint8Array | undefined>;
  has(hash: string): Promise<boolean>;
}
```

- `MemoryBlobStore`：Map<string, Uint8Array>。
- `FileBlobStore`：以 directory 建構，檔名 = hash（content-addressed）；get 時 ENOENT → undefined。

### core/src/index.ts

- `ProjectRepository` interface 加 `readBlob(hash): Promise<Uint8Array | undefined>`、`writeBlob(hash, content): Promise<void>`。
- `MemoryProjectRepository`：建構時建立 MemoryBlobStore（或注入），readBlob/writeBlob 委派。
- `FileProjectRepository`：`.workspace/blobs/` 目錄 FileBlobStore；writeBlob 直接寫（blob immutable，不進交易；缺檔由 build 重產）。
- `BuildRecord`：`canonical_ir?: string` ＋ `canonical_ir_ref?: { hash: string; size: number }`。
- `PublishRecord`：`content?: string`、`png_base64?: string` ＋ `content_ref?: { hash: string; size: number }`、`png_ref?: { hash: string; size: number }`。
- zod schema 同步（buildSchema/publishSchema 的 content 改 optional、新增 ref 欄位）。
- `materializedFiles(state)`：latestPublish.content 為 undefined（新資料）時 skip export_json_path 寫入；png_base64 同理。

### build.ts（packages/domain/src/build.ts）

- build 產生 ref：`jsonRef = { hash: compiled.content_hash, size: byteLength(json) }`、`pngRef = { hash: contentHash(compiled.png), size: compiled.png.byteLength }`；`await repository.writeBlob(...)` 兩次（PNG hash 用 contentHash(png) 使 PNG blob 也 content-addressed）。
- BuildRecord：`canonical_ir_ref: jsonRef`（不寫 canonical_ir）。
- PublishRecord：`content_ref: jsonRef`、`png_ref: pngRef`（不寫 content/png_base64）。
- writeSet（exports 輸出檔）照舊寫出——輸出檔仍是交付物，只是不再複製進 state。

## 測試策略

- build-import.test.ts 146/286/345 行改為 `await repository.readBlob(build.canonical_ir_ref.hash)` 讀回 JSON 再斷言，或斷言 ref.hash === content_hash。
- 新增：publish 後 state.builds[0] 無 canonical_ir（未膨脹）、blob 可由 readBlob 讀回且與 exports 檔內容一致、PNG blob 存在且 bytes 等於 compileProject 輸出。
- file-repository.test.ts：workflow.json/state.json 不含大 payload；blob 目錄檔案存在。

## 驗證

`pnpm build` + `pnpm typecheck` + `pnpm vitest run` + `pnpm agent:lint` 全綠後 commit。
