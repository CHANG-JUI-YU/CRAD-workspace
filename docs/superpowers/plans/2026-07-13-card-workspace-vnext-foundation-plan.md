# Card Workspace vNext Foundation 實作計畫

日期：2026-07-13  
依據：`docs/superpowers/specs/2026-07-13-card-workspace-vnext-master-design.md`  
範圍：六個工作流中的第 1 階段 Foundation  
狀態：待執行

## 1. 階段目標

建立可供後續 Forge、來源管線、Agents、Dashboard 與 Plugins 共用的工程底座：

- TypeScript monorepo 與一致的工具鏈。
- 版本化作者模型 schema。
- 安全的 workspace/project 路徑解析。
- YAML/JSON 聚合解析與結構化診斷。
- Revision、RFC 6902 patch、dry-run、journal、備份與原子交易。
- 可供 library 與 CLI 共用的 project API。
- Golden fixture 與 Windows 路徑安全測試基座。

本階段不實作：

- CCv3 編譯與 PNG。
- Token/trigger planner。
- AI 來源提煉。
- Agent、Skill 或 personality profile。
- Dashboard。
- MVU 等選配 plugin。

## 2. 技術決策

- Node.js 20 LTS；目前環境為 `v20.17.0`。
- pnpm `10.34.5` workspace；此版本支援目前的 Node.js 20。透過 Corepack 固定版本，不依賴全域手動安裝。
- TypeScript strict mode、ESM、NodeNext module resolution。
- Zod 4 作執行期 schema。
- `yaml` 作 YAML CST/parse。
- Vitest 作單元與整合測試。
- `fast-check` 作 property tests。
- `fast-json-patch` 或等價小型 RFC 6902 library；採用前驗證 prototype pollution 行為與維護狀態。
- ESLint 9 flat config。
- 不在 Foundation 引入 Next.js、MCP SDK 或 PNG 套件。

## 3. 預定目錄

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.mjs
.gitignore
.npmrc
packages/
  schemas/
    src/
    test/
  project/
    src/
    test/
  cli/
    src/
    test/
  testing/
    src/
    fixtures/
projects/
exports/
docs/
  architecture/
  superpowers/
    specs/
    plans/
```

## 4. 執行順序

### Task 1：切換前檢查與舊系統隔離

**目的**：在不誤刪使用者尚未備份內容的前提下，確立 vNext 的唯一正式入口。

**檢查**：

- 列出舊 `drafts/`、`exports/`、`dashboard/`、`mcp-servers/`、`.agents/`、`.opencode/` 與根層一次性腳本。
- 產生只讀 inventory，記錄檔案數與 hash 摘要。
- 確認使用者備份完成後才執行不可逆刪除。
- 保留已批准的 vNext 主規格、Foundation plan、`CONTEXT.md` 及視覺設計暫存。

**切換**：

- 移除舊程式與舊生成資料，不建立相容 shim。
- 建立空的 `projects/` 與 `exports/`。
- 確認根目錄不存在可誤啟動的舊 `package.json`、舊 MCP build 或舊 Dashboard scripts。

**驗證**：

```powershell
Get-ChildItem -Force
```

人工確認只剩 vNext 文件、上下文與預定根目錄。

### Task 2：建立 monorepo 工具鏈

**新增檔案**：

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `eslint.config.mjs`
- `.npmrc`
- `.gitignore`
- `vitest.workspace.ts`

**根 package scripts**：

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  }
}
```

**要求**：

- `packageManager` 固定精確 pnpm 版本。
- 所有內部 package 使用 `workspace:*`。
- package 預設 `private: true`；未決定發佈策略前不 publish。
- TypeScript 啟用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`。
- 不提交 `node_modules`、build、coverage、`.build` 與 exports 產物。

**驗證**：

```powershell
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install
pnpm check
```

預期：空 package 骨架下所有命令成功，lockfile 與 manifest 一致。

### Task 3：建立 `@card-workspace/schemas`

**新增檔案**：

- `packages/schemas/package.json`
- `packages/schemas/tsconfig.json`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/json.ts`
- `packages/schemas/src/ids.ts`
- `packages/schemas/src/project.ts`
- `packages/schemas/src/workflow.ts`
- `packages/schemas/src/policy.ts`
- `packages/schemas/src/diagnostic.ts`
- `packages/schemas/test/*.test.ts`

