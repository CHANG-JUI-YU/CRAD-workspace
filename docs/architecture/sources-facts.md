# Sources/Facts 架構

## OpenCode-first 工作流

OpenCode 是完整操作入口，Dashboard、Agent 或 MCP 都不是 Sources/Facts 的必要條件。領域操作由 `@card-workspace/ingestion` 的 public library API 執行；CLI 只負責解析參數與輸出，不另寫一套規則。

典型流程如下：

```text
intakeLocalSource / intakeRetrievedSource
→ createChunkSet + storeChunkSet
→ createExtractionJob / claimChunkTask
→ submitCandidateBatch
→ reviewCandidate / resolveConflict
→ queryFacts / traceProvenance
→ verifyFactProjection / verifyProvenance
```

在 OpenCode 中應先查詢 manifest、job 與 projection revision，再帶 expected revision 呼叫 mutation API。不要依賴對話記憶推測進度；中斷後以 `listSources`、`listChunkSets`、`getJobStatus`、`queryFacts` 恢復工作。

## 心智模型

- **Source**：小說、網頁、聊天或角色卡的穩定身份。標題、檔名或 URL 改變不應建立新 Source。
- **Snapshot**：匯入當下原始 bytes 的專案內不可變副本。外部檔案之後移動或網頁消失，證據仍可重現。
- **Revision**：同一 Source 的一版內容，ID 是原始 bytes 的 SHA-256。相同 bytes 重試為 idempotent，新 bytes 建立新 Revision 並保留舊版。
- **Chunk Set**：特定 Revision 加上 tokenizer/chunker profile 的確定性分片結果。策略版本變更會建立新集合。
- **Chunk**：具 sequence、內容 hash、行、字元、byte 與 overlap 範圍的不可變提取單位。Evidence 永遠同時指定 Revision、Chunk Set 與 Chunk。
- **Candidate**：尚未經人工審核的事實提案。來源事實與合理推論必須附精確 evidence；創作補全必須附 rationale。
- **Fact**：由 decision 接受或變更、具有穩定 ID 與單調 `fact_revision` 的事實。只有 accepted fact 可供正式 provenance 使用。
- **Conflict**：相同 subject/predicate 且 scope、時間重疊的互斥值集合。系統可偵測但不自動裁決；裁決可為 choose-one、coexist、temporal、scope split、supersede 或 unresolved。

## 檔案所有權

以下檔案均可讀、可診斷，但**不可人工修改**：

| 路徑 | 性質 | 正確寫入方式 |
| --- | --- | --- |
| `sources/snapshots/**` | 原始不可變證據 | intake API create-only |
| `sources/revisions/**` | 不可變 revision descriptor | intake API create-only |
| `sources/projections/**` | revision 對應文字投影 | intake API create-only |
| `sources/chunks/**` | 不可變 chunk set/chunks | chunk store API create-only |
| `sources/jobs/**` | 可續接 job 狀態 | job API + expected revision |
| `facts/candidates/**` | 不可變 candidate batch | candidate API create-only |
| `sources/journals/*.jsonl`、`facts/decisions.jsonl` | append-only 邏輯 journal | ingestion transaction；修正使用後續事件 |
| `sources/manifest.yaml` | Source 目前狀態投影 | intake/chunk transaction |
| `facts/register.yaml`、`facts/conflicts.yaml` | Fact/Conflict 目前投影 | review/resolve/rebuild transaction |
| `.build/provenance-index.json` | 衍生 build artifact | compiler 重新產生 |

「可讀投影」不等於「作者檔案」。即使 YAML 容易編輯，也不得手改 manifest、register 或 conflicts；手改會破壞 journal chain、semantic revision 或不可變證據鏈。作者可修改一般 `project.yaml`、角色模組、世界設定等作者文件，並在其中引用 stable fact ID，但該引用仍須通過 provenance gate。

## Verify、Rebuild 與 Recovery

Verify 是只讀檢查：

- `getSourceRevision` 同時驗證 revision 身份與 snapshot hash。
- `verifyChunkSet` 由保存的 projection/profile 重算 chunk set。
- `verifyJournalText` 驗證 sequence、prior revision 與 payload hash chain。
- `verifyFactProjection` 比較目前 register/conflicts 與 immutable batches + decisions 的重建結果。
- `verifyProvenance` 驗證 accepted fact 到 evidence、chunk、revision、snapshot 的引用鏈。

Rebuild 不是資料修復捷徑。`rebuildFactProjection` 只從已驗證的 immutable candidate batches 與 decision journal 在記憶體重建，驗證成功後才以交易替換 register/conflicts；它不改 journal，也不猜測遺失事件。若 snapshot、chunk、candidate batch 或 journal 已損壞，應停止寫入、保留診斷現場並從可信備份或原來源重新 intake 成新 revision。

程序在交易發布途中中斷時，由 project transaction recovery 還原 prepared transaction；活著的 lock owner 不可被接管。交易恢復處理「是否完整發布」，projection rebuild 處理「衍生投影是否等價」，兩者不可互相替代。詳細發布與 crash recovery 見 [project-transactions.md](./project-transactions.md)。

## 安全邊界

- 本機 intake 只接受明確單檔；directory、glob、traversal、symlink/junction 越界與未知 binary 皆拒絕。
- Retrieved intake 由呼叫端提供 bytes、requested/canonical URL 與 fetched time；library 不自行爬網。
- 所有持久寫入都受 project root、ingestion allowlist、raw revision expectation 與 transaction lock 約束。
- Evidence quote 必須在指定範圍精確匹配；不以模糊相似度或 LLM 判斷取代驗證。
- accepted fact 不由增量流程靜默改寫；必須有 decision 與 expected projection/fact revision。

## Agent/MCP 下一階段

下一階段的 Agent 與 MCP tool 必須直接包裝同一組 `@card-workspace/ingestion` API，不可直接編輯 Sources/Facts 檔案，也不可複製去重、衝突、revision 或交易規則。工具輸入應保留 `projectRoot`、stable IDs、actor、expected revision 與 evidence；工具輸出只回傳 typed result、facts、evidence、decision summary 與 diagnostics，不輸出模型思維鏈。

Agent 可負責取得網路 bytes、語意提取、同義建議與衝突解釋；library 仍負責 snapshot、hash、分片、精確 evidence、stale gate、journal 與原子交易。如此 OpenCode 腳本、CLI、未來 MCP 與 Dashboard 使用同一領域結果。
