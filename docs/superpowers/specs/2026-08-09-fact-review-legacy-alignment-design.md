# V3 Fact Review 與舊版分工式嚴格裁決對齊設計

日期：2026-08-09  
狀態：待使用者審核  
適用範圍：`source_adaptation` 的來源、事實提煉與 Facts Gate  

本規格取代 V3 目前「每筆事實必須 pass 1/2/3」的 Fact Review 語義；它不改變原創角色不需要來源審核的流程，也不處理 CCv3 compiler、交易或跨實例 CAS。

## 1. 決策摘要

V3 對齊舊版的 Fact Review 行為：

1. `fact-reviewer-1/2/3` 是三個獨立的 trusted identity replica，不是三輪投票者。
2. 三者共享同一個 Review Run 的候選池、來源 revision 與審核規則，但分工處理未審核候選。
3. 每個 active candidate 只需要一次成功的現行裁決；同一候選的競爭提交由 CAS 決定唯一成功者。
4. 審核結果使用 append-only 歷史保存；現行 Fact projection 只保留目前有效裁決。
5. `accepted` 必須同時滿足逐字證據、原子性、分類、不確定性與品質檢查；任何一項不足都不得接受。
6. 不確定候選保留為 `needs_evidence`／未完成狀態，交由 Director 處理，不得被默默視為 accepted 或 rejected。
7. conflict 由引擎建立、由 Director 裁決；Fact Reviewer 不得自行解決。
8. 使用者不需要看到 candidate ID、projection revision、CAS 或其他底層參數；這些由 Director 與引擎內部處理。

舊版對照來源：

- 三個獨立身分：[workflow/agent-registry.yaml](C:/AI/projects/ST-workspace/workflow/agent-registry.yaml:41)
- 分頁、獨立裁決、CAS 重試規則：[.agents/skills/fact-review/SKILL.md](C:/AI/projects/ST-workspace/.agents/skills/fact-review/SKILL.md:1)
- 嚴格證據與品質規則：[review-guidelines.md](C:/AI/projects/ST-workspace/.agents/skills/fact-review/references/review-guidelines.md:1)
- projection revision 與 append-only decision journal：[review.ts](C:/AI/projects/ST-workspace/packages/ingestion/src/review.ts:92)

## 2. 現況問題

目前 V3 有以下互相連動的缺口：

- `fact_review_passes` 將 pass 1、2、3 當成每筆 Fact 的必要 quorum，與舊版的 replica 分工語義不同。
- `applyReview` 直接讀取當下 `facts` 並立即改變 status/evidence；後續 Reviewer 可能看到前一位寫回的狀態，而不是同一個固定輸入。
- `FactReviewPassRecord` 沒有保存 candidate set、來源 revision 或 review snapshot。
- `defaultAgentForTemplate("fact_review")` 預設永遠選 `fact-reviewer-1`；單純重複提交不保證三個 trusted identity 都被使用。
- Facts Gate 目前只檢查三個 pass record 是否存在，不檢查候選是否來自同一個審核批次、證據版本是否一致或是否有 unresolved review。

## 3. 目標與非目標

### 3.1 目標

- 讓 V3 的 Fact Review 行為與舊版的三個獨立 reviewer replica 對齊。
- 讓所有 Reviewer 使用同一個不可變的候選／來源輸入集合，但可以安全分工。
- 保留舊版嚴格的 evidence、provenance、品質診斷、coverage、conflict 與 CAS 門檻。
- 讓同一候選的併發提交可恢復，不因 stale 造成整批流程卡死。
- 讓 re-curation 或來源 revision 變更後，舊審核不會誤用於新內容。
- 保留既有專案與歷史決策，不進行破壞性刪除。

### 3.2 非目標

- 不建立「三位 Reviewer 對每一筆事實各投一票」的 quorum 系統。
- 不讓 Reviewer 代替 Director 解決 conflict 或作創作決策。
- 不把原作 Fact 自動寫入角色模組；Creator 仍須透過明確 provenance/fact refs 引用。
- 不改動 CCv3／PNG compiler、交易、跨實例 CAS 或 publish editable gate。

## 4. 核心概念

### 4.1 Review Run

