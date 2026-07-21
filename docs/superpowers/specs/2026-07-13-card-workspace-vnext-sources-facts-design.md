# Card Workspace vNext Sources and Facts 設計規格

日期：2026-07-13  
狀態：使用者已批准設計段落，待書面審閱  
依據：`docs/superpowers/specs/2026-07-13-card-workspace-vnext-master-design.md`

## 1. 目的

Sources and Facts 將本機文本、Agent 擷取的網頁內容與既有角色卡轉化為可驗證、可續接、不可靜默覆寫的來源證據與事實寄存器。

本階段建立確定性的工程底座：來源快照、版本、文字正規化、流式分片、證據定位、事實候選驗證、去重、衝突、審核投影、事件紀錄與 provenance 查詢。AI 只在後續 Agents and Workflow 階段執行語意提取、同義判斷、來源評價與衝突建議。

## 2. 核心原則

### 2.1 OpenCode 與 Workspace 優先

所有正式任務都以 OpenCode 與目前 workspace 為中心：

```text
C:\AI\projects\card-workspace
```

- OpenCode 是主要且完整的操作入口，不是 Dashboard 的附屬介面。
- 來源匯入、分片、事實審核、查詢、創作、編譯與輸出最終都能從 OpenCode 完成。
- 所有持久狀態保存於 `projects/`，不得只存在於某次 OpenCode 對話。
- session 中斷後，Director 可依 workflow、jobs、chunks、facts 與 journals 續接。
- Dashboard 只提供視覺化管理、比較與微調；核心能力不得依賴 Dashboard。
- 本階段先提供 library 與 CLI；Agents and Workflow 階段將同一 API 包裝為 workspace MCP tools，不重寫領域邏輯。

### 2.2 AI 與 Forge 分離

Agent 負責：

- 網路搜尋與內容取得。
- 來源層級與可信度建議。
- 分片語意提取。
- 語意同義判斷。
- 衝突解釋與裁決建議。

Forge 負責：

- 快照、hash、版本、分片與定位。
- schema、引用、引句與範圍驗證。
- 確定性去重與衝突候選建立。
- revision、journal、投影、交易與查詢。
- 拒絕 stale、越界、篡改或不一致資料。

Forge 不假裝執行 AI，也不以字串相似度自動宣稱兩項事實語意相同。

### 2.3 不可變證據、可審閱投影

- Snapshot、Source Revision、Chunk Set、Chunk 與事件 journal 不可原地修改。
- `sources/manifest.yaml`、`facts/register.yaml`、`facts/conflicts.yaml` 是可讀的目前狀態投影。
- 投影變更必須與 journal event 在同一交易提交。
- 投影可由不可變資料與 journal deterministic rebuild。
- 已批准事實不得被增量匯入靜默覆寫。

## 3. 範圍

### 3.1 本階段包含

- `@card-workspace/ingestion` package。
- Sources、Revisions、Snapshots、Chunk Sets、Chunks、Jobs、Fact Candidates、Facts、Conflicts、Decisions 與 Provenance schemas。
- 本機檔案與已取得網頁內容的 intake API。
- V1/V2/V3 JSON/PNG 文字化 adapter。
- UTF-8 文字正規化與固定版本分片器。
- 事實候選與 evidence 驗證。
- 確定性去重、衝突偵測與增量安全追加。
- 事實審核、衝突裁決、journal 與投影重建。
- Provenance index 與 trace API。
- CLI 命令及自動化測試。

### 3.2 本階段不包含

- Fact Curator Agent、Director 或其他 Agents。
- Agent 提示詞、Skills、工具權限與人格。
- 自動爬網、搜尋引擎或瀏覽器自動化。
- PDF、DOCX、OCR 等格式解析；日後透過 adapter 加入。
- Blueprint 與 Creator 的 AI 生成。
- Dashboard UI。

## 4. 套件架構