**先寫失敗測試**：

- Project ID、character ID、source ID 接受安全 stable ID，拒絕路徑分隔符、`.`、`..`、空字串與控制字元。
- `schema_version` 缺失、未知或錯型時回報可定位錯誤。
- 同角色不能同時宣告 `zhuji` 與 `palette`。
- 多角色可各自採不同模式。
- `extensions` 接受任意合法 JSON 並 round-trip。
- Workflow revision 必須是非負整數且單調更新由 project package 保證。
- Policy rule 必須標記 `normative`、`compatibility` 或 `workspace`。
- Diagnostic 具規則 ID、severity、location、message、evidence 與 fixability。

**實作**：

- `JsonValue/JsonObject` 遞迴 schema。
- Branded stable ID schemas。
- Project Manifest v1 最小 schema。
- Workflow state v1 schema。
- Policy profile v1 schema。
- Structured Diagnostic schema。
- `parseXxx()` 與 `safeParseXxx()` 公開 API，不輸出 Zod internals 給呼叫者。

**驗證**：

```powershell
pnpm --filter @card-workspace/schemas test
pnpm --filter @card-workspace/schemas typecheck
```

### Task 4：建立測試 fixture 工具

**新增檔案**：

- `packages/testing/package.json`
- `packages/testing/tsconfig.json`
- `packages/testing/src/index.ts`
- `packages/testing/src/temp-workspace.ts`
- `packages/testing/src/project-builder.ts`
- `packages/testing/src/assert-diagnostic.ts`
- `packages/testing/fixtures/project-minimal/**`
- `packages/testing/fixtures/project-multi-mode/**`
- `packages/testing/fixtures/project-invalid/**`

**要求**：

- 每個測試使用 OS temp directory，不碰正式 `projects/` 或 `exports/`。
- Fixture builder 只產生 schema-valid 最小資料，不複製 production parser 邏輯。
- Windows 與 POSIX separator 測試都可表達。
- 測試結束清理 temp；失敗時可透過環境變數保留現場。

**測試**：

- 最小單角色 fixture 通過 schema。
- 多角色混合模式 fixture 通過 schema。
- 無效模式、重複 ID、失效引用 fixture 回報全部錯誤。

### Task 5：建立安全路徑與 workspace root

**新增檔案**：

- `packages/project/package.json`
- `packages/project/tsconfig.json`
- `packages/project/src/index.ts`
- `packages/project/src/root.ts`
- `packages/project/src/path-policy.ts`
- `packages/project/src/errors.ts`
- `packages/project/test/path-policy.test.ts`
- `packages/project/test/root.test.ts`

**先寫失敗測試**：

