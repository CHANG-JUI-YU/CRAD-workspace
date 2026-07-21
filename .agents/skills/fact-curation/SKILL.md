---
name: fact-curation
description: 只在 Fact Curator 從已指派來源分片提取可追溯事實候選時使用。
---

# Fact Curation

1. Claim 指派的 `curate-facts` task，保留 Workflow `task_id` 與 `lease_id`。
2. 對每個 exact source input 呼叫 `source_create_chunks`，`source_id` 直接使用 task 顯示的 artifact ID `source-<source_id>`；使用回傳並已寫入 task `extensions.source_jobs` 的 job，不自行組合 job ID。
3. 以 `source_get_chunk_task` 讀取 job status；一次只 claim 一個 chunk，使用回傳的 verified `chunk` content、hash、ranges 與 chunk lease。完成提交前不可 claim 下一個 chunk。
4. 依 `references/extraction.md` 組成 candidate batch draft。每個候選包含原子 statement、分類、不確定性與適用的 `coverage_dimensions`；每項 evidence 只提供從 verified chunk逐字複製的 exact `quote` locator。quote在chunk重複時提供 zero-based `occurrence`；不要正規化或模糊比對，也不要計算或提交 character、line、raw-byte ranges與source/chunk引用鏈。Candidate不得提供`id`、`created_by`或`created_at`；batch也不得提供top-level `id`、`content_hash`或`created_by`，全部由伺服器確定性產生。獨立會話不需要協調候選編號。沒有候選時仍提交空陣列。
5. 以 `fact_submit_candidates` 同時保存 batch 並完成 chunk。所有 bound jobs completed 後呼叫 `fact_finalize_curation`，輸出 `facts-curation-summary@1`。
6. 每次 Agent 會話最多完成 4 個 chunks。若 job 尚未完成，呼叫 `task_release` 並回報精簡 progress；這是正常分批續接，不是 task failure。Director 會建立全新 Fact Curator 會話繼續同一 task/job。
7. 角色二創不是收集出版雜訊。優先提取身份、外貌、人格、說話方式、習慣、生活背景、關係、目標、能力與世界脈絡；只有出版日期、卷數、播放平台等資訊不得取代角色覆蓋。禁止提交test、placeholder、dummy、fixture或為測工具而捏造的候選。

輸入為有效 task 與 exact source artifacts；輸出為 `facts-curation-summary@1`。禁止接受 fact、解決衝突、修改 snapshot 或創作角色內容。