```text
@card-workspace/schemas
├─ source / revision / chunk / job schemas
├─ fact / candidate / conflict / decision schemas
└─ provenance schemas

@card-workspace/project
├─ workspace 路徑安全
├─ revision 與 canonical serialization
└─ transaction / journal-safe publish

@card-workspace/ingestion
├─ intake adapters
├─ snapshot store
├─ text normalization
├─ deterministic chunker
├─ evidence validator
├─ candidate merger
├─ conflict engine
├─ fact review service
└─ provenance index

@card-workspace/compiler
└─ 讀取 accepted facts 與 provenance，不反向承擔 ingestion

@card-workspace/cli
└─ 呼叫 ingestion library
```

`ingestion` 可依賴 schemas、project 與既有 card import adapters。Compiler 可消費事實資料，但 ingestion 不得依賴 compiler，避免來源處理與輸出格式形成循環。

## 5. 專案目錄

```text
projects/<project-id>/
  sources/
    manifest.yaml
    snapshots/
      <source-id>/
        <source-revision-id>.<ext>
    revisions/
      <source-id>/
        <source-revision-id>.json
    chunks/
      <source-id>/
        <source-revision-id>/
          <chunk-set-id>/
            manifest.json
            <chunk-id>.json
    jobs/
      <job-id>.json
    journals/
      source-events.jsonl
  facts/
    candidates/
      <batch-id>.json
    register.yaml
    conflicts.yaml
    decisions.jsonl
  .build/
    provenance-index.json
```

JSONL journal 每行都是獨立、版本化、canonical JSON event。禁止編輯既有行；修正使用後續 compensating event。

## 6. 識別與版本

### 6.1 Source ID

`source_id` 表示同一小說、網頁、聊天記錄、設定集或角色卡的穩定身份。顯示標題、檔名、URL 或路徑變更不得自動改變 Source ID。

建立 Source ID 時由使用者或 Agent 明確提供；CLI 可提出安全 slug，但不得用 hash 取代可持續引用的身份。

### 6.2 Source Revision ID

同一 Source 的內容更新會建立新 revision，不建立新 Source，也不覆蓋舊 snapshot。

`source_revision_id` 由原始 bytes SHA-256 決定，格式使用既有 `sha256:<64hex>` revision。相同 bytes 重複匯入必須 idempotent。

每個 revision 保存：

- source ID 與 revision ID。
- media type、原始副檔名、byte size。
- 原始 bytes hash 與正規化文字 hash。
- 原始 URI 或本機來源路徑資訊。
- title、author、language、取得時間。
- canonical URL 與網頁擷取時間。
- source tier。
- snapshot 相對路徑。
- adapter、normalizer 版本與 extensions。

### 6.3 Chunk Set 與 Chunk ID

Chunk Set 由 source revision、normalizer profile、tokenizer ID/version 與 chunker profile共同識別。任何策略版本變更都建立新 Chunk Set，不覆蓋舊 chunks。

Chunk ID 由 source revision、chunk set、原文範圍與內容 hash deterministic 產生。顯示章節名稱不參與身份。

### 6.4 Fact、Candidate 與 Conflict ID

- `candidate_id`：單次 Agent 或使用者提交的不可變候選。
- `fact_id`：經審核事實的持續身份，不由 value 或顯示文字決定。
- `conflict_id`：一組 subject、predicate、scope 與時間範圍內的不相容事實集合。
- `decision_id`：審核或衝突裁決事件的 stable ID。

## 7. 來源匯入

### 7.1 本機來源

Forge 可讀取 workspace 內外的使用者指定檔案，但只會在專案內寫入。匯入時預設且強制建立不可變 snapshot；不以外部路徑作唯一來源。

原始路徑只作 metadata，不在移動 workspace 後成為必要依賴。重新匯入同一 Source 時以 bytes hash 判斷 idempotent 或建立新 revision。

### 7.2 網路來源

Agent 或呼叫端提供已取得的 bytes 與 metadata：

- requested URL 與 canonical URL。
- title、author、language。
- fetched at。
- source tier 與可信度建議。
- HTTP metadata 可放 namespaced extensions。

Forge 不在本階段自行發送網路請求。網頁內容同樣建立 snapshot，確保頁面更新或消失後證據仍可驗證。

### 7.3 支援格式

首版支援：

- TXT 與一般 UTF-8 text。
- Markdown。
- JSON、YAML。
- 聊天匯出文字。
- Character Card V1/V2/V3 JSON 或 PNG。

