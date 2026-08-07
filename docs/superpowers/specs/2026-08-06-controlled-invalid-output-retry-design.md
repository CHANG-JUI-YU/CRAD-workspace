# 受控 invalid_output 重開機制設計（Controlled Invalid-Output Retry）

日期：2026-08-06
狀態：已實作（task_retry_begin / beginTaskRetry）
關聯：2026-07-18-generic-task-recovery-design.md

## 背景

ghislaine-mushoku（source_adaptation）authoring 階段 create-character-module 任務
（inner_nature）以 `invalid_output` 失敗（attempt 3/3）：zhuji-creator 的 MCP 提交
參數生成缺陷導致 proposal 遭引擎拒絕，內容已完整產出但未寫入。下游 5 個模組任務
被依賴阻擋，workflow 卡死在 authoring。

`invalid_output` 不在 generic recovery 的可恢復分類白名單
（provider_timeout / tool_failure / context_limit / session_interruption /
temporary_unavailable），`beginTaskRecovery` 回傳 TASK_RECOVERY_FAILURE_NOT_RECOVERABLE。
設計上不可恢復分類意涵「不應自動重試」，但本案例失敗源於工具呼叫參數形狀，
而非內容品質——需要一個 Director 顯式授權的受控重開，而不是自動恢復。

## 決策

新增 Director-only 受控重開機制（方案 2），與 generic recovery 並行、不更動既有
recovery 白名單。不做專用提交工具（方案 3）與 skill 改進（方案 4）。

## 機制

- 工具：`task_retry_begin`（MCP，Director-only，mutation，無需 task lease）。
- runtime：`beginTaskRetry`。
- 前置條件（任一不符即拒絕，錯誤碼如下）：
  - actor 為 director（TASK_RETRY_DENIED）
  - workflow 未 closed（WORKFLOW_CLOSED）
  - target 存在且 status=failed（TASK_RETRY_TARGET_NOT_FAILED）
  - attempt >= max_attempts（TASK_RETRY_ATTEMPTS_NOT_EXHAUSTED）
  - failure.category === "invalid_output"（TASK_RETRY_CATEGORY_NOT_ELIGIBLE）
  - 無既有 lineage：target 無 recovery_of/recovery_generation/retry_of/retry_generation，
    且無任何 task 的 retry_of===target.id 或 recovery_of===target.id
    （TASK_RETRY_LINEAGE_EXISTS）
  - entry_kind ∈ genericRecoveryEntries 且 kind 對應的 recoveryStagesByKind 含目前
    stage 且 extensions.stage 一致（TASK_RETRY_STAGE_UNSUPPORTED）
  - 無 active lease（TASK_RETRY_ACTIVE_LEASE）
  - 直接 dependent 全為 pending（TASK_RETRY_GRAPH_INVALID）
  - successor id `retry-<runId>` 與 decision id `task-retry-<runId>` 不衝突
    （TASK_RETRY_ID_CONFLICT）

## 與 generic recovery 的區別

| 面向 | generic recovery | 受控 retry |
| --- | --- | --- |
| 失敗分類 | 暫時性五類 | 僅 invalid_output |
| 觸發 | Director 工具 | Director 工具（同一人） |
| successor 前綴 | recover- | retry- |
| attempt 額度 | 1 次 | target 完整 max_attempts |
| extensions | recovery_of / recovery_generation | retry_of / retry_generation: 1 |
| decision kind | task.recovery.requested | task.retry.requested |
| input 策略 | same_snapshot | same_snapshot |

retry 是單代機制：retry_generation 固定 1，successor 不再可被 retry 或 recovery
（lineage 檢查阻擋），但一般重試（attempt<max_attempts 內）不受影響。

## 稽核

decision `task.retry.requested` 記錄：run_id、task_id、successor_task_id、
failure_category（invalid_output）、rewired_task_ids、retry_generation、reason
（由 Director 於呼叫時提供，須說明修正內容）。target 保留 failure 資訊並標
superseded，歷史完整可追溯。