一次 Fact Review 只針對一個已完成的 curation run 建立。Review Run 固定：

- `curation_run_id`
- active candidate occurrence IDs
- candidate set revision
- 每個候選所引用的 source revision、chunk set revision 與 chunk hash
- 審核規則版本與品質政策快照
- 建立者、建立時間與狀態

來源或候選內容不可在同一 Review Run 內被靜默替換。若內容需要更新，必須建立新的 curation／Review Run。

### 4.2 Replica Reviewer

三個 Reviewer 使用相同 prompt、skill、人格與輸出規則，但 trusted identity 必須分離：

```text
fact-reviewer-1
fact-reviewer-2
fact-reviewer-3
```

三者可以讀取同一個 Review Run，但不得讀取或依賴其他 Reviewer 的尚未完成裁決。實際分工由未審核分頁與 CAS 競爭自然形成，不需要人工協調。

### 4.3 現行裁決與歷史

每個 candidate occurrence 在同一 Review Run 只能有一筆現行裁決。所有提交仍寫入 append-only 歷史，供追溯與診斷使用。

若需要重審，建立新的 Review Run 或明確的 re-review successor，不覆寫舊 journal。

## 5. 資料模型

### 5.1 `FactReviewRun`

概念欄位：

```ts
type FactReviewRun = {
  schema_version: 1;
  id: string;
  curation_run_id: string;
  candidate_set_revision: string;
  candidate_occurrence_ids: string[];
  source_revisions: Array<{
    source_id: string;
    revision: string;
  }>;
  policy_revision: string;
  status: "open" | "blocked" | "completed" | "superseded";
  created_by: string;
  created_at: string;
  completed_at?: string;
};
```

### 5.2 `FactReviewDecision`

概念欄位：

```ts
type FactReviewDecision = {
  schema_version: 1;
  id: string;
  review_run_id: string;
  candidate_occurrence_id: string;
  fact_id?: string;
  reviewer_identity: string;
  decision: "accepted" | "rejected" | "needs_evidence" | "conflict";
  reason: string;
  evidence: Array<{
    source_id: string;
    source_revision_id: string;
    chunk_set_id: string;
    chunk_id: string;
    chunk_hash: string;
    quote: string;
    character_range?: { start: number; end: number };
    line_range?: { start: number; end: number };
  }>;
  candidate_revision: string;
  expected_projection_revision: string;
  resulting_fact_revision?: number;
  created_at: string;
};
```

實際實作可保留目前 `fact_review_passes` 作為相容讀取欄位，但新流程不得再把 `pass: 1/2/3` 當成 Gate quorum。新欄位應表達 reviewer identity、Review Run 與候選版本。

### 5.3 舊資料相容

- 舊 `fact_review_passes` 保留為歷史資料，不刪除。
- 讀取舊專案時，可將每個 pass record 映射成 legacy decision history。
- 新 Facts Gate 不依賴 pass 數量；只接受具備有效 Review Run、candidate occurrence、provenance 與現行裁決的資料。
- 無法安全映射的舊記錄標記為 legacy/unresolved，不得自動提升為 accepted。

## 6. 審核流程

```text
Fact Curator 完成
        │
        ▼
建立固定 Review Run
        │
        ├── reviewer-1 讀取未審核分頁
        ├── reviewer-2 讀取未審核分頁
        └── reviewer-3 讀取未審核分頁
                │
                ▼
逐筆嚴格裁決 → 批次提交 → CAS
                │
        ┌───────┴────────┐
        │                │
   成功寫入         projection stale／候選已裁決
        │                │
        │          重新讀取並跳過已完成候選
        ▼                │
   更新現行 projection ◄┘
                │
                ▼
全部候選完成 → conflict/coverage/provenance 檢查
                │
                ▼
             Facts Gate
```

規則：

1. 每次 Reviewer 只取得 bounded page，不要求一次載入整個來源或候選池。
2. 提交使用 exact candidate occurrence ID，不接受 Curator 原始裸 ID 或模糊 claim 對應。
3. 批次內 candidate ID 與 decision ID 必須唯一。
4. 提交必須帶最近讀取到的 projection revision；revision 不符時，重新讀取並只處理仍未完成的候選。
5. 若候選已由其他 Reviewer 成功裁決，回報為已完成，不視為整批失敗。
6. Reviewer 不得在同一操作中建立來源、修改候選、解決 conflict 或創作內容。

