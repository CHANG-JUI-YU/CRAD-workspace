# V3 Fact Review 與舊版分工式嚴格裁決實作計畫

## Status

實作尚未開始；本計畫對應已獲使用者確認的 spec：

`docs/superpowers/specs/2026-08-09-fact-review-legacy-alignment-design.md`

本計畫只處理 Source Adaptation 的 Facts Review 與 Facts Gate。CCv3/PNG compiler、交易、跨實例 CAS、一般 artifact review 與原創角色流程不在範圍內。

## 1. 建立回歸基線與合約盤點

先不改程式，記錄目前狀態：

- 執行 `pnpm typecheck`。
- 執行 `pnpm test -- --maxWorkers=1`。
- 執行 `pnpm agent:lint`。
- 若 coverage 腳本可用，執行 `pnpm test:coverage -- --maxWorkers=1`。
- 盤點現有 `fact_review_passes` fixture、template proposal fixture、state JSON 與舊專案讀取路徑。

確認目前公開合約與限制：

- `packages/core/src/index.ts` 的 `FactRecord`、`FactReviewPassRecord`、`ProjectState`。
- `packages/core/src/templates.ts` 的 `factDecisionSchema` 與 `factReviewProposalValueSchema`。
- `packages/domain/src/knowledge.ts` 的 `applyCuration`、`applyReview`。
- `packages/domain/src/workflow-gate.ts` 的 `reportFacts`。
- `packages/runtime/src/index.ts` 的 `templateContext`、`submitTemplateProposal`、`sourceFactsReady`。
- `packages/runtime/src/agent-registry.ts` 與 `.agents/registry.yaml` 的三個 Reviewer identity。

驗收：基線結果已保存於實作紀錄；後續每個階段都能辨識是新失敗或既有失敗。

## 2. Core schema：Review Run、candidate lineage 與 decision history

目標檔案：

- `packages/core/src/index.ts`
- `packages/core/src/templates.ts`
- `packages/core/src/fact-provenance.ts`
- 對應 `packages/core/test/*`

工作內容：

1. 新增 `FactReviewRunRecord` 與 schema，至少保存：
   - `id`、`curation_run_id`
   - active candidate occurrence IDs
   - candidate set revision
   - source ID／source revision 清單
   - policy revision
   - `open/blocked/completed/superseded` 狀態
   - 建立與完成 audit 欄位
2. 新增 `FactReviewDecisionRecord` 與 schema，保存：
   - Review Run ID
   - exact candidate occurrence ID
   - reviewer identity
   - accepted/rejected/needs_evidence/conflict
   - reason、structured evidence、source/chunk revision
   - expected projection revision、resulting fact revision
   - 建立時間與 operation ID
3. 保留 `fact_review_passes` schema 作為 legacy read compatibility；新 gate 不再把 `pass: 1/2/3` 當 quorum。
4. 為 `FactRecord` 補足可驗證的 current revision 與 structured provenance；保留現有 `evidence: string[]` 讀取相容，新增欄位不可破壞舊 state。
5. 為 Fact candidate 建立穩定 occurrence lineage：curation batch、source、source revision、chunk、chunk hash 與 Fact 的對應必須可回溯。
6. 明確區分：
   - `needs_evidence` 是未完成，不是 rejected。
   - `conflict` 是待 Director resolution，不是 reviewer 自動選邊。
   - legacy 無法安全映射的 record 維持 unresolved。

驗收：新舊 state 都能通過 schema；新資料可保存 Review Run、structured decision 與 provenance；既有 `fact_review_passes` 不會被刪除或誤當成新 quorum。

## 3. Knowledge domain：嚴格裁決與 CAS 單次現行決策

目標檔案：

- `packages/domain/src/knowledge.ts`
- `packages/domain/src/review.ts`（若需要共用 decision/audit helper）
- `packages/domain/src/fact-provenance.ts`（若存在或新增）
- `packages/domain/test/knowledge-authoring-review.test.ts`
- 新增 `packages/domain/test/fact-review-run.test.ts`

工作內容：

1. 將 Fact curation 的每一筆 claim 物化為帶 occurrence lineage 的 candidate；不可只生成無法對應來源的 internal Fact ID。
2. 新增 `beginFactReviewRun`：
   - 僅接受已完成的 curation run。
   - 鎖定 active candidate occurrence 與 source revisions。
   - 同一 curation run 重複建立時採 idempotent 行為。
3. 重寫 `applyReview`／新增 `applyReviewBatch`：
   - 只接受 Review Run 內的 exact candidate occurrence ID。
   - 批次內 candidate ID、decision ID 唯一。
   - 以 expected projection revision 做 CAS。
   - 若候選已被其他 Reviewer 裁決，回傳可恢復的 `FACT_CANDIDATE_NOT_ACTIVE` 或已完成摘要，不覆寫現行決策。
   - 同一 Review Run、同一候選不可產生第二筆 current decision；重審必須使用 successor Review Run。
