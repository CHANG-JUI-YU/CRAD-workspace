# ST-workspace-v3 第一批高優先 BUG 修復設計

日期：2026-08-10  
狀態：已口頭批准，待書面確認  
依據：docs/audits/2026-08-10-st-workspace-v3-comprehensive-static-audit.md 的 BUG-01 至 BUG-10 第一批範圍

## 1. 目標

在擴大使用者實測前，關閉三條核心可靠性鏈：

1. agent identity → review → quality policy → publish gate。
2. Blueprint → required artifacts → semantic compiler。
3. persisted operation → lease → file transaction → crash recovery。

同時修復 audit 歷史覆蓋與實際訪談選項無法完成的兩個明確缺陷。

完成後，工作區應能可靠回答：

- 是哪個 agent 建立或審查產物，而不是只知道同一個 MCP session actor。
- 目前 quality profile 下，哪些 issue 真正阻止發布。
- 指定 export mode 時，每個 Blueprint 角色缺哪些必要模組。
- 編譯結果中的每個值代表哪個欄位，角色正式名稱與 primary character 是誰。
- 交易或 worker 中途失敗後，是否能由 durable state 正確恢復且不重複執行。

## 2. 不在本批範圍

- P1/P2 的 source、fact、import、plugin runtime、Dashboard 與新角色卡功能。
- 重新設計角色卡核心欄位或改變已批准的世界書打包規則。
- 把 Blueprint、accepted facts 加入世界書。
- 補寫既有專案產物。
- 清理使用者或其他 agent 的未追蹤檔案。

本批必須保留 clean-zhwiki-characters.txt、st-probe.ts、st-review.ts，以及其他不屬於本設計的既有變更。

## 3. 方案比較

### 方案 A：單一 agent 依序完成

優點是上下文一致、沒有合併衝突。缺點是 BUG-01 至 BUG-10 橫跨 server、domain、compiler、core repository 與 runtime worker，單一 context 過大，後段容易遺漏前段不變量。

### 方案 B：所有問題同時平行

速度最快，但 quality gate、required manifest、runtime recovery 與 transaction 都會碰 core/runtime/workflow-gate，容易產生互相覆蓋或在不同假設下完成的 patch。

### 方案 C：兩波、依寫入邊界平行

第一波先修相對獨立的 identity/quality、compiler、transaction 與 interview；第二波在這些合約穩定後，平行完成 required manifest 及 operation recovery。這能兼顧速度、上下文大小與衝突控制。

採用方案 C。

## 4. 共通設計原則

### 4.1 身分分層

- session actor：發起操作的人或外部 session，例如 opencode。
- execution agent：實際執行 creator、critic、reviewer 或 Director 能力的 agent_id。
- artifact.created_by、review.reviewer 與 fact reviewer identity 使用 execution agent。
- operation.actor 與一般 audit actor 保留 session actor；audit details 另外保存 agent_id。
- template submit 必須先由 registry 解析 agent，再驗證該 agent 是否允許提交該 proposal kind。
- 未知的明示 agent 不再靜默 fallback。

### 4.2 Quality 判定

- 所有要發布的 current content artifact 仍必須有一筆針對目前 revision 的已完成 review。
- review.status 保留「審查觀察結果」：無 finding 為 passed；只有非高嚴重度 finding 可為 partial；含 error/critical 可為 failed。
- publish gate 不再要求 status 必須等於 passed；它改為讀取該 review 對應、仍為 open 的 issue，套用目前 policy snapshot 與 override 後判斷。
- none 不因 issue severity 阻擋；light 阻擋 critical；normal 阻擋 error/critical；strict 阻擋 warning/error/critical。
- resolved 與 ignored issue 不阻擋；ignore 必須符合 overridable 並保存理由、操作者、原始與 effective severity。
- review proposal schema 必須可表示 critical，與 QualityLevel 的完整範圍一致。

### 4.3 Blueprint 是必要產物集合的唯一來源

新增純函式 RequiredArtifactManifest，由 latest approved Blueprint 與本次 export mode 產生：

- primary_character_id。
- 每個 character_id 的 display_name。
- 本次所需模式與完整 module keys。
- world、relationships 與其他 Blueprint 明示啟用的 project artifacts。
- 每個 requirement 所綁定的 Blueprint revision。
- 本次需要 review 的 artifact revision 集合。

authoring readiness、workflow gate、build 與 compiler 都消費同一 manifest，不再各自猜測需求。

### 4.4 編譯不得丟失結構

