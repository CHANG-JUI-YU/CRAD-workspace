# Card Workspace vNext Forge Core 實作計畫

日期：2026-07-13  
狀態：程式內實作與自動化驗收完成；真實 SillyTavern 匯入待外部驗收  
依據：`docs/superpowers/specs/2026-07-13-card-workspace-vnext-master-design.md`

## 1. 目標與邊界

Forge Core 將已完成的 Foundation 擴展成完全確定性的角色卡編譯核心：

```text
作者專案
→ Parse / Validate
→ Canonical IR
→ Worldbook Plan
→ Token / Trigger Simulation
→ 三層 Audit
→ CCv3 JSON / PNG
→ Atomic Publish
→ Import / Round-trip
```

本階段包含 Character、World、Greetings 作者 schema、Canonical IR、planner、simulator、CCv3 JSON/PNG、V1/V2/V3 import、audit 與 round-trip。

本階段不包含來源快照與事實提煉、Agent/Skill、Dashboard、MCP 或 MVU/EJS 等選配插件。模組7只能成為角色 lore，永不映射為 greeting。

保留 Foundation 已建立的 `workflow.json` 契約。正式 `projects/` 目前無持久資料，因此 Project Manifest v1 可直接收斂到主規格的 `card` 結構，不建立 `card_profile` 相容 shim。

## 2. Package 邊界

```text
@card-workspace/schemas
├─ @card-workspace/project
├─ @card-workspace/adapters-ccv3
├─ @card-workspace/adapters-png
└─ @card-workspace/diagnostics

@card-workspace/compiler
├─ schemas
├─ project
├─ adapters-ccv3
├─ adapters-png
└─ diagnostics

@card-workspace/cli
└─ compiler + adapters
```

Adapter 不得反向依賴 compiler。IR、audit、simulation 與 import envelope 型別集中於 schemas。所有檔案寫入仍由 project transaction 處理。

## 3. 里程碑

### M1：作者模型與最小 JSON 垂直切片

完成 Task 1 至 4、7 的 V3 JSON 部分。驗收路徑：

```text
單角色珠璣 → Canonical IR → Planner → CCv3 JSON → Normative Audit
```

### M2：Simulator 與三層 Audit

完成 Task 5、6、8。Token 與觸發結果必須可重現，規範、相容與工作區政策不得混層。

### M3：PNG 與 Atomic Publish

完成 Task 7 的 V2 降級、Task 9、10。JSON 與 PNG 必須整批發布；strict 失敗不得修改 exports。

### M4：Import 與 Round-trip

完成 Task 11 至 13。V1/V2/V3 JSON/PNG 可匯入，未知欄位與三層 extensions 不得靜默遺失。

## 4. 任務

### Task 1：作者 Schema 與 Manifest 收斂

新增：

- `packages/schemas/src/author-common.ts`
- `packages/schemas/src/character.ts`
- `packages/schemas/src/zhuji.ts`
- `packages/schemas/src/palette.ts`
- `packages/schemas/src/world.ts`
- `packages/schemas/src/greetings.ts`
- `packages/schemas/test/author-schemas.test.ts`

修改 `project.ts`、schema exports、initializer 與 fixtures。

先寫失敗測試：

- Manifest 使用 `card.name/profile/avatar`，不再使用 `card_profile`。
- 珠璣七模組完整且 stable ID 唯一。
- 調色盤四模組完整。
- 單角色 mode 與目錄一致，禁止同時混用兩種模式。
- World 類別、aliases、relationships 與 compile override 可驗證。
- Greetings 恰有一個 primary，alternate/group-only 分類明確。
- Greeting 引用的所有角色存在。
- 模組7無 greeting 類型或映射欄位。
- `sections`、provenance、extensions 深層 round-trip。

### Task 2：完整作者專案 Loader

新增：

- `packages/project/src/discover-author-project.ts`
- `packages/project/src/load-author-project.ts`
- `packages/testing/src/project-builder.ts`
- 單角色珠璣、單角色調色盤、多角色混合與無效作者 fixtures。

Loader 回傳 typed documents、來源位置與 raw revisions；精確辨識根 `project.yaml` 和 `workflow.json`，不得用 basename 誤認巢狀檔案。一次聚合 parse、schema、模式、ID 與 reference diagnostics。`.build`、passthrough、symlink/junction 與未知副檔名不得進入作者模型。

更新 ownership，使 patch 只可修改 manifest 宣告的作者文件。

### Task 3：Canonical IR

新增 `packages/schemas/src/ir.ts` 與 `packages/compiler`。

IR 必須定義：