4. 對 accepted decision 執行 hard validation：
   - source、source revision、chunk、chunk hash 必須存在且與 Review Run 一致。
   - quote 與 locator 必須能在 immutable chunk 中驗證。
   - statement 必須是原子命題、classification 正確、uncertainty 保留。
   - 品質診斷存在時拒絕 accepted。
5. 對 rejected、needs_evidence、conflict 寫入完整 reason/evidence/audit；`needs_evidence` 不改成 accepted/rejected。
6. accepted claims 造成互斥 predicate 時建立或更新 conflict register；Reviewer API 不提供 conflict resolve。
7. 每次 mutation 都追加 audit/journal，包含 actor、reviewer identity、Review Run、expected/supplied revisions、candidate IDs 與 decision hash。

驗收：兩個 Reviewer 同時提交同一候選時只有一個成功；stale 的另一個可以重讀並繼續剩餘候選；任何缺 provenance 或品質不合格的 accepted decision 都被拒絕。

## 4. Runtime：固定 Review Run context 與三 replica 路由

目標檔案：

- `packages/runtime/src/index.ts`
- `packages/runtime/src/agent-registry.ts`
- `packages/runtime/test/templates-runtime.test.ts`
- `packages/runtime/test/runtime.test.ts`
- 必要時 `packages/server/src/index.ts` 與 server tests

工作內容：

1. 新增 `factReviewStatus`／`factReviewContext` 內部方法，回傳：
   - Review Run 摘要
   - bounded unreviewed page
   - exact candidate occurrence IDs
   - source/chunk evidence
   - current projection revision
   - quality diagnostics、coverage、open conflicts
2. `templateContext("fact_review")` 必須讀取固定 Review Run，而不是只讀當下會被前一位 Reviewer 改動的 `facts` 狀態。
3. `submitTemplateProposal` 的 fact review 分支改為：
   - 解析 agent identity。
   - 要求明確的內部 reviewer assignment；不再固定 default 到 reviewer-1。
   - 將 proposal 的 decisions 交給 domain batch CAS。
   - 寫入 fact-review artifact 僅作可追溯報告，不將 artifact 當作 Fact adjudication 的唯一來源。
4. 移除 `review_pass` 對 domain 行為的依賴；三個 registry agent 仍保留同一 prompt、skill、personality 與 `read_only`，但透過 identity 區分 reviewer。
5. 遇到 `FACT_PROJECTION_STALE`、`FACT_CANDIDATE_NOT_ACTIVE`、`FACT_REVIEW_RUN_STALE` 時，回傳可恢復結果與下一步，不讓整批 operation 永久卡死。
6. `sourceFactsReady` 改讀新 Review Run／current decision／Gate status，不再檢查每個 Fact 的 pass 1/2/3。

驗收：三個 reviewer 都能被路由；同一 Review Run 的三個 context 具有相同來源／候選 revision；未指定 reviewer 時 runtime 不會永遠落到 reviewer-1。

## 5. Workflow Gate：改為一次裁決完整性與 strict fail-closed

目標檔案：

- `packages/domain/src/workflow-gate.ts`
- `packages/domain/test/workflow-gate.test.ts`
- 必要時 `packages/runtime/src/index.ts` 的 authoring guard tests

工作內容：

1. 移除 `FACT_REVIEW_QUORUM_INCOMPLETE` 的 pass 1/2/3 計算。
2. 新增／改寫 diagnostics：
   - `FACT_REVIEW_RUN_MISSING`
   - `FACT_REVIEW_CANDIDATE_UNREVIEWED`
   - `FACT_REVIEW_NEEDS_EVIDENCE`
   - `FACT_REVIEW_SNAPSHOT_STALE`
   - `FACT_PROVENANCE_INVALID`
   - `FACT_REVIEW_CONFLICT_OPEN`
   - `FACT_COVERAGE_INCOMPLETE`
3. Gate 必須確認所有 active candidate 都有一筆有效 current decision；needs_evidence、open conflict、source drift、invalid provenance 均 fail closed。
4. 延續舊版 coverage：primary character 必須有 identity/personality/speech/habits/background/relationships，並具備 appearance/goals/abilities/world_context 其中一項；supporting character 必須有 identity/personality/relationships。
5. Gate 輸出目前 exact Fact／Conflict register refs；不接受自行計算或舊 revision。
6. Facts Gate 成功後才允許 Blueprint 後的 World／Character／Zhuji／Palette authoring；原創流程維持既有行為。

