# 第 8 批：Core 與 Repository 拆分設計

## 目標

將 `packages/core/src/index.ts` 依責任拆成可獨立理解與測試的模組，同時保留既有 `@st-workspace/core` public API 與所有交易語意。這一批只做結構重構，不新增產品功能，也不改變 transaction、rollback、CAS、journal、lock fencing、materialization 或 repair 的結果。

## 邊界與模組

- `project-state.ts`：ProjectState 與 state record 型別、state 建立與共用純函式。
- `project-state-schema.ts`：Zod state schema、legacy migration/backfill 與 state validation。
- `operations.ts`：OperationRecord、OperationCommand schema、legacy command migration/decode。
- `project-projection.ts`：current artifact、Blueprint、intent 與 immutable PublishPlan projection。
- `repository/project-repository.ts`：Repository interface、transaction/write-set、failure injection、lock/recovery contract 型別。
- `repository/memory-project-repository.ts`：MemoryProjectRepository。
- `repository/file-project-repository.ts`：FileProjectRepository 的檔案狀態與 transaction orchestration。
- `repository/transaction-journal.ts`：transaction journal、rollback/recovery、lock lease/fencing helpers。
- `repository/materialization.ts`：materialized files、artifact paths 與 write-set 計算。
- `repository/repair.ts`：repair inspection、repair plan 與 repair execution。
- `index.ts`：compatibility barrel 與仍屬 Core 公用但不屬本批 Repository 的 exports；不得保留已搬移責任的第二套實作。

## 依賴規則

1. state/schema/operations 不依賴 Repository。
2. projection 只依賴 state 型別與純資料解析 helper。
3. Repository modules 依賴 state/schema、operations、Repository contract；不得反向依賴 root barrel。
4. root barrel 只 re-export，避免 consumer import migration 與 circular dependency。
5. Attachment store、card export path、template／interview 等未屬本批的既有功能保持可由 root barrel 取得。

## 行為不變約束

- Memory/File repository public methods、revision CAS 與 cross-instance stale writer 行為不變。
- Transaction journal phase、backup/install/rollback 順序、crash recovery、cleanup retry 與 recovery audit 不變。
- Lock lease、stale takeover、fencing generation 與 project relocation lock 不變。
- Materialized path、character folder naming、published export path 與 repair plan hash 不變。
- `computeProjectProjection`、`computePublishPlan`、`decodeOperationCommand` 的輸出與 legacy compatibility 不變。

## 驗證

- 新增 module export／projection／schema parity tests。
- 既有 transaction、recovery、file-repository、attachment、export-path tests 必須全綠。
- 完成 `pnpm test`、`pnpm typecheck`、`pnpm build`、`git diff --check`。
- audit 文件 `docs/audits/2026-08-11-st-workspace-v3-third-static-audit.md` 不得被修改、stage 或 commit。
