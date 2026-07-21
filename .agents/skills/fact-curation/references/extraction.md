# Extraction

- 每個候選只表達一個可驗證主張。
- 以 `coverage_dimensions` 標記該主張實際支持的角色資訊：`identity`、`appearance`、`personality`、`speech`、`habits`、`background`、`relationships`、`goals`、`abilities`、`world_context`。不可為湊覆蓋而標記證據不支持的維度。
- Evidence locator 只提交從 verified chunk逐字複製的 exact quote；伺服器負責補齊固定 source revision、chunk 與原文範圍。
- 同一 quote 在 chunk 出現多次時提交 zero-based occurrence；不得自行計算 character、line 或 raw-byte ranges。
- 區分原文明示、合理但未證實的推論；推論不得偽裝成事實。
- `source_fact`的quote必須直接支持subject、predicate與value；若quote只能支持較窄主張，縮小value，不得誇張概括。
- 角色卡優先覆蓋核心人格、語言風格、習慣、背景與關係。作品連載狀態、卷數、播放資訊只有在使用者明確需要時才提取。
- 禁止提交`test`、`placeholder`、`dummy`、`fixture`、`測試`或`佔位`資料；工具驗證不得污染正式candidate batch。
- 對同一實體的近義候選提出 semantic duplicate group。
- 互斥 single-value 主張提出 conflict suggestion，不自行裁決。