驗收：只要有一筆未審核、needs_evidence、open conflict、coverage 不足或 snapshot stale，World/Character authoring 都會被可恢復地阻擋。

## 6. Agent、Skill 與文件對齊

目標檔案：

- `.agents/registry.yaml`
- `.agents/agents/fact-reviewer.md`
- `.agents/skills/fact-review/SKILL.md`
- `.agents/skills/fact-review/references/review-guidelines.md`
- `.agents/agents/director.md`
- `.agents/skills/director-orchestration/SKILL.md`
- `.agents/skills/director-orchestration/references/workflow-routing.md`
- `README.md`、Facts／workflow 相關 docs

工作內容：

1. 將三個 Reviewer 定義為 replica identity，不再在 prompt 中描述三輪 pass 或三票 quorum。
2. 複製舊版 strict guidelines：逐字 evidence、原子 statement、分類、不確定性、placeholder/test/dummy/fixture、source discipline、conflict 只回報。
3. 明確要求 Reviewer：
   - 先讀 unreviewed bounded page。
   - 使用 exact candidate occurrence ID。
   - 以 batch CAS 提交。
   - stale 時重讀並跳過已裁決候選。
   - 不詢問使用者、不修改來源、不解 conflict。
4. Director 只向使用者呈現高階摘要；revision、candidate ID、CAS、reviewer assignment 由 Agent/Runtime 內部處理。
5. Director prompt 改為：三個 reviewer 共同處理一個固定 Review Run，並在 Facts Gate 通過前禁止正式 authoring。
6. 更新現有二創 spec 中「三輪 Fact Reviewer」的描述，改為本計畫的 replica 分工語義；保留舊 spec 作歷史但標明本 spec 優先。

驗收：`pnpm agent:lint` 通過；Agent/Skill/Personality 綁定完整，且 prompt 不再要求三輪 quorum。

## 7. Migration、匯出與 recovery

目標檔案：

- `packages/core/src/index.ts` 的 state parser／export
- `packages/runtime/src/index.ts` 的 state migration
- `packages/cli` 或 project materialization/export 相關檔案
- migration tests

工作內容：

1. 讀取舊 V3 state 時保留 `fact_review_passes`，建立 legacy decision history；不自動把三個 pass 合併成同一新 Review Run，除非 candidate/source lineage 可安全確認。
2. 對沒有 occurrence lineage 的舊 Fact，標記為 unresolved，要求重新 curation/review；不可猜測 candidate 對應。
3. Export 的 `facts/register.json` 同時輸出：
   - current Fact projection
   - current Review Run 摘要
   - decision history／provenance
   - conflicts 與 coverage 摘要
4. 新 source revision 或 re-curation 建立 successor Review Run，保留 predecessor、舊 audit 與舊 Gate refs，但將下游 refs 標 stale。
5. migration 與 recovery 都必須可重試、不可刪除使用者專案資料。

驗收：舊專案可讀取並呈現歷史；無法安全判定的舊資料不會錯誤通過 Facts Gate；新 Review Run 的輸出可完整追溯來源。

## 8. 測試矩陣

新增或更新：

- Core schema tests：Review Run、decision、structured evidence、legacy parse、strict enum。
- Domain tests：curation lineage、begin run、single current decision、CAS race、duplicate candidate、needs_evidence、conflict、provenance drift。
- Runtime tests：三 agent routing、same Review Run context、bounded page、stale retry、no reviewer-1 fallback、fact-review artifact/history。
- Gate tests：unreviewed、needs_evidence、open conflict、coverage、stale snapshot、exact refs、原創流程不受影響。
- Migration tests：舊 pass records、無 lineage legacy facts、re-curation successor、export shape。
- Agent lint tests：三個 identity、同一 skill/prompt/personality、read-only、無 quorum wording。
- End-to-end fixture：來源批准 → fetch → curation → 三 replica 分工 → Facts Gate → Blueprint/World/Character authoring。

## 9. 驗證與交付順序

每個階段完成後執行相關 package tests；全部階段完成後執行：

```text
pnpm typecheck
pnpm test -- --maxWorkers=1
pnpm agent:lint
pnpm test:coverage -- --maxWorkers=1
```

交付時回報：

- 修改檔案與 state/schema migration 說明。
- 三 replica routing、CAS、strict evidence、Gate 與 recovery 的測試結果。
- 舊專案相容性結果。
- coverage 變化與仍未完成的非阻塞工作。

完成標準：V3 不再要求每個 Fact 有 pass 1/2/3；三個獨立 Reviewer 能安全分工處理同一固定 Review Run；任何缺證據、品質問題、來源漂移、未解衝突或 coverage 不足都無法通過 Facts Gate；使用者不需處理底層參數。
