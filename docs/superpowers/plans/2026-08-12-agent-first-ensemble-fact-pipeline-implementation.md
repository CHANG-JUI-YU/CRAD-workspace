# Agent-first 多角色事實管線實作計畫

依據：[2026-08-12-agent-first-ensemble-fact-pipeline-design.md](../specs/2026-08-12-agent-first-ensemble-fact-pipeline-design.md)

## 共通規則

- 直接在 `main` 工作；每批開始前確認前一批 commit 已存在。
- 不 merge、rebase、push、amend，不加入 `.tmp_fr_real.txt`。
- 不遷移或補建舊專案資料。
- 不改變既定匯出語義：`description/personality/scenario` 保持空白，`first_mes` 綁角色卡，其餘角色資訊在世界書。
- 每批先加 regression tests，再修改 production path；完成 targeted tests、`pnpm typecheck`、`git diff --check` 後提交。

## 第一批：輸入可靠性

1. 將 roster tokenizer 改為括號／引號感知，只切最外層分隔符；補 12 角色與中日文別名測試。
2. 新增依 media type 的 source canonicalizer；HTML fixture 必須移除 script/style/navigation/template/footer 並保留 title、heading、paragraph order。
3. 對空正文或不支援 media type 回傳 recoverable diagnostic。
4. 在 candidate/source commit 加 canonical URL、final URL、original hash、revision 去重。
5. 收斂同步 request 與 worker replay 的 claim 邊界；相同 operation 不得建立兩份 source。

Commit：`V3.4:強化多人來源輸入可靠性`

## 第二批：Agent-first typed facts

1. 為 FactRecord／FactClaim 增加向後相容的 `entity_refs`，並集中定義 coverage dimension。
2. 建立單一 entity matcher，解析 Blueprint ID、label、aliases；供 curation、authoring、fingerprint、workflow gate 共用。
3. source-adaptation 的 natural knowledge request 只準備 chunks；沒有 typed curation 時回傳 `needs_input`，不得建立句子 facts。
4. typed `fact_curation` 驗證 entity refs、coverage、evidence revision 與來源定位。
5. 接受裁決阻擋 URL subject、HTML、fallback predicate、角色名稱 coverage 與未知 entity。

Commit：`V3.4:導入 Agent-first typed facts`

## 第三批：審查與創作整合

1. Fact Review context 僅包含固定 run snapshot 的當頁候選，不附加全部 unresolved facts。
2. 候選加入 source metadata、section heading、完整段落、必要前後文與 evidence span。
3. reviewer 使用內部分片／lease 取得不重疊頁面；競態裁決安全收斂。
4. authoring context 只提供目標角色相關 accepted facts。
5. workflow coverage 與 dependency fingerprint 使用共用 entity matcher；完成 Audit4 BUG4-04／05。
6. 每個 roster entity 產生來源／accepted coverage diagnostic，允許具 audit 的明確豁免。

Commit：`V3.4:收斂 Fact Review 與角色依賴`

## 第四批：發布前整合驗收

建立 production-path 12-role scenario：

- 括號內逗號、aliases、世界設定、關係與多人開場白。
- HTML 與純文字來源，含重複 URL/revision 競態。
- 至少 120 個有效 typed fact candidates，完成分頁審查。
- accepted identity/personality/background/relationship/world facts 正確進入對應 authoring context。
- original-character 與無來源流程不受影響。
- 執行 `pnpm test`、`pnpm typecheck`、`pnpm check`（若存在）、`git diff --check`。

Commit：`V3.4:驗收十二角色來源改編流程`

## Audit 4 後續順序

本計畫完成後才依序處理：

1. BUG4-01 artifact binding 與 Publish Plan。
2. BUG4-07／10 exact publish mode semantics。
3. BUG4-08 current-winner materialization rollback。
4. BUG4-09 Build blob lifecycle。

BUG4-02 排除；BUG4-03／06 已完成；BUG4-04／05 併入第三批。
