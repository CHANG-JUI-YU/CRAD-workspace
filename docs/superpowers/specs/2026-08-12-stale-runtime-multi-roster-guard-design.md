# Dashboard Runtime 新鮮度與多人 Roster 防線設計

## 狀態

- 日期：2026-08-12
- 優先級：阻斷性修復，高於第四次 Audit 的既有工作
- 適用分支：`main`
- 使用者決策：只保護未來新專案；不遷移或修復已完成的錯誤專案

## 背景

實際 source-adaptation 多人專案選擇「多人角色卡」後，執行中的引擎跳過
`character_roster`，只建立 `character-1`。其餘角色雖完整保存在 `supplement`，但
supplement 是不具結構語義的自由文字，不會建立角色、逐角色來源或 Blueprint roster。

靜態與執行狀態檢查確認兩條根因：

1. Dashboard Node 服務早於 workspace `dist` 重建時間啟動，仍持有舊版模組。Launcher
   只檢查 health 的 service 名稱，會沿用任何健康的 ST Workspace 服務，無法辨識它載入的
   build 是否與磁碟內容一致。
2. 現行訪談正常路徑雖會要求多人 roster 至少兩人，但完成 transition、schema 與
   Blueprint precheck 沒有共同的條件式 invariant。舊 Runtime、legacy state 或異常恢復
   狀態仍可把「多人卡＋一名角色」保存為完成狀態。

## 目標

- Dashboard 每次啟動前保證 workspace packages 已建置。
- Server health 能識別目前程序實際載入的 build revision。
- Launcher 不沿用缺少 revision 或 revision 不一致的舊服務。
- 多人角色卡在 roster 少於兩人時不能完成訪談或建立 Blueprint precheck。
- 正常 source-adaptation 多人流程維持 roster → 逐角色名稱／來源／設定的既有行為。
- 錯誤以可理解、可恢復的診斷呈現，不自動終止未知 Node 程序。

## 非目標

- 不解析 `supplement` 來推導角色。
- 不修改、遷移或補救已完成的錯誤專案。
- 不新增完成後 roster editor、Blueprint migration 或批次角色匯入功能。
- 不改變 Character Expansion、Fact Review、Compiler 或 Publish semantics。
- 不要求使用者操作 PID、commit hash、revision 或 character id。

## 設計一：啟動前建置

`ST-Workspace-Dashboard.cmd` 在啟動 TypeScript launcher 前執行 workspace build：

```text
pnpm -r build
```

若 `pnpm` 不存在或 build 失敗：

- 顯示固定錯誤碼與可理解訊息。
- 不啟動 Dashboard。
- 不沿用既有服務來掩蓋 build failure。
- CMD 保持開啟，讓使用者看到錯誤。

每次啟動都 build，以確定性優先；不以 mtime 猜測 source 是否需要重建。穩定輸出的
content fingerprint 可讓相同 build 得到相同 revision，因此重複 build 不會誤判 stale。

## 設計二：Runtime build revision

新增單一 helper 計算 workspace build revision。輸入是排序後的 runtime-relevant
`packages/*/dist/**/*.js` 相對路徑與內容，輸出為 content hash。不得使用：

- 檔案 mtime
- 程序啟動時間
- 只看 Git HEAD

理由是 mtime 會因重複 build 改變，Git HEAD 不涵蓋未提交修正，而 content hash 能表示
程序將載入的實際 JavaScript。

Server 啟動時只計算一次並保存 revision；health 回傳：

```json
{
  "service": "st-workspace-v3",
  "status": "ready",
  "runtime_revision": "sha256:...",
  "worker": { "running": true }
}
```

revision 必須是程序啟動時的 snapshot，不能在每次 health request 從磁碟重算，否則已載入
舊模組的程序會錯誤宣稱自己是新 build。

## 設計三：Launcher reuse policy

Launcher 完成 build 後，以磁碟 dist 計算 expected revision，再 probe 8787：

1. 無服務：啟動新 server，傳入 expected revision。
2. service 與 revision 都相同：沿用既有服務並開啟瀏覽器。
3. service 正確但沒有 revision：回傳 `DASHBOARD_SERVICE_STALE`。
4. service 正確但 revision 不同：回傳 `DASHBOARD_SERVICE_STALE`。
5. 非 ST Workspace 服務：維持 `DASHBOARD_PORT_IN_USE`。