- JSON Zhuji/Palette 使用 typed semantic renderer。
- 物件 key、section title、array item 與巢狀層級必須出現在穩定 Markdown 中；禁止只串接 leaf values。
- compiler 同時讀取新式 JSON Blueprint 的 label/display_name。
- primary_character_id 優先使用 Blueprint 明示值；舊資料沒有時才以 Blueprint roster 第一位作向後相容 fallback，並產生 diagnostic，不再按 id 字典序猜測。
- 條目命名繼續遵守「角色正式名稱_中文模組名」。

### 4.5 Transaction 與 operation 各自有 durable protocol

File transaction：

- staging、backup 與 journal 都放在同一 project filesystem。
- 在移動任何 target 前，journal 已列出完整 write/remove set、target、staged path、backup path、expected revision 與 phase。
- 每一個 replace 的進度先寫 journal，再執行 rename；目前項目永遠能被 rollback 找到。
- 所有 target 安裝完成後寫 committed marker；只有 committed 後才清理 backup。
- 啟動或首次 read 時，在 project lock 下恢復未完成 journal。
- lock 持有人定期 heartbeat；只有超過 lease 且 owner token 未更新的 lock 可視為 stale。
- relocate 使用相同跨實例鎖定原則。

Persisted operation：

- operation 保存 versioned typed command，而不只自然語言 request。
- attachment 先持久化為 immutable reference；state 不直接塞大型 binary。
- created/resolving/running operation 執行前必須以 CAS claim lease_owner、lease_token、lease_expires_at。
- 同步 request 與 background worker 使用相同 claim API；沒有 lease 的執行者不得產生副作用。
- worker 定期續租；失去 lease 立即停止後續 commit。
- retry 只處理 recoverable error。
- typed template proposal 在 domain mutation 前已保存，因此重啟可依原 payload 重播。
- side effect 以 operation_id/idempotency key 去重；完成後清除 lease。
- 舊 operation 沒有 typed command 時只允許既有明確安全的 legacy recovery；無法安全重播者標記 needs_input，而不是猜測。

## 5. 兩波 subagent 分工

所有實作 subagent 使用 gpt-5.6-luna、reasoning=max。

### 第一波

#### Luna A：BUG-01、BUG-02

責任：

- execution agent identity 傳遞與 capability 驗證。
- creator/critic 自我審查判斷改用 agent identity。
- quality review 與 publish 判定。
- issue resolve/ignore/override 的最小 domain/runtime/MCP 操作。

主要寫入範圍：

- tools/opencode-mcp.ts
- packages/server/src/index.ts
- packages/runtime/src/index.ts
- packages/runtime/src/agent-registry.ts
- packages/domain/src/authoring.ts
- packages/domain/src/review.ts
- packages/domain/src/workflow-gate.ts
- packages/core/src/templates.ts
- 對應測試

此 agent 不實作 RequiredArtifactManifest；只保留可供第二波替換的 review gate 邊界。

#### Luna B：BUG-04、BUG-05

責任：

- typed mode semantic renderer。
- 新式 Blueprint 顯示名稱解析。
- compiler 對 primary_character_id 的支援與 legacy fallback diagnostic。

主要寫入範圍：

- packages/compiler/src/index.ts
- packages/compiler/test
- 必要時新增 compiler 內部 renderer/descriptor 檔

此 agent不修改 runtime Blueprint 生成；第二波 Luna E 負責讓正式 Blueprint 持久保存 primary_character_id。

#### Luna C：BUG-06

責任：

- transaction journal、完整 rollback、startup recovery。
- lock heartbeat 與 owner-token 安全清理。
- relocate 跨實例鎖。

主要寫入範圍：

- packages/core/src/index.ts
- packages/core/test 或既有 repository 測試檔

不得同時改 operation lease schema；必須留下可供第二波擴充的 repository primitives。

#### Luna D：BUG-10

責任：

- 實際顯示選項「沒有，開始建立」必須完成訪談。
- 同一 confirmation 的 canonical/同義答案維持一致。

主要寫入範圍：

- packages/core/src/interview.ts
- 對應 interview tests

### 第一波整合 Gate

主 agent 在第二波前：

1. 檢查各 write set 是否越界。
2. 解決 runtime/core 型別整合。
3. 執行各 package targeted tests。
4. 執行 pnpm typecheck。
5. 確認 creator 與 critic 在真實 MCP 形狀下為不同 execution agent。

第一波未通過時不啟動依賴它的第二波修改。

### 第二波

#### Luna E：BUG-03

責任：

