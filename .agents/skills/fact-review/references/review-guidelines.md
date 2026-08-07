# Fact Review Guidelines

## 裁決原則

- 每個候選是獨立原子 statement；只依 verified chunk 內容裁決，不依個人偏好或外部知識補寫。
- accepted 條件：statement 能由 evidence 逐字支持、分類正確、不確定性標記如實、無品質診斷。
- 下列情況 rejected：
  - evidence 無法逐字對應到 chunk（改寫、斷章取義、超出範圍）。
  - statement 非原子（一個候選含多個可分割命題）。
  - 分類錯誤（官方設定／推測／傳聞混淆）。
  - 品質診斷存在（test、placeholder、dummy、fixture、不確定性不足）。
- 不確定：不回報 accepted 也不回報 rejected，留待 Director 指示。

## 衝突處理

- 同一 predicate 出現互相矛盾的 accepted statement 會自動開啟 conflict。
- 審核者不解決衝突；在會話回報中列出 conflict id 與雙方 fact，由 Director 指派 `conflict_resolve`。

## 來源紀律

- 角色二創的內容以來源為準；不接受無來源支持的創作性添加。
- 保持 evidence、provenance、範圍與不確定性完整，不截斷、不潤飾。
