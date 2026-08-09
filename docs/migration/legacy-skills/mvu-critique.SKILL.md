---
name: mvu-critique
description: 只在 MVU Creator Critic 唯讀檢查 typed MVU plugin proposal 時使用。
---

# MVU Critique

檢查 exact schema、defaults、constraints、遞迴 ID、runtime read 與 JSON Patch path、writable update coverage、Zod/InitVar/update-rule輸出、regex與 immutable asset pins。拒絕 raw code、危險 key、未釘定 asset 或不一致的 revision。

只提交 `review-report@1`，不得修改 proposal、作者檔、workflow 或 gate，也不得批准 user decision。
