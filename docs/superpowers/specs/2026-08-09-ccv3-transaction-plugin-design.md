# V3 CCv3、交易與 Plugin 生成設計

## 目標

補齊 V3 的三個必要能力：

1. 從 V3 的 canonical project 產生與既有 ST workspace 相容的 CCv3 JSON，並能包裝成可讀回的 PNG。
2. 讓 state、build 輸出與 plugin trace 使用跨 process 的交易與 expected-revision CAS；任何 materialize 失敗都不得提升 revision 或留下半套輸出。
3. 將三種官方 typed plugin proposal 真正編譯為可被 CCv3 emitter 消費的 plugin contribution：`official.mvu-zod`、`official.ejs`、`official.html`。

既有訪談 Blueprint precheck、Quality Profile、binary 比例判定不在本次範圍；它們沿用目前工作流與其他 agent 的修改。

## 非目標

- 不恢復舊 workspace 的全部 MCP tool 數量或完整舊 workflow UI。
- 不允許 Plugin proposal 直接寫入正式檔案；正式輸出一律由 compiler transaction 產生。
- 不執行任意 JavaScript、EJS 任意 delimiter、HTML script、remote resource 或未註冊 JSON path。
- 不在本次重新設計 fact-review、interview precheck 或 quality policy。

## 方案與邊界

採用獨立 compiler 邊界，而不是把格式與 Plugin 邏輯塞入 `domain/build.ts`。

```text
V3 ProjectState / artifacts / accepted facts
                 |
                 v
        normalizeAuthorProject
                 |
                 v
       CCv3 canonical project
          |                 |
          v                 v
   emitCharacterCardV3   buildPluginContributions
          |
          v
    encodeCharacterCardPng
          |
          v
  transactional build + publish
```

新增的責任邊界：

- `packages/compiler`：把 V3 artifact 解析、排序、正規化，並協調 CCv3、Plugin 與 PNG 輸出。
- `packages/adapters-ccv3`：既有 CCv3 schema、deterministic emitter、managed plugin contribution 合併與 provenance trace。
- `packages/adapters-png`：合法 PNG chunk parser／encoder，以及 `ccv3`／`chara` metadata 的讀寫。
- `packages/plugins`：三種 official plugin source 的 typed validator／compiler，輸出共用 contribution contract。
- `packages/core` repository：提供跨實例 lock、CAS 與 staging transaction；domain service 只透過 repository transaction 寫入。

模組可以在 V3 既有 package 內實作，但 public contract 必須維持上述責任分離，避免 build service 直接依賴 plugin source internals。

## CCv3 與 PNG 輸出

### Canonical project

`normalizeAuthorProject` 只消費已通過 schema 的 artifact。對同一 artifact key 取最新 revision；排序固定使用 kind、name、key 的 lexical order。輸出包含：

- card identity、name、avatar/profile metadata；
- character／world／relationship／greeting／fact 內容的 deterministic mapping；
- artifact id、revision、content hash 的 provenance；
- plugin selection、implementation pin、source revision 與 generated contribution trace。

沒有必要資料時，compiler 回傳結構化 error，不產生部分 JSON／PNG。

### CCv3 JSON

emitter 產生既有 ST workspace 使用的 CCv3 envelope，`spec_version`、`data` 與 nested character card 欄位通過既有 CCv3 schema parse。所有 array、object key 與 managed resources 的排序 deterministic；同一份 project、同一組 plugin pins 必須得到相同 JSON bytes 與 build hash。

Plugin contribution 只能透過 allowlisted path application 進入 `/data`，並寫入 managed trace。相同 plugin contribution 重複套用必須 idempotent；resource id collision 或 unmanaged overwrite 直接失敗。

### PNG

PNG encoder 產生有效 signature、IHDR、必要 image chunks、metadata chunks 與 IEND，所有 chunk 計算 CRC。角色卡 JSON 以 UTF-8 並以 Base64 寫入：

- `ccv3`：完整 CCv3 JSON；
- `chara`：相容舊工具的角色卡 metadata（若既有 adapter 定義要求不同內容，以既有 adapter contract 為準）。

讀回路徑必須驗證 PNG signature、chunk length、CRC、IHDR/IEND、metadata duplicate、Base64、UTF-8 JSON 及 CCv3 schema。JSON 與 PNG 的讀回結果要能通過 round-trip equality（允許 deterministic canonicalization，不允許內容遺失）。

## Typed Plugin 生成

三種 source 共用 `PluginContribution` 輸出，但各自獨立驗證：