文字 adapter 必須回傳版本化 `ExtractedTextDocument`，包含內容、段落或章節 hints 與來源欄位映射。角色卡沿用既有 import adapter，將主卡欄位、greetings 與 lore entries 轉為可定位文本，不猜測珠璣或調色盤。

未知二進位格式明確拒絕。Format adapter interface 保持可擴充。

### 7.4 Source Tier

來源層級固定為：

- `official`
- `common_fanon`
- `single_author_fanon`
- `user_original`
- `unknown`

Tier 是判讀資訊，不是自動裁決優先級。Forge 不因 tier 較高而自動覆蓋其他事實。

## 8. 文字正規化

- 保留原始 snapshot bytes。
- 支援 UTF-8 BOM 並以 fatal decoder 拒絕無效 UTF-8。
- 正規化輸出只統一 CRLF/CR 為 LF，並記錄 line map。
- 不修正文法、不改標點、不折疊空白、不執行 Unicode compatibility normalization。
- JSON/YAML 可由 adapter產生結構化欄位段落，但 evidence 必須能回到 snapshot 或保存的 extracted-text projection。
- 原始 hash 與正規化 hash 同時保存。

Line map 必須允許 normalized line/character range 回溯到原始 byte range。若某 adapter 無法提供原始 byte 精確映射，必須明確標為 projection evidence，不得冒充 raw snapshot range。

## 9. 流式分片

### 9.1 預設 Profile

- tokenizer：固定 ID 與版本，預設沿用 Forge Core 的 exact tokenizer。
- target：7,500 tokens。
- overlap：750 tokens。
- target 可設定 5,000 至 10,000 tokens。
- overlap 必須小於 target，且上限為 target 的 25%。

### 9.2 切分優先級

1. 章節標題。
2. 空行與段落。
3. 對話或句子邊界。
4. Token-safe 硬切。

分片器不依賴 AI。相同 normalized text、profile 與 tokenizer 必須跨執行產生相同 chunk ranges 與 IDs。

### 9.3 Chunk Metadata

每片保存：

- chunk ID、source ID、source revision ID、chunk set ID。
- sequence 與章節路徑。
- normalized character start/end。
- normalized line start/end。
- 可用時的 raw byte start/end。
- main range、leading overlap 與 trailing overlap。
- token count、content hash。
- extraction job status。

重疊內容可出現在相鄰 chunks，但候選去重不得因此複製正式事實。

## 10. Ingestion Jobs 與續接

Job 保存：

- job ID、kind、source revision、chunk set。
- input revision、建立者與建立時間。
- 每個 chunk task 的狀態。
- batch、attempt、錯誤 diagnostics 與輸出 hash。

Task 狀態固定為：

- `pending`
- `processing`
- `completed`
- `failed`
- `superseded`

規則：

- 已完成且 input/hash 未變的 chunk 不重跑。
- Agent 提交 batch 必須帶 source revision、chunk set 與 chunk hash。
- 舊 revision 或已 superseded chunk 的遲到結果拒絕。
- 單片失敗不將整個來源標記完成。
- job 完成必須由所有必要 tasks 的狀態推導，不以檔案存在判斷。

## 11. 事實候選

每個 Candidate 至少包含：

```yaml
schema_version: 1
id: candidate-stable-id
subject: entity-stable-id
predicate: appearance.hair
value: 黑色長髮
classification: source_fact
confidence: 0.95
scope: {}
valid_time: {}
evidence:
  - source_id: source-stable-id
    source_revision_id: sha256:...
    chunk_set_id: chunk-set-id
    chunk_id: chunk-id
    chapter: 第三章
    lines: [120, 124]
    character_range: [2400, 2432]
    quote: 原文引句
created_by: fact-curator
```

`value` 是 JSON value，允許字串、數字、布林、陣列或物件。Canonical value 使用既有 canonical JSON；不得以 YAML 字面順序判斷差異。

Classification 僅允許：

- `source_fact`
- `reasonable_inference`
- `creative_completion`

`source_fact` 至少需要一項精確 evidence；`reasonable_inference` 至少需要一項 evidence，通常可引用多項；`creative_completion` 可無原文 evidence，但必須有建立者與 rationale，不得被標示為來源事實。