## 7. 嚴格裁決契約

### 7.1 `accepted`

只有以下條件全部成立時才可 accepted：

- statement 是一個獨立、原子的命題。
- evidence 的 quote 可在 verified chunk 中逐字找到。
- statement 沒有超出、改寫或斷章取義 evidence。
- classification 與來源內容相符。
- 不確定性、時間、範圍與角色關聯標記完整。
- 沒有 placeholder、test、dummy、fixture 或其他品質診斷。
- provenance 指向目前 Review Run 鎖定的 source revision 與 chunk hash。

### 7.2 `rejected`

以下任一情況必須 rejected：

- evidence 不存在、無法逐字對應或不足以支持 statement。
- 一筆候選包含多個可獨立判定的命題。
- 官方設定、推測、傳聞或粉絲創作分類錯誤。
- statement 超出來源能證明的範圍。
- 存在品質診斷，包含 test、placeholder、dummy、fixture 等標記。
- 在 source adaptation 中把無來源的創作補完偽裝成原作事實。

### 7.3 `needs_evidence`

遇到來源不足、範圍不清、時間線不確定或無法安全判定時：

- 不得猜測為 accepted。
- 不得為了讓流程前進而直接 rejected。
- 保留候選為 unresolved/pending。
- 回報 Director，必要時追加來源或啟動 re-curation。
- `needs_evidence` 永遠不能通過 Facts Gate。

### 7.4 `conflict`

互相矛盾的 accepted claims 由引擎建立 conflict register。Reviewer 只提供證據與衝突摘要，不得選邊、合併或關閉 conflict。只有 Director 的明確 `conflict_resolve` 才能解除阻塞。

## 8. 證據與品質門檻

### 8.1 Provenance

source-derived Fact 必須保存並驗證：

- source ID 與 source revision
- chunk set ID、chunk ID、chunk hash
- quote 與字元／行範圍
- candidate occurrence 與 candidate batch lineage

搜尋 snippet、未批准 URL、研究員口述或外部常識不得作為 evidence。

### 8.2 品質診斷

Fact Curator 與 Fact Reviewer 都可以回報品質問題，但 Reviewer 不得修改候選。品質診斷至少涵蓋：

- placeholder/test 語意
- 空泛或不可驗證 statement
- evidence 與 statement 不一致
- 不確定性被過度簡化
- classification、scope、valid time 缺失或錯置

### 8.3 Coverage

Facts Gate 延續舊版 coverage 規則：

- primary character 至少涵蓋 identity、personality、speech、habits、background、relationships，並另外涵蓋 appearance、goals、abilities、world_context 其中至少一項。
- supporting character 至少涵蓋 identity、personality、relationships。
- rejected、needs_evidence、conflict 或 creative completion 不得被當作 source-derived accepted coverage。

## 9. Agent 與路由

Registry 必須保留三個獨立 agent ID，且三者共用審核規則但不共用身份：

```yaml
fact-reviewer-1:
  shared_executor: fact-reviewer
  read_only: true
fact-reviewer-2:
  shared_executor: fact-reviewer
  read_only: true
fact-reviewer-3:
  shared_executor: fact-reviewer
  read_only: true
```

不再使用 `review_pass` 表示 quorum。Director／scheduler 必須明確委派其中一個 agent；若未指定，Runtime 應選擇下一個可用 replica，而不是固定回傳 reviewer-1。

三個 agent 不得：

- 自審自己建立的 Fact proposal
- 讀取其他 Reviewer 的未提交草稿或決策理由
- 修改 source、candidate 或 conflict resolution
- 以外部知識取代來源證據

## 10. Facts Gate

Facts Gate 必須確認：

1. Review Run 對應目前最新 completed curation。
2. 所有 active candidate occurrence 都有一筆有效現行裁決。
3. 沒有 `needs_evidence`、未審核候選或 open conflict。
4. accepted Fact 的 evidence 與 source/chunk revision 完全一致。
5. coverage、品質診斷與 provenance 均通過。
6. Gate 使用目前 exact register revisions；舊 revision 或自行計算的 ref 必須拒絕。

