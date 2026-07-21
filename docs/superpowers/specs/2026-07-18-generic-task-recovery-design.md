# 通用 Task Recovery 設計

## 目標

讓 Director 在 Workflow Task 的正常 attempts 已耗盡、且失敗原因屬於暫時性執行故障時，建立一次受控的 successor Task，使 workflow 可以繼續。Recovery 必須保留失敗歷史、維持 exact artifact snapshot、原子重接下游 dependencies，且不得成為內容修訂、政策繞過或無限重試機制。

本設計只處理目前可端到端執行的 `original` 與 `card_import` Workflow Tasks。Source Adaptation、Mode Conversion、Ingestion Jobs、Gates、Preview、Publish、completed Task 修訂與 `needs_user_decision` 不在本切片內。

## Director 工具

新增 Director-only `task_recovery_begin`。

輸入：

- `project_id`
- `task_id`
- `run_id`
- `failure_category`
- `reason`
- `expected_workflow_revision`
- `event_id`
- `occurred_at`

`failure_category` 用於核對 persisted failure metadata。對沒有 typed failure metadata 的 legacy failed Task，Director 可在此明確分類；Engine 不得從自由文字 `failure_summary` 自動推測分類。

工具不需要 target Task 的 lease，但要求呼叫者為 Director，並受 workflow revision CAS、event idempotency 與既有 mutation transaction 保護。

## Failure Metadata

`task_fail` 新增必填 `failure_category`。新失敗除了保留既有 `failure_summary`，還必須持久化 typed failure metadata：

- `category`
- `summary`
- `failed_at`
- `failed_by`
- `attempt`

可恢復分類限定為：

- `provider_timeout`
- `tool_failure`
- `context_limit`
- `session_interruption`
- `temporary_unavailable`

`tool_failure` 僅表示工具 transport 或執行環境的暫時性失敗，不包含工具正常回傳的 domain、validation 或 authorization error。

Failure schema 亦允許記錄以下不可恢復分類，避免 Agent 被迫把真正原因誤標成暫時性故障：

- `invalid_output`
- `revision_conflict`
- `semantic_failure`
- `policy_violation`
- `artifact_integrity`
- `unknown`

上述不可恢復分類，以及 schema 或 ownership 違規、使用者拒絕等語意，不得透過 recovery 處理。這些情況應由既有 correction、revision、clarification、使用者決策或維修流程處理。

一般 `retryable` Task 被重新 claim 時，projection 應清除目前 failure metadata；journal 仍保留先前事件歷史。既有 workflow 中沒有 typed metadata 的 Task 仍可通過 schema，避免破壞持久資料。

## Recovery 前置條件

Engine 必須同時驗證：

1. Workflow 未關閉。
2. Target 是 persisted `failed` Task。
3. Target 已耗盡正常預算，即 `attempt >= max_attempts`。
4. Persisted category 與 request category 一致；legacy Task 沒有 category 時，request category 必須在暫時性 allowlist。
5. Target 屬於目前 stage；沒有 legacy stage metadata 時，其 kind 必須與目前 stage 相容。
6. Workflow 沒有持有效 lease 的 `claimed` Task。
7. Target lineage 尚未建立任何 successor。
8. Successor Task ID 與 decision ID 均不存在。
9. 所有直接 dependents 都維持可安全重接的 `pending` 狀態。

任一條件不成立時，整筆 recovery 拒絕，不修改 projection、journal、Task 或 dependency graph。

## 支援範圍

首版支援以下 Task kinds：

- `create-blueprint`
- `analyze-import`
- `create-character`
- `create-character-module`
- `create-world`
- `review-world`
- `review-character`
- `create-greetings`
- `review-greetings`

Kind 還必須與 target 的實際 workflow entry、目前 stage 及 task metadata 相容。`curate-facts`、`convert-mode` 與 Ingestion Job Tasks 在其端到端 workflow 完成前不得使用通用 recovery。

## Successor 與 Lineage

Successor ID 為 `recover-<run_id>`，由 Engine 建立。原 failed Task 不得重開或重設 attempts，而是改為 `superseded`，並完整保留原 attempts、result reference、failure summary、typed failure metadata 與 extensions。

Successor 複製原 Task 的：

- `kind`
- `assigned_agent`
- `capabilities`
- `input_artifacts`
- `output_contract`
- `dependencies`
- 與執行、ownership、stage 有關的 extensions

Successor 不複製原 Task 的 result、lease、failure metadata、clarifications 或 resume flag。它以 `pending`、`attempt: 0`、`max_attempts: 1` 開始，並記錄：

- `recovery_of`
- `recovery_run_id`
- `recovery_generation: 1`
- `recovery_input_strategy: same_snapshot`

Recovery 只處理暫時性執行故障，因此 successor 必須重用原 Task 的 exact input artifact references，不可自行改成目前最新 artifact snapshot。

同一 lineage 最多只能有一個 successor。Successor 的唯一 attempt 再失敗時轉為 `needs_user_decision`，記錄 `recovery_exhausted` evidence；Director 必須向使用者報告並停止，Engine 不允許建立第二代 successor。

## Dependency 重接

Engine 必須在同一 mutation transaction 內掃描所有直接 dependents。凡 dependency 等於原 failed Task ID 的 `pending` Task，都要把該 dependency 原子替換成 successor ID。其他 dependencies 與 Task 順序維持不變。