- 建立 RequiredArtifactManifest。
- Blueprint 保存 primary_character_id。
- 每角色、每 export mode 的完整模組 gate。
- world.enabled、relationships.enabled、Blueprint revision binding。
- gate 只審查本次 manifest 選中的 artifacts，未選模式不應阻擋。

主要寫入範圍：

- 新增 packages/domain/src/required-artifacts.ts
- packages/domain/src/workflow-gate.ts
- packages/domain/src/build.ts
- packages/runtime/src/index.ts 中 Blueprint 生成／build selection 的必要部分
- 對應 tests

若需共用模組定義，新增小型 descriptor，不複製 compiler 的另一份列表。

#### Luna F：BUG-07、BUG-08、BUG-09

責任：

- operation typed command schema 與向後相容。
- attachment durable references。
- lease claim/renew/release。
- worker 與同步 request 使用同一 claim。
- retry/error 分類、results cleanup、stop 等待 in-flight。
- proposal crash recovery 與 idempotency。
- precheck confirmation 追加 current.audit，禁止覆蓋歷史。

主要寫入範圍：

- packages/core/src/index.ts 的 operation schema
- packages/runtime/src/index.ts
- packages/runtime/src/worker.ts
- 必要時新增 operation-store/attachment-store 小型模組
- 對應 tests

Luna E 與 Luna F 若都需要 runtime/src/index.ts，由主 agent先抽取最小介面或依序整合該檔；不得讓兩個 patch直接互相覆蓋。

## 6. 錯誤處理與相容性

- 所有新增 state 欄位採 optional/default migration，舊專案必須可讀。
- transaction recovery 若 journal 無法判定安全方向，停止並回報可操作 diagnostic，不刪除 backup。
- lease timeout 不等於 operation failure；另一 worker 可在過期後重新 claim。
- identity 缺失時，舊 operation/artifact 使用 legacy actor，但新的 template submit 必須具 execution agent。
- Blueprint 缺 primary_character_id 的舊專案使用 roster 第一位並產生 warning。
- compiler 不因未知 extension 欄位失敗，但必須保留可辨識的 label/value。
- 所有覆寫、ignore、recovery 與 lock takeover 都寫 audit。

## 7. 測試策略

### Targeted tests

- creator agent 建立、不同 critic agent 審查；同 agent 自審仍阻擋。
- none/light/normal/strict 對 info/warning/error/critical 的完整矩陣。
- resolved/ignored/overridden issue 的發布判定與 audit。
- JSON Zhuji/Palette 巢狀 data 編譯後保留 key、title、array hierarchy。
- Blueprint label/display_name 與 primary_character_id 進入 entry/card metadata。
- 每角色缺一個模式模組、缺 world、缺 relationships、未選模式 artifact 不阻擋。
- 每個 backup/rename/cleanup 邊界的故障注入與重啟 recovery。
- lock 持續超過舊 30 秒門檻仍不會被第二實例偷走。
- 兩個 worker 只允許一個 claim；lease 過期後可接手。
- typed proposal 與 attachment 在 crash 後重播一次且只產生一份 domain result。
- assisted precheck 前後 audit 長度只增加不減少。
- 直接提交「沒有，開始建立」完成訪談。

### 整合檢查

每一波完成後執行 targeted tests 與 pnpm typecheck；全部整合後執行 pnpm check。若 full check 揭露與本批無關的既有失敗，需記錄並分離，不得偷偷修改無關功能。

## 8. 完成條件

只有同時符合下列條件，第一批才算完成：

1. BUG-01 至 BUG-10 的上述範圍都有對應程式變更與回歸測試。
2. 真實 MCP template submit 能保存不同 creator/critic identity。
3. quality profile 的四級矩陣與 publish gate 一致。
4. required manifest 能精確列出每個角色、本次 mode 的缺失項。
5. 新式 JSON 編譯不再丟失欄位名稱，角色名稱與 primary 正確。
6. transaction failure injection 可回復成完整舊版本或完整新版本，不留下不可解釋的混合狀態。
7. operation crash/restart 不重複套用 typed proposal，附件可恢復。
8. audit 不被覆蓋，實際 confirmation 選項可完成。
9. pnpm check 通過，或僅剩經證明與本批無關且已明確列出的既有失敗。
10. 沒有改動使用者未追蹤檔案與本批以外功能。

## 9. 整合與交付

- subagent 在各自隔離工作區直接修改並列出變更檔案。
- 主 agent 不重做 subagent 已完成的工作，只做 code review、衝突整合與必要修正。
- 每個 workstream 先個別審查，再進下一波。
- 最終交付列出每個 BUG 的修復位置、行為變化、測試證據、仍存在的風險，以及所有保留未動的使用者檔案。
