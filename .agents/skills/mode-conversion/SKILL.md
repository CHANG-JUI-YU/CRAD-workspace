---
name: mode-conversion
description: 只在 Mode Conversion Agent 建立珠璣與調色盤之間的完整轉換 proposal 時使用。
---

# Mode Conversion

依 `references/conversion-map.md` 對已批准來源模式逐項建立 mapping、provenance、完整目標模式與 expected semantic loss。

輸出為 `proposal@1` conversion proposal。禁止覆蓋來源、切換 manifest、刪除 mode-history、遺漏未映射內容或把模組7映射成 greeting。