只要來源、candidate set、Fact projection 或 conflict register 變更，Gate snapshot 立即 stale，必須重新取得狀態。

## 11. Recovery 與 re-curation

- `FACT_PROJECTION_STALE`：Reviewer 自動重讀狀態，繼續未完成候選，不把 stale 視為整個流程失敗。
- `FACT_CANDIDATE_NOT_ACTIVE`：候選已被其他 Reviewer 裁決或已不屬於本輪，跳過並繼續。
- source revision drift：停止該 Review Run，建立新的 curation／Review Run。
- `needs_evidence`：由 Director 選擇追加來源、要求重提煉或保留阻塞；不可自動接受。
- open conflict：由 Director 明確選擇 choose-one、coexist、temporal、scope split、supersede 或 unresolved。
- re-curation 必須保留 predecessor、建立新的 run identity，並使舊 Facts/Blueprint/Content/Publish refs stale。

所有失敗與重試都保留 audit 與 journal，不刪除原候選或舊審核。

## 12. 使用者體驗

使用者只看到高階進度：

```text
事實審核：已完成 38 / 52
待補證據：4
衝突：1
覆蓋率：尚未達標
```

使用者不需要填寫 reviewer ID、candidate ID、batch ID、projection revision 或 CAS 參數。只有遇到 `needs_evidence`、open conflict 或 coverage 不足時，Director 才提出簡短、可理解的補充問題。

## 13. 實作分層

實作時依下列順序切分：

1. Core schema：新增 Review Run、candidate occurrence 與 decision/history 形狀，保留舊 state 讀取。
2. Knowledge domain：改為單次現行裁決、CAS、append-only history 與嚴格 provenance 驗證。
3. Runtime routing：移除 reviewer-1 固定預設，加入三個 replica 的顯式內部委派。
4. Workflow gate：移除 pass 1/2/3 quorum，改檢查 Review Run 完整性、未完成項、conflict、coverage 與 exact refs。
5. Agent/skill：將舊版 strict guidelines 合併至 V3 Fact Reviewer skill 與 personality；不改變 agent 個性。
6. Export：`facts/register.json` 同時輸出現行 Fact projection、Review Run 摘要與可追溯 decision history。
7. Migration：為現有 v3 專案建立相容的 legacy decision history，無法安全判定者保持 unresolved。

## 14. 測試與驗收條件

必須新增或更新測試：

- 三個 reviewer identity 都能被明確路由，且不會全部落到 reviewer-1。
- 三個 reviewer 讀取同一 Review Run 的 candidate/source revisions。
- 同一候選併發提交時只有一個成功，其他提交可恢復且不覆寫。
- 每個候選只產生一筆現行裁決，不需要三個 pass record。
- evidence quote、source revision、chunk hash 不符時拒絕。
- 非原子、錯分類、placeholder、test、dummy、fixture 候選不能 accepted。
- `needs_evidence`、open conflict、coverage 不足時 Facts Gate fail closed。
- conflict 只能由 Director resolution 關閉。
- source revision 改變後，舊 Review Run 與 Gate refs 變 stale。
- re-curation 保留歷史並建立新的 Review Run。
- 舊 `fact_review_passes` 專案可讀取，但不會錯誤通過新 quorum 規則。
- 原創流程不被新增的 source adaptation Facts 前置影響。

驗收標準是：在不要求使用者處理底層參數的前提下，V3 的 Fact Review 能重現舊版的三 replica 分工、嚴格 evidence/provenance 裁決、CAS 競爭處理、conflict/coverage gate 與可恢復 re-curation 行為。

## 15. 待審核決策

本 spec 已將以下決策固定：

- 採用舊版「分工式單次裁決」，不採用三票 quorum。
- 保留三個獨立 Fact Reviewer trusted identities。
- 對 source adaptation 使用不可變 Review Run 與 strict evidence gate。
- `needs_evidence` 不能通過 Facts Gate。
- conflict 由 Director 解決，Reviewer 只回報。

使用者審核此 spec 後，才進入實作計畫與程式修改。