- 拒絕 `../`、`..\`、absolute path、UNC、drive-relative path 與 alternate data stream。
- 拒絕 prefix collision，例如 `card-workspace-evil`。
- 拒絕 symlink/junction 導向 workspace 外。
- 接受 workspace 內已存在的正常檔案。
- 新檔案的 parent realpath 必須仍在 workspace。
- `CARD_WORKSPACE_ROOT` 有效時優先使用；無效時 fail fast。
- 未提供環境變數時由根 marker 向上尋找，不依 `process.cwd()` 猜測 drafts 位置。

**實作**：

- `resolveWorkspaceRoot(options)`。
- `resolveExistingWithin(root, relativePath)`。
- `resolveCreatableWithin(root, relativePath, allowlist)`。
- `assertSafeSegment(value)`。
- 使用 `path.relative` 與 `realpath` 雙重檢查。

**驗證**：

```powershell
pnpm --filter @card-workspace/project test -- path-policy
```

### Task 6：建立 YAML/JSON 解析與聚合診斷

**新增檔案**：

- `packages/project/src/parse.ts`
- `packages/project/src/discover.ts`
- `packages/project/src/load-project.ts`
- `packages/project/test/parse.test.ts`
- `packages/project/test/load-project.test.ts`

**先寫失敗測試**：

- 多個壞 YAML 檔應在一次操作中全部報告。
- 診斷包含相對檔案、行、列與 parser message。
- 重複 YAML key 依 policy 報錯，不靜默取後值。
- JSON syntax error 轉為相同 diagnostic contract。
- 非 UTF-8、過大檔案、非 allowlist extension 明確拒絕。
- Discovery 穩定排序，輸出不受 filesystem enumeration 順序影響。

**實作**：

- `discoverProjectFiles()`。
- `parseYamlDocument()`，保留 CST range 供定位。
- `parseJsonDocument()`。
- `loadProject()` 聚合 parse 與 schema diagnostics。
- Foundation 預設檔案大小限制可配置，超限不讀入。

### Task 7：建立 revision 與 canonical serialization

**新增檔案**：

- `packages/project/src/revision.ts`
- `packages/project/src/serialize.ts`
- `packages/project/test/revision.test.ts`
- `packages/project/test/serialize.test.ts`

**要求**：

- Revision 來自受版本控制的 workflow state，不使用檔案 mtime。
- Canonical JSON 使用穩定 key ordering 與單一 newline policy。
- YAML 僅在目標文件需要修改時序列化；無關檔案 byte-for-byte 不動。
- Hash 使用明確演算法與版本前綴。
- 同一語意輸入在相同 compiler/tooling 版本下產生相同 hash。

**測試**：

- key insertion order 不影響 canonical hash。
- Unicode 不被不必要 escape。
- CRLF/LF 規則明確且可重現。
- 重複執行無修改操作不增加 revision。

### Task 8：建立 RFC 6902 dry-run 與語意 diff

**新增檔案**：

- `packages/project/src/query.ts`
- `packages/project/src/patch.ts`
- `packages/project/src/diff.ts`
- `packages/project/test/query.test.ts`
- `packages/project/test/patch.test.ts`
- `packages/project/test/diff.test.ts`

**先寫失敗測試**：

- Patch 缺 base revision 被拒絕。
- Stale revision 回傳 conflict，不套用任何變更。
- Patch path 不能碰衍生 `.build`、exports 或未允許的 metadata。
- Prototype pollution path 被拒絕。
- Patch 後 schema invalid 時回報 diagnostics 且不寫檔。
- Dry-run 回傳 RFC patch、semantic summary、affected files 與 rebuild scopes。
- No-op patch 不建立交易。

**實作**：

- Typed selectors，不直接暴露任意 filesystem query。
- Patch 在記憶體 clone 上預演。
- 由 ownership map 將 domain path 映射至作者檔案。
- Foundation 僅支援 Project Manifest、Workflow 與 Policy；角色內容在後續 schema 加入後擴充。

### Task 9：建立 journal、備份與原子交易

**新增檔案**：

- `packages/project/src/transaction.ts`
- `packages/project/src/journal.ts`
- `packages/project/src/atomic-write.ts`
- `packages/project/test/transaction.test.ts`
- `packages/project/test/atomic-write.test.ts`

**交易流程**：

1. 取得 project advisory lock。
2. 驗證 base revision。
3. 在記憶體預演 patch 與 schema。
4. 建立 journal 與受影響檔案備份。
5. 在同一 volume 寫 temp files。
6. Flush、依安全順序 rename。
7. 最後更新 workflow revision。
8. 標記 journal committed。
9. 清理可安全刪除的 temp。

**失敗測試**：

- 每一寫入步驟注入故障，最終要不是完整舊狀態就是完整新狀態。
- 程序中止後下次啟動可辨識 incomplete journal 並恢復。
- 兩個 concurrent writer 只有一個成功，另一個收到 revision conflict。
- Strict Windows rename/locked-file 情況有可理解診斷，不留下半套專案。
- 備份 retention 可配置且不刪未完成交易所需檔案。

### Task 10：建立最小 CLI

**新增檔案**：

- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts`
- `packages/cli/src/main.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/validate.ts`
- `packages/cli/src/commands/query.ts`
- `packages/cli/src/commands/patch.ts`
- `packages/cli/src/format.ts`
- `packages/cli/test/cli.test.ts`