- `CanonicalProject`、`CanonicalCharacter`、`CanonicalGreeting`。
- `CanonicalLoreEntry` 與 fragment-level provenance。
- discriminated Activation、semantic Placement、explicit Recursion。
- Runtime Route。
- card/book/entry 三層 extensions 與 future-field passthrough。

`normalize.ts` 必須保證相同輸入產生 byte-stable IR；display name 變更不得改 stable ID；模組7只產生 lore；自訂 sections 轉 ContentFragment；missing 或 ambiguous ref 產生 diagnostics；不得包含 CCv3 position 或 ST magic number。

### Task 4：Deterministic Planner

新增 planner、defaults、XML boundary 與 decision trace。

- 核心身份與核心人格預設 constant。
- 語料、關係、地理與深層細節預設 keyed。
- 作者 override 優先。
- category rank 後以 stable ID 排序。
- XML tag 由 stable ID 安全生成。
- recursion dependency graph 必須偵測 cycle。
- CCv3 low-first order 與 ST runtime position 分離。
- Planner 只使用作者提供的 keys、名稱與 aliases，不自行發明關鍵詞。

### Task 5：Token Simulator

新增 `Tokenizer` interface、固定版本 exact tokenizer 與明確標示的 approximation。

報告每條 token、constant total、位置分布、worst-case、priority/order eviction、tokenizer ID/version 與 strict-block 原因。同一輸入與 tokenizer 必須產生相同報告。

### Task 6：Trigger 與 Recursion Simulator

新增 key matcher、trigger simulator、recursion graph。

測試 plain/regex keys、case、whole word、scan depth、secondary ANY/ALL/negative、constant、disabled、group、generation trigger、recursion exclude/prevent/delay、cycle、最大深度與 budget eviction。報告必須標示 `generic-ccv3` 或固定版本 `sillytavern` profile，不宣稱模擬未知 runtime。

### Task 7：CCv3 JSON 與 V2 Downgrade

新增：

- `packages/schemas/src/ccv3.ts`
- `packages/schemas/src/ccv2.ts`
- `packages/adapters-ccv3`

V3 必須輸出全部必要欄位、`group_only_greetings`、Lorebook/entry extensions、entry `use_regex`，且不輸出 V1 root mirrors。minimal-worldbook profile 清空 description/personality/scenario/mes_example。

三層 extensions 採 object deep merge、array replace；generated canonical field 衝突時 generated value 優先並留下 diagnostic。

V2 backfill 必須由同一 IR 真正降級，處理 V3-only 欄位、group-only greetings、decorators 與 loss report，不得只修改 discriminator。

### Task 8：三層 Audit

新增 `packages/diagnostics` 與 audit schema。

- Normative：CCv3 shape、required fields、PNG metadata。
- Compatibility：ST position/depth/role、regex、chunk precedence、extensions。
- Workspace：空白主卡欄位、XML boundary、Puppeteering、開放式 greeting、recursion policy、token budget。

每個 finding 必須有 stable rule ID、layer、severity、location、evidence、hint、fixability。Workspace 規則不得標成 normative。JSON 與 Markdown finding 數必須一致，strict 阻斷由 resolved policy 決定。

### Task 9：PNG Adapter

新增 `packages/adapters-png`，驗證 PNG signature、chunk length、CRC 與資源限制。

- 寫入小寫 `ccv3` `tEXt`：UTF-8 JSON → Base64 ASCII。
- 選配 `chara` 使用 Task 7 的真正 V2 payload。
- 雙 chunk 時以 `ccv3` 為權威。
- metadata 位於 IEND 前。
- 重寫只替換 chara/ccv3，其他 ancillary、IDAT 與 APNG chunks 保持等價。
- 錯誤 Base64、JSON、CRC、duplicate chunk 產生 diagnostics。

### Task 10：Atomic Build 與 Publish

新增 compiler build manifest 與 project publish API；補 parent-directory fsync。

所有 parse、normalize、plan、simulate、audit、emit 先在記憶體或 staging 完成，再以單一 workspace transaction 發布：

```text
projects/<id>/.build/*
exports/<id>/<card>.json
exports/<id>/<card>.png
```

任一 strict error、PNG failure、stale revision、concurrent compile 或 rename 故障都不得留下半套 exports。Build manifest 保存 input revision、工具版本、tokenizer、pass、artifact hash；時間不得污染 canonical artifact hash。

### Task 11：V1/V2/V3 JSON/PNG Import

新增 import envelope 與 adapters。

- V1 六欄建立完整 V3 defaults。
- V2 補 `group_only_greetings`、entry `use_regex` 與必要 defaults。
- V3 接受 `3.x` 匯入，future version 警告並保存未知欄位。
- PNG 雙 chunk以 `ccv3` 為權威，不 merge `chara`。
- 保存 raw snapshot、三層未知 extensions、future fields 與 loss report。
- 不猜測珠璣或調色盤，不假裝完成語意反編譯。