stale 診斷必須要求使用者關閉舊 Dashboard CMD 後重新啟動。Launcher 不可依 health 回傳的
PID 自動終止程序，也不可偷偷切換 port，避免關閉錯誤工作或建立兩個 Runtime。

## 設計四：多人 roster invariant

建立一個 core-level authoritative helper，判斷訪談是否宣告多人卡，以及 roster 是否有效。
至少要求：

```text
card_shape is multi
⇒ interview.characters exists
⇒ interview.characters.length >= 2
```

正常單人卡、獨立世界書、continue、legacy review 不套用此限制。世界＋角色卡與
source-adaptation 使用相同多人語義。

### 完成 transition 防線

當 active interview 嘗試完成，但多人 roster 無效：

- 不回傳 `status: complete`。
- 不設定 `confirmed_no_additional_settings: true`。
- 保留現有 answers 與 values。
- 回到 `character_roster` 問題，顯示至少兩人的要求。
- 不從 `source_subject` 或 `supplement` 自動猜角色。

這只處理尚在 active transition 的異常狀態，不重新開啟已完成專案。

### Runtime／precheck 第二防線

建立 Blueprint precheck 前再次使用相同 invariant。若無效，回傳 recoverable typed error：

```text
INTERVIEW_MULTI_ROSTER_INCOMPLETE
```

不得建立：

- BlueprintPrecheckRecord
- Blueprint artifact
- `source_adaptation.subjects[]`
- completed interview audit result

Core transition 與 Runtime precheck 必須共用同一判定 helper，不能維護兩套正規表示式。

### Schema 相容性

不把條件式限制直接做成會拒絕載入舊 state 的 Zod refine。舊 state 仍可讀取與診斷，但不能
用來建立新的 completed Blueprint。一般 `characters.min(1)` schema 保持 backward-compatible。

## Supplement 語義

`supplement` 保持 project-level 自由文字，只提供創作補充，不具備 roster mutation 權限。
Director 文件應明確說明：增加角色必須在 roster 步驟完成；supplement 不能承諾建立新的角色
項目。這次不新增完成後 roster 修改工具。

## 錯誤與使用者體驗

| 狀況 | 結果 |
|---|---|
| `pnpm` 缺失 | `DASHBOARD_PNPM_MISSING`，不啟動 |
| build 失敗 | `DASHBOARD_BUILD_FAILED`，保留輸出並暫停 |
| 既有 ST server 缺 revision | `DASHBOARD_SERVICE_STALE` |
| 既有 ST server revision 不同 | `DASHBOARD_SERVICE_STALE` |
| 8787 為其他服務 | `DASHBOARD_PORT_IN_USE` |
| 多人 roster 少於兩人 | 回到 roster 問題，不完成 |
| invalid roster 抵達 precheck | `INTERVIEW_MULTI_ROSTER_INCOMPLETE`，零 Blueprint 副作用 |

## 測試

### Launcher／Server

- CMD 在 launcher 前執行 `pnpm -r build`。
- build failure 不執行 launcher。
- 同一 dist content 的 revision 穩定。
- health 回傳程序啟動時保存的 `runtime_revision`。
- revision 相同可 reuse。
- revision 缺失／不同回傳 stale，不呼叫 startServer 或 openBrowser。
- foreign service 仍回傳 port-in-use。

### Interview／Runtime

- source-adaptation 多人流程在 `character_origin` 後進入 `character_roster`。
- roster 一人時停留並要求至少兩人。
- 模擬異常 active state：`card_shape=多人角色卡`、只有一名角色、回答完成確認後仍為 active。
- 同一異常 state 不建立 precheck／Blueprint，回傳 typed recoverable error。
- roster 兩人以上可逐角色完成名稱、來源、mode、core 與 direction。
- 單人卡與非角色 world flow 不回歸。

測試只使用 memory repository 或 temporary directory，不讀寫 `projects/` 內的真實專案。

## 驗證順序

1. Core interview targeted tests。
2. Runtime project-interview targeted tests。
3. Server launcher／health targeted tests。
4. `pnpm typecheck`。
5. `pnpm test`。
6. `git diff --check`。

## 完成條件

- 重新啟動 Dashboard 後，新建 source-adaptation 多人卡一定先取得至少兩名 roster。
- 任一防線都不能讓「多人卡＋一名角色」產生 completed Blueprint。
- 新 build 不會沿用缺少 revision 或 revision 不一致的舊 Runtime。
- 不存在 supplement 自動解析、舊專案 migration 或自動殺程序的額外行為。
