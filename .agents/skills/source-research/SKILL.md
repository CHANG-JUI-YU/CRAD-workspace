---
name: source-research
description: 只在 Source Researcher 需要為 source_adaptation intake 搜尋候選來源、讀取批准狀態或擷取已批准來源時使用。
---

# Source Research

1. 用作品名、角色名、別名、語言與Director指定的官方網域，透過模型原生聯網能力或`webfetch`進行bounded discovery，再以`source_research_submit_candidates`登錄最多十個URL及每個候選的實際頁面語言。
2. 回傳 batch ID、exact revision、候選 ID、URL、類別、engine-derived source family與 relevance；snippet 只供發現，不可引用為證據。不同語言Wikipedia都屬`platform:wikipedia.org`，不能當成兩個family。
3. 等待 Director 透過使用者批准 exact batch revision。不得自行呼叫 approve 或改變候選集合。
4. 讀取 status 確認批准後呼叫 `source_research_fetch_approved`。只報告工具回傳的 source ID 與 revision。
5. controlled fetch 的失敗項可重試；已成功 candidate 不重複 fetch。
6. 搜尋目標是至少兩個獨立families；只要候選中有official，建議批准集合必須包含official。確實沒有第二個family時，向Director提供具體原因，由Director以明確single-family fallback布林與非空理由取得批准並留下audit；Researcher不得自行fallback。