## 12. Evidence 驗證

每項 evidence 必須驗證：

- Source、revision、chunk set 與 chunk 存在。
- 引用鏈彼此一致。
- Chunk hash 與已保存內容一致。
- Line、character 與 byte range 不越界。
- Quote 在指定 revision 範圍精確匹配。
- 重疊區 evidence 仍指向 revision 的唯一 normalized range。

允許的 quote 正規化只有換行規則；不得使用模糊相似度通過 evidence gate。若 Agent 只能提出近似引句，candidate 保持 invalid，並回傳可修正 diagnostics。

整個 candidate batch schema 或 evidence 驗證失敗時整批拒絕，不部分寫入。大量結果應由呼叫端切成多個具獨立 revision 的 batch。

## 13. 事實生命週期

```text
candidate
→ validated
→ pending_review
→ accepted / rejected
→ superseded / withdrawn
```

只有 `accepted` fact 可供 Blueprint、Creator、World Lore 與正式 provenance 使用。

事實保存：

- fact ID、subject、predicate、canonical value。
- classification、confidence、scope 與 valid time。
- 全部 evidence 與來源層級。
- status、fact revision、建立者與建立時間。
- supersedes/superseded-by 關係。
- decisions 與 extensions。

狀態變更必須由 decision event 驅動，不能只 patch status 而不留審核紀錄。

## 14. 去重

### 14.1 Exact Duplicate

Subject、predicate、canonical value、scope、valid time 與 evidence 全部相同。重複提交回傳既有 candidate/fact reference，不新增內容。

### 14.2 Deterministic Equivalent Candidate

Subject、predicate、canonical value、scope 與 valid time 相同，但 evidence 不同。系統提出合併至同一 fact 的 deterministic proposal；新 evidence 仍需審核後加入 accepted fact。

### 14.3 Semantic Similarity Suggestion

字面不同但可能同義時，Forge 只保存 Agent 提供的 similarity suggestion。Fact Curator 或使用者決定 merge、coexist 或 conflict。核心不得以 embedding、edit distance 或 LLM 分數自動合併。

## 15. 衝突

Forge 在相同 subject、predicate、重疊 scope 與 valid time 中發現不同 canonical value 時建立或更新 conflict projection。

Conflict 觸發來源包括：

- 新 candidate 挑戰 accepted fact。
- 多來源提出互斥值。
- 同 Source 不同 revision 發生設定變更。
- 不同 source tier 或世界線未明確分 scope。

Conflict 不自動裁決。Resolution 固定為：

- `choose_one`
- `coexist`
- `temporal`
- `scope_split`
- `unresolved`
- `supersede`

`choose_one` 與 `supersede` 必須列出被採納及未採納 fact IDs；`temporal` 必須建立不重疊 valid time；`scope_split` 必須建立明確 scopes；`unresolved` 會阻止要求單一答案的下游 gate。

## 16. 增量安全追加器

自動動作只允許：

- 保存全新 candidate batch。
- 將 evidence 完整且沒有 deterministic 衝突的 candidate 標為 `pending_review`。
- 建立 dedup proposal 或 conflict。

自動動作禁止：

- 修改 accepted fact 的 value、classification、evidence 或 status。
- 刪除舊 evidence、snapshot、revision 或 chunk。
- 自動採信較高 source tier。
- 自動裁決 semantic similarity 或 conflict。

任何 accepted fact 變更都需要 expected projection revision、明確 decision、受控 patch 與單一原子交易。Stale revision 必須失敗。

## 17. Journal 與投影

Source event 至少包含：

- `source.created`
- `source.revision_added`
- `source.chunk_set_created`
- `source.job_updated`

Fact event 至少包含：

- `candidate.submitted`
- `candidate.validated`
- `fact.accepted`
- `fact.rejected`
- `fact.superseded`
- `fact.withdrawn`
- `conflict.opened`
- `conflict.resolved`

每個 event 保存 event ID、schema version、aggregate ID、expected prior revision、actor、timestamp、payload hash 與 payload。

Timestamp 不參與 aggregate semantic revision。投影順序以 journal sequence 與 prior revision chain 決定，不以檔案系統時間決定。