- MVU：將 typed variables、JSON pointer update rules 與 registry metadata 編譯為受控 MVU contribution；只允許 schema 宣告的 node kind、range 與 writable path。
- EJS：將 typed entries、sections、dynamic text、preprocessing 編譯為 managed lore／helper／regex resources；delimiter、condition、path 與 dependency 必須經 validator，禁止 raw executable template。
- HTML：將 allowlisted feature、component、binding 編譯為受控 HTML contribution；禁止 script、inline handler、iframe、remote URL、任意 tag／attribute；可寫 binding 必須指向 MVU registry 的 writable path。

每個 generated contribution 包含 plugin id、implementation version、source revision、managed resource ids、target paths、operations 與 trace。build 只接受已 parse 且與 proposal plugin id 相符的 contribution，不直接相信 artifact content 中的自由欄位。

Plugin artifact 的狀態仍由 V3 artifact ledger 保存；compiler 不會把「stored proposal」視為「generated／approved」。若 proposal 無法生成，build 回傳 `PLUGIN_COMPILE_INVALID` 並不產生正式輸出。

## Transaction 與跨實例 CAS

### API

Repository 提供共用交易入口：

```ts
transaction<T>(
  expectedRevision: number,
  work: (tx: ProjectTransaction) => Promise<T> | T,
): Promise<{ revision: number; value: T }>;
```

`ProjectTransaction` 只能讀取 lock 內的最新 state、註冊 staging output，並在最後一次 commit 時產生新 state。既有 `commit(expectedRevision, mutate)` 以同一機制實作，維持現有 caller 相容。

### 檔案交易流程

1. 以 project-specific lock file 取得跨 process exclusive lock；lock 必須包含 owner id、pid、created_at、heartbeat／stale 判定。
2. lock 內重新讀 state；revision 不等於 expected revision 時立即回傳 `REPOSITORY_CAS_CONFLICT`，不執行 mutate。
3. 建立 project-specific staging directory，所有 state、JSON、PNG、plugin trace 與 manifest 先寫入暫存檔並 flush。
4. 驗證 state schema、輸出存在、hash 相符、PNG 可讀回、plugin trace 完整。
5. 以同一個 lock 將目前輸出搬到 recoverable backup，再以 rename 交換 staging payload；最後寫入新 state，revision 只在整體成功時加一。
6. 成功後移除 staging／過期 backup 並釋放 lock；任何失敗都 rollback 已交換的檔案、移除 staging，保留原 state 與原 revision。

Memory repository 也採用同一個 expected-revision 語義，但不需要 OS lock；其測試必須和 File repository 共用 CAS contract。

交易不允許先持久化 `project_status: published` 再 materialize exports。publish record、build manifest、JSON／PNG 與 plugin trace 必須同一交易提交。

## 錯誤與恢復

- stale expected revision：回傳可辨識 CAS conflict，caller 必須重新讀取並重新計畫，不自動覆蓋另一實例的 state。
- lock timeout／持有人死亡：只有通過 owner stale 判定才可回收 lock；不安全時回傳 `REPOSITORY_LOCK_TIMEOUT`。
- CCv3／PNG／Plugin validation failure：回傳 domain error，state revision、exports 與 publish record 不變。
- staging 或 rename 失敗：保留原輸出，清理可確認安全的暫存物；若 rollback 也失敗，回傳 recovery-needed error 並保留 backup／staging 路徑供後續處理。
- 重試必須使用新的 operation／expected revision，不能重放無法序列化的 function closure 或半完成輸出。

## 驗證與回歸測試

新增測試至少包含：

1. canonical project → CCv3 schema parse、deterministic hash、plugin trace 與 managed resource idempotence。
2. CCv3 → PNG → read PNG → CCv3 round-trip；CRC、duplicate metadata、truncated chunk、invalid Base64 與 invalid schema rejection。
3. MVU／EJS／HTML 各一個成功生成案例，以及 raw code、unsafe path、invalid binding、plugin id mismatch 的拒絕案例。
4. File repository：兩個 repository instance 同時以 revision 0 commit，只有一個成功，另一個收到 CAS conflict。
5. File repository：state、JSON、PNG、trace 任一 materialize failure 時 revision 不變、舊 exports 仍可讀、沒有假 publish。
6. 成功交易後重新載入 repository，state revision、manifest hash、PNG read-back 與 plugin trace 一致。
7. 現有 domain／runtime／server 測試全部通過；build API 仍支援只要求 JSON 或同時要求 JSON + PNG。

## 完成判定

本次工作完成時，必須能以 V3 的正式 build／publish 入口：

- 產生既有 ST workspace 可讀的 CCv3 JSON 與 PNG；
- 讀回 PNG 並驗證內容未遺失；
- 由三種 typed plugin proposal 生成實際 contribution，且 contribution 出現在 CCv3 與 build trace；
- 在兩個 File repository instance 競爭寫入時拒絕 stale writer；
- 任一輸出失敗都不會留下 published state 或半套 export。