若直接 dependent 已是 `claimed`、`retryable`、`failed`、`needs_user_decision`、`completed` 或 `superseded`，代表 graph 與 terminal failure 狀態不一致，Engine 回報 graph error，不做部分重接。間接 dependents 不需修改；它們會沿原 chain 等待已重接的直接 dependent。

Recovery 不刪除或重跑先前 completed Tasks，不覆寫其正式 artifacts，不重建整個 stage，也不重設 Gates 或 Preview。Successor 完成後，原 stage 依正常 routing 繼續。

## Decision 與交易

成功 recovery 要新增 `task.recovery.requested` decision，至少保存：

- `run_id`
- 原 failed Task ID
- successor Task ID
- failure category
- reason
- 原 exact input artifact references
- rewired direct dependent IDs
- `recovery_generation: 1`
- `recovery_input_strategy: same_snapshot`

原 Task supersede、successor 建立、dependency 重接、decision、workflow projection 與 journal 必須由同一 repository transaction 提交。`event_id` 沿用既有 idempotency：相同 event 與 payload 回傳既有結果；相同 event、不同 payload 衝突。不同 event 再次恢復同 lineage則回報 lineage 已存在。

## Character Review 相容入口

保留 `character_review_retry_begin` 工具名稱，避免既有 Director 呼叫立即失效，但其實作改為委派共同 recovery primitive，並套用相同暫時性分類、exact input snapshot、單一 successor generation 與 `max_attempts: 1` 規則。

新 failed Character Review 使用 persisted category。Legacy failed Character Review 沒有 typed category時，專用入口不得自行猜測；Director 應改用 `task_recovery_begin` 明確提供 category 與 reason。

Director prompt 與 orchestration skill 將以 `task_recovery_begin` 作為標準入口；專用工具只保留相容用途。

## 錯誤契約

- `TASK_RECOVERY_TARGET_NOT_FAILED`：target 不是 terminal failed Task。
- `TASK_RECOVERY_ATTEMPTS_NOT_EXHAUSTED`：target 尚未耗盡正常 attempts。
- `TASK_RECOVERY_FAILURE_UNCLASSIFIED`：persisted 與 request 均未提供可驗證分類。
- `TASK_RECOVERY_FAILURE_NOT_RECOVERABLE`：分類不在暫時性 allowlist，或 request 與 persisted category 不一致。
- `TASK_RECOVERY_STAGE_UNSUPPORTED`：entry、stage 或 kind 不支援通用 recovery。
- `TASK_RECOVERY_ACTIVE_LEASE`：workflow 仍有持有效 lease 的 claimed Task。
- `TASK_RECOVERY_LINEAGE_EXISTS`：target 已有 successor，或 recovery generation 已耗盡。
- `TASK_RECOVERY_GRAPH_INVALID`：直接 dependent 不是可安全重接的 pending 狀態。
- `TASK_RECOVERY_ID_CONFLICT`：run 所產生的 Task 或 decision ID 已存在。

Authorization、workflow revision conflict、event idempotency conflict 與 transaction failure 沿用既有錯誤契約。

## 測試

回歸測試至少覆蓋：

- `task_fail` 在預算未耗盡時轉 `retryable`，耗盡時轉 `failed`，並持久化 typed failure metadata。
- Retryable Task reclaim 時清除目前 failure metadata。
- Recovery successor 的唯一 attempt 失敗後轉 `needs_user_decision`，且不可再次 recovery。
- 所有 allowlisted kind 與 stage 的成功矩陣。
- 原 failed Task 被 supersede 且完整保留，successor 使用 exact input snapshot、正確 lineage 與一次性預算。
- 直接 pending dependents 原子重接，間接 dependents 與平行 chains 不受影響。
- 非暫時性分類、分類不一致、未耗盡、非 failed、錯誤 stage、unsupported kind、active lease、重複 lineage、ID conflict 與異常 dependent 狀態均被拒絕。
- Legacy failed Task 可由 Director 明確分類後恢復；未提供分類時拒絕。
- `character_review_retry_begin` 與 generic primitive 共用相同 invariant。
- Director-only authorization、不需 target lease、非 Director 拒絕、closed workflow 拒絕、工具 visibility 與 schema contract。
- Workflow revision CAS、event idempotency、transaction failure不留下半 successor 或半 dependency rewiring、journal rebuild 保留 recovery lineage。

驗證命令包含 targeted Vitest、完整 Vitest、TypeScript、ESLint、Agent lint 與 build，並確認 runtime dist 已註冊新工具。測試與實作不得修改 `projects/*`。

## 文件同步

同步更新：

- Director prompt
- Director orchestration skill
- workflow routing reference
- MCP tool registry與handler
- tool policy
- agent registry capability
- agent-lint tool registry

文件必須明確區分：

- `retryable` 是正常 attempts 尚未耗盡。
- `task_recovery_begin` 是 terminal transient failure 的唯一一次 successor。
- completed內容變更仍使用角色、世界或 Greetings revision tools。
- `needs_user_decision`、semantic failure與artifact integrity failure不得用 recovery繞過。

## 非目標

- 不重開原 failed Task或重設其 attempts。
- 不提供無限 successor generations。
- 不依自由文字摘要自動分類失敗。
- 不將 invalid proposal、revision conflict、semantic finding或使用者拒絕視為暫時性故障。
- 不全面重構 Workflow Task schema或 `extensions` typed state。
- 不完成 Source Adaptation、Mode Conversion、專案 archive／restore或跨專案衍生。
