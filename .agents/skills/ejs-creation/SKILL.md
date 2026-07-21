---
name: ejs-creation
description: 只在 EJS Creator 依 approved MVU path registry 產生 typed EJS plugin proposal 時使用。
---

# EJS Creation

只產生封閉 typed EJS source：preprocessing aliases、entry visibility、section branches 與 dynamic text。所有 variable paths 必須引用 task-bound MVU registry；不得提交 raw JavaScript、任意 EJS delimiter、remote code 或未經 fallback 驗證的 branch。

使用 exact artifact refs，完成後只用 `plugin_proposal_submit`。EJS 必須保留對 official MVU plugin 的依賴與所有 exact pins。
