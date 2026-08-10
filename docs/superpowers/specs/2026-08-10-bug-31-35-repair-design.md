# BUG-31~35 修復設計（V3.12）

- 日期：2026-08-10
- 範圍：packages/runtime（index.ts、agent-registry.ts、agent-router.ts）、packages/server/src/index.ts、packages/domain/src（authoring.ts、review.ts、import.ts、knowledge.ts、index.ts）、tools/agent-lint.ts、各測試檔
- Commit：`V3.12: 修復 BUG-31/32/33/34/35(DS)`

## BUG-31：pending operation 續接範圍過窄

現況：request() 只續接 source（1894-1897）與 build mode question（1898-1922）；不匹配的輸入會回 needs_input 吞掉新命令。

設計：
- 新增 `resumePendingIfAnswered(pending, trimmed, context, kind)`：回傳 RequestResult 或 undefined（不續接）。
  - source：維持現條件（attachments > 0 或 重試/retry/上傳/貼上/URL 關鍵字）。
  - build mode pending：`parseBuildModeSelection` 匹配 → build.run；`/不需要|先不要|不用了|skip|defer|之後再|後續/iu` → pending 標 completed（commit operation completed）回傳 completed；`kind === "unknown"`（回答性輸入）→ 維持 needs_input（現行為，測試 557 保護）；其餘（明確新意圖）→ undefined fallthrough 新命令。
  - `kind === "unknown"` 時依 pending.kind 續接：knowledge → refresh(pending.id, ...)；authoring → create(pending.id, ...)；review → review/reevaluate；import → attachments>0 時 importer.run。
- 效果：新命令（classifyIntent 明確）不再被 pending 攔截；各 kind 有續接路徑。

## BUG-32：server input/error 邊界

- body()：加 `MAX_REQUEST_BODY = 10 * 1024 * 1024`（content-length 檢查＋累計超限 → REQUEST_BODY_TOO_LARGE 400）；JSON.parse 包 try/catch → REQUEST_INVALID_JSON 400（recoverable true，code 符合既有 regex 白名單 REQUEST_）。
- attachmentsFrom：嚴格 base64（`/^[A-Za-z0-9+/]+={0,2}$/`＋`%4===0`）＋單附件上限；非法 → REQUEST_INVALID_BASE64 400。MCP workspace_request 也解析 attachments（消除 REST/MCP 不一致）。
- dispatch 統一：抽出每 tool 的執行函式（`run*`），REST 包 HTTP 400、MCP 包 jsonrpc error（HTTP 200 + code -32602 invalid params / -32603 internal），共用同一錯誤分類。
- CoreError→HTTP：保留 regex 白名單機制（新 code 已含 REQUEST_ 前綴）＋MCP 路徑不再用 HTTP status 表達 runtime 錯誤。
- auth：`startWorkspaceServer` 加 `authToken?: string`；指定時所有 /workspace/* 與 /mcp 要求 `authorization: Bearer <token>`，否則 401（code REQUEST_UNAUTHORIZED）；host 非 localhost 且無 authToken → throw（REQUIRE_AUTH_TOKEN_FOR_EXTERNAL_HOST）。

## BUG-33：agent 權限強制與單一來源

- read_only 強制：request() 執行 authoring/knowledge/build/import/review 前，若 resolution.agent 的 read_only === true → throw AGENT_READ_ONLY（recoverable true）。recoverOperation 同。
- classifyIntent 順序：import 檢查提前到 knowledge 之前（「Refresh imported cards」→ card-import-analyst）；其餘順序不變（build/authoring 對調風險高，維持）。
- agent-lint：新增 TS↔YAML 交叉比對——解析 agent-registry.ts 的 `id: "..."` 集合與 registry.yaml/aliases.yaml 的 id 集合，兩者必須相等（單一來源驗證）。

## BUG-34：artifact/review key 碰撞

- authoring.ts：character 的 key 改用 `document.id`（templateName 對 character 回 id；keyFor 維持 slug）。改名不再產生新 key。
- review key 改用 `target.id ?? target.name`（無 id 時退回 name）。
- review.ts pickTarget/applyProposal：target 比對加 `artifact.kind === targetKind` 過濾（不再命中 review 自己的 artifact）。
- import.ts：同 key 同 content_hash 的 artifact 重複 import → 跳過 append（BUG-35 一併處理）。
- 雙重表示部分（technical artifact 與正式 record）：範圍過大（compiler 禁改），本批不處理投影層，僅修 key 與 target 選擇。

## BUG-35：semantic CAS

統一改為「單次 read → 單次 commit(initial.revision)，callback 內重做 judgment」（applyReviewBatch 模式）：

- SourceService.execute：acquire 全部完成後單一 commit(initial.revision)——callback 內重查：approved+snapshot 篩選、allowedDomains（current 的 policy）、domain 檢查、pre-ingested 跳過、acquire 失敗標 blocked/failed、operation 狀態計算。REVISION_CONFLICT 自然整批失敗（不 catch 標 failed，消除 ingested→failed 損毀）。
- KnowledgeService.refresh：單次 commit(initial.revision)，callback 內重做 knownSourceIds/existingFactKeys 篩選（chunks/facts 純計算可放 callback）。
- AuthoringService create/createTemplate/createZhuji：單次 commit(initial.revision)，callback 內重做 previous dedup（讀 current.artifacts）。
- ImportService.run：callback 內檢查同 key 同 content_hash 已存在 → 跳過 artifact append。
- BuildService blob 孤兒：content-addressed 冪等，無害，不需處理（設計文件註明）。

## 測試策略

- runtime.test.ts：新命令不被 pending 攔截（build pending 時「建立角色」→ authoring 執行）、knowledge/authoring pending 續接、read_only agent 執行 authoring → AGENT_READ_ONLY。
- server.test.ts：超大 body → 400、malformed JSON → 400、非法 base64 → 400、authToken 401/200、MCP runtime 錯誤走 jsonrpc error。
- domain：source execute 併發 reject 不被 ingest（semantic CAS）、refresh 併發不重複 chunks、authoring 併發同 key 不重複、import 同卡重複不 append。
- 既有測試相容：557「我還沒決定」維持 needs_input；source/authoring/knowledge 單併發行為等效。