### Task 12：Round-trip Matrix

新增 Author → IR → V3 → Import → IR、JSON → PNG → JSON、V3 unknown-field preservation 與 V2 expected-loss 測試。

差異分類只能是：

- `equivalent`
- `expected_loss`
- `unexpected_loss`

任何 unexpected loss 阻斷 strict publish。Golden fixtures 至少涵蓋 empty V3、珠璣、調色盤、混合多角色、模組7、三類 greetings、lore chain、future V3、nested extensions、PNG/APNG/dual/corrupt。

### Task 13：CLI 與最終 E2E

新增命令：

```text
card-workspace plan <project-id>
card-workspace simulate <project-id> --conversation <file>
card-workspace compile <project-id> [--no-publish] [--no-png] [--v2-backfill]
card-workspace audit <file-or-project>
card-workspace import <file> [--project <id>]
card-workspace roundtrip <file-or-project>
```

CLI 與 library 對相同 revision 必須產生相同 IR、artifact hash 與 diagnostics。`--no-publish` 不可寫 exports；strict failure 使用穩定非零 exit code；import 路徑與大小受 Foundation 安全策略限制。

## 5. 測試與品質門禁

每個 Task 先建立失敗測試，再做最小實作。所有 I/O 測試使用 OS temp directory，不讀寫正式 `projects/` 或 `exports/`。

```powershell
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 audit --prod --audit-level moderate
```

Coverage 維持 Foundation 的全域門檻；CCv3 emit/import、PNG CRC/chunk、publish rollback 必須另外以風險 fixture 驗收，不以 coverage 數字取代。

## 6. 完成定義

- 單角色珠璣、單角色調色盤與多角色混合模式皆可輸出 V3 JSON/PNG。
- 模組7存在於世界書且永不成為 greeting。
- Token/trigger simulation deterministic，strict budget 可阻斷。
- CCv3、ST compatibility、workspace policy 三層 audit 分離。
- `chara` 是真正 V2 downgrade。
- Strict failure 不修改 exports。
- V1/V2/V3 JSON/PNG 可匯入。
- 三層 extensions 與 future fields round-trip 無 unexpected loss。
- JSON/PNG golden fixtures 通過 schema、CRC 與 round-trip。
- CLI 與 library 結果一致。
- 依賴 audit 無 moderate 以上已知弱點。

真實 SillyTavern 匯入屬最終外部驗收：測試 V3 JSON、只有 ccv3 的 PNG、ccv3+chara PNG，人工核對 greetings、世界書順序與觸發。若本機未安裝 SillyTavern，必須明確記錄為待外部驗收，不得以 schema 測試冒充。

## 7. 實作校正與驗收結果

完成日期：2026-07-13。

- 建立 `schemas`、`project`、`compiler`、`adapters-ccv3`、`adapters-png`、`diagnostics`、`cli` 與 `testing` 的單向 package graph；adapter 不反向依賴 compiler。
- 作者 loader 使用固定珠璣七模組、調色盤四模組、八類世界設定與專案級 greetings；模組7的回歸測試確認其只進 lore。
- Forge pipeline 已實作 Parse/Validate、Normalize、Plan、Token/Trigger Simulation、Emit、Audit、可選 PNG/V2 backfill 與 Atomic Publish。
- PNG parser/writer 驗證 signature、IHDR/IEND、chunk 長度、CRC、Base64、UTF-8、重複 metadata 與資源上限；重寫時保留非角色 chunks 原始位元組。
- V1/V2/V3 JSON 與 PNG 共用 import envelope；V3 future fields、三層 extensions 與未知 entry 欄位經 round-trip 檢查，不猜測作者模式。
- `BUILD_AUDIT_BLOCKED` 會回傳由 audit findings 轉換的結構化 diagnostics，不再誤附 Trigger simulator diagnostics。
- CLI 已提供 plan、simulate、compile、audit、import 與 roundtrip；輸入路徑受 workspace 邊界限制。
- 自動化驗收：20 個測試檔、110 項測試全數通過；coverage 為 statements/lines 90.06%、branches 80.9%、functions 93.4%。
- `install --frozen-lockfile`、build、lint、typecheck、tests、coverage 與 production audit 全數通過；production dependencies 無已知弱點。

計畫與實作的可接受校正：PNG/APNG 測試以程式化 chunk fixtures 驗證 IDAT/ancillary 原始位元組保存，不提交大型二進位 golden 檔；這比只比較重新編碼後圖片更直接驗證 metadata replacement 邊界。真實 SillyTavern 匯入仍未執行，保留為唯一外部驗收項。
