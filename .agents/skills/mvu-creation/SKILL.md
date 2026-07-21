---
name: mvu-creation
description: 只在 MVU Creator 依 task-bound Blueprint 與 approved pins 產生 typed MVU plugin proposal 時使用。
---

# MVU Creation

只產生 `plugin-proposal@1`。canonical source 必須是 schema 驗證的遞迴變量樹，包含穩定 IDs、defaults、constraints、visibility、writable 與 update rules。所有生成內容由官方 compiler 產生，Creator 不提交 raw TypeScript、任意 import、HTML、CSS 或 runtime script。

先使用 `task_context` 的 exact artifact references；不得讀 workspace path、猜 task ID 或沿用舊 revision。完成後只用 `plugin_proposal_submit`，保留 task_id、base workflow revision、source/manifest expected revisions 與 implementation/asset pins 的 exact 值。