提供 projection verifier 與 rebuild：

- Journal chain 斷裂、重複 event、未知 aggregate 或 hash 不符時明確失敗。
- Rebuild 先產生 staging 投影並驗證，再交易式替換。
- 不自動改寫 journal。

## 18. Provenance

`.build/provenance-index.json` 建立雙向索引：

```text
作者內容 fragment
↔ accepted fact
↔ evidence
↔ chunk
↔ source revision
↔ snapshot
```

本階段提供 fact-to-source trace。作者內容 fragment-to-fact 由其既有 `provenance: [{ kind: fact, ref: ... }]` 建立；Compiler build 時驗證 referenced fact 必須 accepted。

重新命名 source、角色或顯示標題不得破壞 provenance。缺失、rejected、withdrawn 或 unresolved-conflict fact reference 會產生結構化 diagnostics。

## 19. API 與 CLI

Library API 對應命令：

```text
card-workspace source add <project-id> <file> --source-id <id> ...
card-workspace source revise <project-id> <source-id> <file> ...
card-workspace source list <project-id>
card-workspace source chunk <project-id> <source-id> [--revision <sha256>]
card-workspace source status <project-id> <source-id>

card-workspace fact submit <project-id> <batch-file>
card-workspace fact validate <project-id> <batch-id>
card-workspace fact review <project-id> <candidate-id> --decision <...>
card-workspace fact conflicts <project-id>
card-workspace fact resolve <project-id> <conflict-id> --decision-file <file>
card-workspace fact query <project-id> [filters]

card-workspace provenance trace <project-id> <fact-or-fragment-id>
card-workspace provenance verify <project-id>
```

所有命令輸出 canonical machine-readable JSON。輸入檔案可位於 workspace 外，但所有寫入只能位於指定 project allowlist。CLI 與後續 MCP 必須呼叫相同 library API。

## 20. Ownership 與安全

- Source intake 可讀明確指定的外部檔案，不允許目錄遞迴或 glob 隱式擴權。
- Snapshot 檔名只由安全 ID、revision 與受控副檔名生成。
- 限制來源 bytes、正規化文字、單 chunk、batch candidate 數與 journal event 大小。
- PNG 延續既有 CRC、chunk 與大小限制。
- YAML/JSON 延續 fatal UTF-8、深度與解析診斷。
- 禁止 symlink/junction 將 snapshot、facts 或 journals 導出 workspace。
- Snapshot hash 必須在 evidence 驗證與 projection rebuild 時重驗。
- 不信任 Agent 輸出的路徑、range、hash、ID、classification 或 confidence。

## 21. 錯誤處理

- Source intake 任一步失敗不得建立半套 manifest/revision/snapshot。
- Chunk Set 完整建立後才更新目前 chunk set 指標。
- Candidate batch 驗證失敗整批拒絕。
- 投影與 journal 必須同交易提交。
- Stale expected revision 與 concurrent writer 明確衝突。
- 舊 Source Revision 的遲到 Agent 結果明確拒絕或保存為 superseded batch，不進目前投影。
- 單一 chunk task 失敗可續接，不把整個 job 標成 completed。
- 無法解析或不支援格式時回傳具 location、evidence、hint 與 fixability 的 diagnostics。

## 22. 與 Forge Core 整合

Forge Core 作者 loader 新增：

- 解析並驗證 sources/facts 投影。
- 驗證作者 `kind: fact` provenance references。
- 只允許 accepted facts 進正式 IR provenance。
- 產生 `.build/provenance-index.json`。
- 將 unresolved conflict、失效 evidence 或 stale source revision 納入 workspace audit。

Sources/Facts 不直接把小說文字寫入角色設定。資料流固定為：

```text
Source Snapshot
→ Chunks
→ Fact Candidates
→ Evidence Validation
→ Review / Conflict Resolution
→ Accepted Fact Register
→ Blueprint / Creator
→ Author Drafts
→ Canonical IR
→ CCv3
```

## 23. 測試策略

### 23.1 Schema 與識別

- 所有 enum、ID、revision 與 cross-reference。
- Internal strict 與 extension passthrough 邊界。
- Canonical JSON value 與 stable semantic revision。

### 23.2 Intake

