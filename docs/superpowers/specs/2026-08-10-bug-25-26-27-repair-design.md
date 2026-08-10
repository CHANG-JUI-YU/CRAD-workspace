# BUG-25/26/27 修復設計（V3.10）

- 日期：2026-08-10
- 範圍：packages/plugins、packages/domain（import.ts）、packages/runtime（project-manager.ts）、packages/core（FileProjectRepository migration）、packages/adapters-ccv3（PluginHelperScript.data）
- Commit：`V3.10: 修復 BUG-25/26/27(DS)`

## 背景

稽核文件指出三類不一致：(1) plugin compiler 只產出受控 manifest，無可執行 runtime；(2) ImportService 只讀第一個 attachment 且只當 UTF-8 JSON 解析，與訪談宣稱的 PNG/JSON/YAML 審核能力不符；(3) ProjectManager 的 rename 與 legacy migration 可留下 state 與檔案系統不一致。

## 設計原則

- plugin runtime 以純函式字串（`new Function` 可載入）產出，不引入任意執行環境，仍維持受控白名單。
- import 採「偵測→解析→轉內部 Character schema」單一管線，PNG/YAML/JSON 統一收斂成 character proposal；原始 binary 以 base64 保存。
- project 操作維持「檔案系統變更先於 state 宣稱」，list 操作保持唯讀。

## BUG-25：plugin compiler 產生可執行 runtime

- adapters-ccv3 `PluginHelperScript.data` 型別 `Record<string, never>` → `Record<string, unknown>`；plugins `helper()` 加 `data` 參數。
- MVU：新增 `mvuRuntimeSource(variables)` 產生 `{init, update, run}` 函式字串（defaults 初始化、registry 白名單＋writable＋kind 型別檢查的 update、path 讀取的 run）；`compileMvu` 的 generated/helper/metadata 附 `runtime`。
- EJS：新增 `ejsEvaluatorSource()` 產生 condition evaluator（literal 相等；path 走 context 取值＋operator switch）；`compileEjs` helper/metadata 附 `{ runtime: { evaluateCondition } }`。
- HTML：`renderHtmlComponent` 的 binding_paths 去重後合併為單一 `data-cw-bind` attribute（空格分隔）；`compileHtml` 新增 `injectionSlots`（greeting_selector→greeting、status_bar→status_bar、message_presentation→message_presentation，mode append）進 metadata 與 helper。

## BUG-26：ImportService 格式一致性

- core：`ImportRecord` interface＋`importSchema` 加 `original_binary?`、`attachments?`。
- domain import.ts 全文重寫：
  - `ImportServiceOptions { pngDecoder? }`；runtime 注入 `readCardFromPng`（runtime/package.json 加 adapters-png 依賴）。
  - 管線：magic bytes 判 PNG（pngDecoder 解析 → `png-ccv3`/`png-chara`，binary 存 base64）→ 非 PNG fatal UTF-8 → yamlLike（media type/副檔名/內容特徵）走自家最小 YAML 解析器（`parseYamlDocument`：縮排遞迴、list、註解、`---`）→ 否則 JSON.parse。
  - `toCharacterProposal`：data.name 納入 artifactName 優先序；personality/scenario/system-prompt/message-examples → sections；`extensions["card-workspace"].import_source` 保存原 payload；輸出 `characterProposalValueSchema`（內部 Character schema）。
  - 迴圈所有 attachments；失敗附件寫 failed record（不再吞掉）；dry-run 行為保留；summary 含成功/失敗計數。
- 未知欄位仍列 report（knownFields 保留）。

## BUG-27：project rename 與 legacy migration 一致性

- `finalizeIfNamed`：先 `relocate(target)` 成功後再 commit 改 id（revision 不變仍有效）；relocate 失敗時 state 未動。
- `select`：repository 改用 `path.basename(selected.path)`（folder basename），不用 state.project_id。
- `listProjects`：改唯讀——直接 readFile＋JSON.parse 讀摘要（.workspace/state.json 優先、fallback legacy state.json），不建 repository（零 reconcile 寫入）；損壞 state 檔以 `{project_id: folder, status: "uninitialized", path}` 列出（不再靜默隱藏）。
- `migrateLegacyLayoutIfNeeded`：exports 目錄改逐檔搬移＋keep 集合（最新 publish 的 export_json/png basename 保留，同 `archiveExistingLegacyLayout` 邏輯），避免把剛寫出的最新輸出搬進 legacy archive。

## 測試策略

- plugins/test/generators.test.ts：MVU runtime 字串可執行（init/update/run 行為）、EJS evaluator 行為、HTML 單一 data-cw-bind＋去重、injection_slots。
- domain/test（新增 import 測試檔或擴充既有）：YAML 匯入、data.name 命名、PNG 注入 decoder、多附件部分失敗、binary 保存（original_binary）、failed record。
- runtime/test/project-manager.test.ts：broken 資料夾列出、select 用 basename、finalize 失敗時 state 未宣稱新 id（可用 relocate 失敗模擬）、listProjects 零寫入。
- core migration 測試（既有 layout 測試）：migrate 後 exports 保留最新輸出。

## 驗證

`pnpm build` + `pnpm typecheck` + `pnpm vitest run` + `pnpm agent:lint` 全綠後 commit。