**命令**：

```text
card-workspace init <project-id>
card-workspace project validate <project-id> [--json]
card-workspace query <project-id> <selector> [--json]
card-workspace patch <project-id> --file <patch.json> --base-revision <n> --dry-run
card-workspace patch <project-id> --file <patch.json> --base-revision <n> --apply
```

**要求**：

- CLI 只調用 packages API，不重寫 path、parse 或 transaction 邏輯。
- 非互動模式輸出穩定 machine-readable JSON。
- 人類輸出包含規則 ID、位置與修正建議。
- `init` 目標已存在時拒絕，除非未來另設明確選項；Foundation 不提供 overwrite。
- Exit code 區分 usage、validation、conflict、I/O 與 internal error。

### Task 11：建立 CI 與品質閘門

**新增檔案**：

- `.github/workflows/ci.yml`
- `docs/architecture/testing.md`
- `docs/architecture/project-transactions.md`

**CI**：

- Windows 與 Linux matrix。
- Corepack 啟用精確 pnpm。
- `pnpm install --frozen-lockfile`。
- lint、typecheck、test、build。
- Dependency audit 依明確 policy 阻斷 high/critical；例外必須有期限與理由。
- 上傳 coverage 與失敗 fixture artifacts，不上傳來源秘密或正式 projects。

**Coverage 重點**：

- 實作校正：全域 statements/lines 及 functions 不低於 85%，branches 不低於 80%；路徑、patch、交易必須覆蓋本計畫列出的攻擊、競態、rollback 與 crash-recovery 情境。原訂單檔 branch 95% 會迫使測試 mock Node/OS 內部 I/O 故障，降低跨 Windows/Linux 的可信度，因此不採用。
- Coverage 不是唯一門檻；所有列出的風險 fixture 必須存在。

### Task 12：Foundation end-to-end 驗收

**情境 A：建立與驗證**

1. 在 temp workspace 執行 `init demo`。
2. 驗證生成的 project/workflow/policy。
3. Query project title。
4. Dry-run 修改 title。
5. Apply 相同 patch。
6. 驗證 revision +1、其他檔案不變。

**情境 B：衝突與回滾**

1. 以相同 base revision 建立兩個 patch。
2. 第一個成功。
3. 第二個得到 revision conflict。
4. 注入寫入故障。
5. 驗證 project 保持一致且 journal 可恢復。

**情境 C：路徑攻擊**

1. 測試 `../`、UNC、absolute、prefix collision、symlink/junction。
2. 所有 workspace 外讀寫都被阻止。
3. 正常專案內新檔仍可建立。

**完成命令**：

```powershell
pnpm check
pnpm --filter @card-workspace/cli test
```

## 5. Foundation 完成定義

- 乾淨 clone 可用固定 pnpm 完成 frozen install。
- Windows 與 Linux CI 全綠。
- Project Manifest、Workflow、Policy、Diagnostic schema 有版本與測試。
- 所有路徑操作通過 traversal、prefix、symlink/junction 測試。
- Parser 一次回報所有 YAML/JSON 錯誤並提供行列。
- Query 與 Patch 不需重寫整個大型文件。
- Dry-run 不寫入任何檔案。
- Apply 使用 revision、journal、備份與原子 publish。
- 任意注入失敗後專案不處於半寫狀態。
- CLI 與 library 對相同輸入產生相同 diagnostics。
- Foundation 不包含任何假 AI 功能、CCv3 編譯、Agent 性格或 Dashboard 耦合。

## 6. 後續銜接

Foundation 驗收後才撰寫 Forge Core 詳細計畫。Forge Core 將新增：

- Character/World/Greetings 作者 schema。
- Canonical IR。
- Worldbook planner。
- Token/trigger simulator。
- CCv3 JSON 與 PNG adapters。
- 三層 audit 與 round-trip。

Agent 與 Skill 的技術契約會在第 4 工作流實作；personality profile 保留到全部核心工作流與選配插件穩定後，另開最後一份設計與調校規格。