- 相同 bytes 重複匯入 idempotent。
- 同 Source 新 bytes 建立新 Revision。
- 舊 snapshot 永不修改。
- 本機與網頁 metadata。
- TXT、Markdown、JSON、YAML、chat、V1/V2/V3 JSON/PNG。
- 無效 UTF-8、未知二進位、超大來源、危險路徑與 symlink/junction。

### 23.3 Chunking

- 固定 tokenizer golden ranges。
- 章節、段落、對話、句子與硬切 fallback。
- 5k–10k target 與 overlap constraints。
- Unicode、CRLF、巨大段落、無章節來源。
- 相同輸入 deterministic；profile 變更建立新 Chunk Set。
- 重疊範圍與 line/raw byte map。

### 23.4 Evidence

- 精確 quote、line、character、byte range。
- 邊界引句與跨行引句。
- 篡改 snapshot、錯誤 hash、錯 revision、錯 chunk、越界 range、偽造 quote。
- source_fact/inference/creative completion 的不同 evidence gate。

### 23.5 Facts 與 Conflicts

- Exact duplicate、deterministic equivalent、semantic suggestion。
- 真衝突、時間分期、scope split、coexist 與 unresolved。
- Accepted fact 不可自動覆寫。
- Decision、supersede 與 withdrawal 保留完整歷史。

### 23.6 Transaction 與續接

- Snapshot/manifest/journal/projector 故障注入。
- Concurrent submit、stale revision、crash recovery。
- Chunk task 部分失敗、重試與遲到結果。
- Journal verify 與 deterministic projection rebuild。

### 23.7 Provenance 與 E2E

- 作者 fragment → fact → evidence → chunk → revision → snapshot。
- 失效 fact reference 阻斷 strict compile。
- CLI 與 library 對相同輸入結果一致。
- 完整流程不啟動 Dashboard，可從 OpenCode terminal 完成。

Coverage 維持既有全域門檻；來源篡改、證據偽造、accepted fact 覆寫與 journal corruption 必須有明確風險 fixture，不以 coverage 數字取代。

## 24. 完成定義

- 本機來源預設建立不可變專案快照。
- 同 Source 支援多個不可變 Revisions。
- 5k–10k token sliding-window chunking deterministic 且可續接。
- 每項 source fact 可驗證至 quote、line、range、chunk、revision 與 snapshot hash。
- Fact classifications 不混淆原作事實、合理推論與創作補全。
- 重複、候選等價與衝突可區分。
- Accepted fact 不會被自動或靜默覆寫。
- Conflict resolution 有完整 decision history。
- Projection 可由 journal deterministic rebuild。
- Provenance 可由作者內容追溯至不可變來源證據。
- Library 與 CLI 完整，不依賴 Dashboard。
- 下一階段 OpenCode Director、Fact Curator 與 MCP 可直接使用版本化契約。
- Build、lint、typecheck、tests、coverage、frozen install 與 production audit 通過。

## 25. 已確認決策

- 預設一律複製不可變來源快照。
- 同一來源使用穩定 Source ID 與多個不可變 Revisions。
- 採事件 journal 加 YAML/JSON 當前投影的混合模型。
- OpenCode 與此 workspace 是所有任務的主要環境。
- Dashboard 不得成為核心功能前置條件。
- Forge 只做確定性工程；語意工作留給後續 Agent。
- Exact quote gate 不以模糊相似度取代。
- 模糊同義只建立建議，不自動合併。
- 增量安全追加器不得修改 accepted facts。

## 26. 自審結果

- 無 TBD、TODO 或未決 placeholder。
- Source identity 與 content revision 已明確分離。
- 原始 snapshot、normalized projection 與 evidence range 的責任不互相冒充。
- AI、Forge、Compiler、CLI、MCP 與 Dashboard 邊界一致。
- `workflow.json` 延續現有 Foundation 實作，不因主規格早期範例的 `workflow.yaml` 返工。
- 本階段只建立 Agent 可用契約，不提前實作 Agents and Workflow。
- 規格可切成單一 Sources and Facts 實作計畫，但計畫應再分 intake/chunking、facts/conflicts、provenance/integration 三個可獨立驗收里程碑。
