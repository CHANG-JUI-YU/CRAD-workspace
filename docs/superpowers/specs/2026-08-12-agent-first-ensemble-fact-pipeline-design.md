# Agent-first 多角色來源改編事實管線設計

日期：2026-08-12  
範圍：10+ 名角色的來源研究、事實整理、事實審查與發布前創作準備

## 1. 目標

讓具備聯網能力的 Agent 能為 10 名以上角色建立可追溯、可審查、可供角色與世界設定創作使用的事實資料。新專案不得再把網頁 HTML、導覽模板、URL subject 或重複來源大量轉成候選事實。

本設計只處理發布前資料與創作可靠性。CCv3 卡片的 `description`、`personality`、`scenario` 依既定產品決策保持空白；角色資訊仍放在綁定世界書，`first_mes` 仍放在角色卡。

## 2. 採用方案

採用 **Agent-first typed facts + deterministic preprocessing**：

- Runtime 負責安全擷取、正文清理、去重、分段、實體約束與驗證。
- Fact Curator Agent 負責理解文字並提交 typed `fact_curation` claims。
- Fact Reviewer 只裁決有完整來源上下文的固定候選集合。
- 句子級自動抽取不得作為 `source_adaptation` 的正式事實來源。

不採用以下方案：

- 清理後繼續大量句子自動抽取：仍會產生語意錯置與低品質候選。
- 新增 Runtime Search Provider：使用者目前已有聯網 Agent，新增 provider 只會增加基礎設施與設定負擔。

## 3. 資料入口

### 3.1 多角色名單

`parseCharacterRoster` 只切割最外層的換行、頓號、逗號、分號或 `|`。括號、引號內的分隔符不得切開角色；別名必須保留並正規化至同一角色。

### 3.2 網頁正文

HTTP fetch 保留原始內容 hash，但 `SourceRecord.canonical_text` 必須是依 media type 正規化後的正文：

- HTML 移除 script、style、navigation、footer、模板與隱藏內容。
- 保留頁面標題、章節標題、段落順序與可定位文字範圍。
- 無法取得可用正文時回傳 recoverable source diagnostic，不建立知識 chunks。
- 純文字來源維持 UTF-8 與既有二進位比例檢查。

### 3.3 去重與執行冪等

來源以 canonical URL、最終 URL、內容 hash 與 source revision 去重。相同 operation 被同步路徑與 worker replay 同時看見時，最多只能建立一個 candidate/source 結果。防線必須同時存在於 operation claim 與 source commit，不能只依 audit marker。

## 4. 事實模型

正式 `FactRecord` 與 `fact_curation` claim 增加：

- `entity_refs: string[]`：Blueprint 中的穩定角色 ID，例如 `character-2`。
- `coverage`：只允許事實面向，例如 identity、personality、background、relationships、world_context、appearance。
- `subject`：可讀名稱，不再承擔穩定 ID；不得為 URL。

角色事實至少有一個有效 `entity_ref`；世界事實可以沒有角色 entity，但必須有 world coverage。Alias、顯示名稱與來源名稱只透過集中式 entity matcher 解析，authoring、fingerprint、workflow gate 共用同一語義。

不需要遷移已刪除的測試專案；schema 只需保留合理的舊 state 讀取相容性。

## 5. Agent-first 流程

`knowledge` 自然語言 request 對 `source_adaptation` 只準備乾淨 chunks 與工作摘要，不得呼叫句子級 `KnowledgeService.refresh` 建立正式 facts。Fact Curator 必須讀取分頁 chunks，提交 typed `fact_curation` proposal；Runtime 驗證 entity、coverage 與 evidence 後才建立候選。

若 Agent 只送自然語言而未提交 typed claims，operation 應回傳 `needs_input` 與明確下一步，不得用自動抽取假裝完成。

來源研究完成後，系統列出每個 roster entity 的來源覆蓋狀態。缺乏來源的角色保持可見 diagnostic；在開始正式創作前，必須補足來源或由使用者明確豁免。

## 6. Fact Review

Fact Review context 不再附加全部 unresolved facts。每次只提供固定 review-run snapshot 的一頁，候選包含：

- source title、URL、revision；
- section heading；
- 完整所在段落與前後必要上下文；
- evidence span、chunk ID、candidate occurrence ID；
- subject、entity refs、classification、coverage。

多 reviewer 必須取得不重疊的內部分片；分片與 lease 不暴露成使用者參數。候選已被其他 reviewer 裁決時應安全收斂，不產生誤導性的成功摘要。

## 7. 接受品質與 Gate

接受事實前必須拒絕：

- URL subject、HTML/CSS/JavaScript 或模板文字；
- `described_by` 等 fallback predicate；
- 不存在於 Blueprint 的 entity refs；
- coverage 缺失、混入角色名稱或不符合 classification；
- evidence revision 不符、無可定位段落或 subject 與上下文明顯不符。

發布前 authoring gate 檢查每個必要角色的 accepted fact coverage；使用者明確豁免需保存 audit 記錄。Authoring context 只收到與目標角色相關的 accepted facts，不收到全部 unresolved 候選。

## 8. 測試與驗收

必須涵蓋：

1. 12 個角色且括號內含逗號與別名，輸出仍為 12 個穩定角色。
2. 真實形狀的 Wikipedia／一般官網 HTML fixture，不產生標籤、CSS、script、導航 facts。
3. 同 URL 同 revision 的同步執行與 worker replay，只建立一份 source。
4. natural knowledge request 不建立句子 facts；typed curation 才建立候選。
5. entity refs 與 coverage 分離，alias 可解析至正確 character ID。
6. review context 有標題與段落上下文，且大小受分頁限制。
7. URL subject、HTML、fallback predicate、錯誤 entity/coverage 無法被接受。
8. 12 角色、至少 120 個有效候選的來源改編流程可完成 Fact Review，並讓角色、世界、關係與開場白 authoring 取得正確 accepted facts。
9. 既有 original-character 與無來源專案流程維持可用。

驗證依序執行 targeted tests、`pnpm typecheck`、`pnpm test`；最後確認 `git diff --check` 與乾淨的預期工作樹。

## 9. Audit 4 邊界

- BUG4-04／BUG4-05 應使用本設計的集中式 entity matcher 與 coverage 語義完成，避免二次重構。
- BUG4-02 與產品需求衝突，從待修清單移除；不得把角色資訊重新寫回 CCv3 `description/personality/scenario`。
- BUG4-01、BUG4-07～10 在本批完成後依 Audit 4 的單線順序處理。

## 10. 實作批次

1. roster parser、HTML 正文正規化、source 去重與 operation 冪等。
2. Fact schema、entity matcher、Agent-first curation route 與嚴格品質驗證。
3. 分頁 review context、reviewer 分片、authoring/gate 整合。
4. 12-role／120-fact 發布前整合驗收。

每批由單一 Luna Max 代理在 `main` 上完成一個獨立 commit；不得 merge、rebase、push，也不得加入使用者未追蹤檔案。
