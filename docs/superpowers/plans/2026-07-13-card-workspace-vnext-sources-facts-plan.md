# Card Workspace vNext Sources and Facts 實作計畫

日期：2026-07-13  
狀態：實作與自動化驗收完成  
依據：`docs/superpowers/specs/2026-07-13-card-workspace-vnext-sources-facts-design.md`

## 1. 目標與邊界

本計畫把已批准的來源與事實規格落成確定性 library、CLI 與 Forge 整合：

```text
Explicit Source Input
→ Immutable Snapshot / Source Revision
→ Text Projection / Deterministic Chunk Set
→ Resumable Extraction Job
→ Candidate / Evidence Validation
→ Dedup / Conflict
→ Review Decision / Fact Register
→ Provenance Index / Forge Validation
```

所有能力必須能在目前 OpenCode workspace 中完成，不依賴 Dashboard。此階段不建立 Agent、Skill、MCP、網路爬蟲、PDF/DOCX parser 或 Blueprint Creator；但 public API 必須足以讓下一階段直接包成 MCP tools。

## 2. 實作不變量

- 本機與網路內容一律先建立專案內不可變 snapshot。
- 同 Source 使用穩定 ID 與多個 content-addressed Revisions。
- Snapshot、Revision、Chunk Set、Chunk、Candidate Batch 與既有 journal event 不得原地修改。
- YAML/JSON projection 與 journal 更新必須同一交易提交。
- Evidence 精確匹配，不以模糊相似度通過。
- Accepted fact 不得被自動追加器修改。
- Forge 不做 AI 語意工作。
- 所有持久寫入經 `@card-workspace/project` transaction 與 allowlist。
- CLI、未來 MCP 與 OpenCode Agent 必須呼叫相同 library API。

## 3. Package Graph

```text
@card-workspace/schemas
├─ @card-workspace/project
├─ @card-workspace/adapters-ccv3
└─ @card-workspace/ingestion
   ├─ schemas
   ├─ project
   ├─ adapters-ccv3
   ├─ adapters-png
   └─ js-tiktoken

@card-workspace/compiler
├─ ingestion public read/verify API
└─ existing Forge Core dependencies

@card-workspace/cli
├─ ingestion
└─ compiler
```

`ingestion` 不依賴 compiler、CLI、MCP 或 app。Tokenizer package version與 encoding ID 固定，不能使用隱式模型預設。

## 4. 里程碑

### M1：來源快照與分片

完成 Tasks 1–5。可從 OpenCode terminal 匯入來源、建立不可變 revision、產生 deterministic chunk set，並查詢可續接 job。

### M2：事實、衝突與事件投影

完成 Tasks 6–9。可提交候選、驗證 evidence、辨識 deterministic duplicate/conflict、審核事實、裁決衝突並由 journal rebuild 投影。

### M3：Provenance、Forge 與 CLI

完成 Tasks 10–13。作者 fact provenance 可追到 snapshot；strict compile 可阻止失效引用；完整 CLI、E2E、文件與品質閘門通過。

## 5. Tasks

### Task 1：來源、分片、工作與事實 Schemas

新增：

- `packages/schemas/src/source.ts`
- `packages/schemas/src/chunk.ts`
- `packages/schemas/src/ingestion-job.ts`
- `packages/schemas/src/fact.ts`
- `packages/schemas/src/conflict.ts`
- `packages/schemas/src/provenance.ts`
- `packages/schemas/test/sources-facts-schemas.test.ts`

修改：

- `packages/schemas/src/index.ts`
- `packages/schemas/src/author-common.ts`

Schema 契約：

- Source Manifest 與 Source record。
- Source Revision 與 immutable snapshot descriptor。
- Extracted Text Projection 與 raw/projection range mapping。
- Chunk Profile、Chunk Set Manifest 與 Chunk。
- Ingestion Job 與 per-chunk task state。
- Fact Candidate、Evidence、Candidate Batch、Fact Register。
- Conflict、Resolution Decision 與 journal event envelope。
- Provenance Index 與 trace response。

先寫失敗測試：

- Source tier 只接受 `official/common_fanon/single_author_fanon/user_original/unknown`。
- Source Revision 必須使用 SHA-256 revision 並保存 raw/normalized hashes。
- Chunk range、overlap、token count、sequence 與引用型別正確。
- Source fact 必須有 evidence；reasonable inference 至少一項；creative completion 需要 rationale。
- Evidence 必須指定 source/revision/chunk set/chunk、quote 與 ranges。
- Fact status、candidate status、job task status、resolution enums 精確。
- Accepted fact 有單調 fact revision 與 decision reference。
- Internal schemas `.strict()`；only extensions/payload 使用 JSON passthrough。
- 作者 `kind: fact` provenance ref 必須是 stable fact ID。

驗收命令：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/schemas test
npx --yes pnpm@10.34.5 --filter @card-workspace/schemas typecheck
```

### Task 2：Sources/Facts 目錄、初始化與 Ownership

修改：

- `packages/project/src/initialize.ts`
- `packages/project/src/ownership.ts`
- `packages/project/src/author-layout.ts`
- `packages/project/src/load-author-project.ts`
- `packages/project/src/index.ts`
- `packages/project/test/load-author-project.test.ts`
- `packages/project/test/edit.test.ts`

初始化新增：

```text
sources/manifest.yaml
sources/journals/source-events.jsonl
facts/register.yaml
facts/conflicts.yaml
facts/decisions.jsonl
```

Ownership 分類：

- 人工/受控投影：manifest、register、conflicts。
- immutable ingestion artifacts：snapshots、revisions、chunks、candidate batches。
- append-only logical journals：source-events、decisions；實體寫入仍以整檔 transaction replacement 實現。
- derived artifact：`.build/provenance-index.json`。

先寫失敗測試：

- 新專案建立合法空投影與 journals。
- 一般 author patch 不得修改 immutable artifacts 或 journals。
- ingestion internal API 可寫受控路徑，不能擴展為任意 project writer。
- `.build` 與 exports 仍不能由 author patch 修改。
- 巢狀假 manifest、symlink/junction 與未知來源檔不進 author loader。
- 舊 Foundation/Forge project 若缺空 Sources/Facts 投影，loader 給出明確 schema migration diagnostic；正式 `projects/` 無資料，不建立永久相容 shim。

驗收：初始化專案後 `validate` 可載入空 Sources/Facts 狀態；ownership 測試涵蓋 public patch 與 internal writer 邊界。

### Task 3：建立 Ingestion Package 與 Intake Adapter 契約

新增：

- `packages/ingestion/package.json`
- `packages/ingestion/tsconfig.json`
- `packages/ingestion/src/index.ts`
- `packages/ingestion/src/types.ts`
- `packages/ingestion/src/adapters/text.ts`
- `packages/ingestion/src/adapters/structured.ts`
- `packages/ingestion/src/adapters/character-card.ts`
- `packages/ingestion/src/adapters/index.ts`
- `packages/ingestion/test/adapters.test.ts`

Adapter interface：

```ts
interface SourceAdapter {
  id: string;
  version: string;
  supports(input: SourceInputDescriptor): boolean;
  extract(bytes: Buffer, metadata: SourceMetadata): ExtractedTextDocument;
}
```

支援：

- TXT、Markdown、chat text：fatal UTF-8，保留原文。
- JSON、YAML：驗證後產生 deterministic field projection 與 field path hints。
- Character Card JSON/PNG：沿用既有 import adapters，按 canonical field order 投影 name、主卡文字、greetings 與 lore entries；不猜模式。

先寫失敗測試：

- Adapter 選擇 deterministic，不依副檔名單獨信任 media type。
- UTF-8 BOM、LF/CRLF、Unicode。
- 無效 UTF-8、錯 JSON/YAML、未知 binary 拒絕。
- V1/V2/V3 JSON、ccv3 PNG、chara-only PNG。
- Card projection 每段可回到 canonical card field/entry ID。
- 單來源與 projection 大小上限。

驗收：同一 bytes 與 adapter version 產生 byte-stable ExtractedTextDocument。

### Task 4：安全 Intake、Snapshot 與 Source Revision

新增：

- `packages/ingestion/src/intake.ts`
- `packages/ingestion/src/snapshot-store.ts`
- `packages/ingestion/src/source-manifest.ts`
- `packages/ingestion/src/events.ts`
- `packages/ingestion/test/intake.test.ts`

修改：

- `packages/project/src/transaction.ts`，只在必要時加入受控 binary artifact 與 expectation helper。

Public API：

```ts
intakeLocalSource(options)
intakeRetrievedSource(options)
listSources(projectRoot)
getSourceRevision(projectRoot, sourceId, revisionId?)
```

本機 intake 安全規則：

- 只讀呼叫端明確指定的一個 regular file。
- `lstat` 拒絕 symlink；拒絕 directory、device、pipe 與 glob。
- 先檢查大小，再讀 bytes，再重驗 stat identity/size，避免讀取期間替換。
- 外部檔案可讀，但所有寫入只能在 project root allowlist。

交易內容：

- snapshot bytes。
- revision JSON。
- text projection JSON。
- source manifest projection。
- `source.revision_added` event。

Event ID 由 aggregate、prior semantic revision、event kind 與 canonical payload hash決定；timestamp 保存但不參與 aggregate semantic revision，讓重試 idempotent。

先寫失敗測試：

- 同 Source 相同 bytes idempotent，不增加 event。
- 同 Source 新 bytes 建立新 immutable revision。
- 不同 Source 可引用相同 content hash，但 manifest 身份分離。
- transaction 任一步失敗不留 snapshot/revision/event 半套。
- 外部 symlink、讀取中替換、超大檔案、危險 Source ID 拒絕。
- Retrieved source 必須有 fetched-at 與 canonical/requested URL metadata。
- 舊 snapshot hash 重驗失敗時 source verify 報錯，不自動修補。

驗收：Source manifest、revision、snapshot 與 journal 永遠一致，重試安全。

### Task 5：Normalizer、Line Map 與 Deterministic Chunker

新增：

- `packages/ingestion/src/normalize-text.ts`
- `packages/ingestion/src/line-map.ts`
- `packages/ingestion/src/chunker.ts`
- `packages/ingestion/src/chunk-store.ts`
- `packages/ingestion/test/chunker.test.ts`

使用 Forge Core 已鎖定的 exact `cl100k_base` tokenizer，抽取共享 tokenizer adapter 到不造成 compiler↔ingestion cycle 的位置；優先放 `ingestion` 自有實作並鎖相同版本，不讓 compiler 反向被依賴。

Chunk profile defaults：

- target 7,500。
- overlap 750。
- target range 5,000–10,000。
- overlap > 0 且 <= target 25%。
- strategy/version 明列。

Boundary detector 順序：章節、段落、對話/句子、token-safe hard split。不得使用 locale-dependent filesystem 或時間資訊。

先寫失敗測試：

- CRLF/CR → LF，raw/normalized line map 可逆到 byte range。
- 不折疊空白、不改 Unicode、不改標點。
- 章節、段落、對話、句子與巨大單段 fallback。
- Main/leading/trailing overlap ranges 不重疊錯置。
- Token count golden、target/overlap constraints。
- 同輸入跨 temporary directory 得到相同 Chunk Set/Chunk IDs。
- Profile/tokenizer version 改變建立新 Chunk Set。
- 已存在相同 Chunk Set idempotent；新 set 不刪舊 set。
- Chunk store 故障不更新 current pointer。

驗收：大型文本可 deterministic 分片，所有 ranges 與 hashes 可重算驗證。

### Task 6：Resumable Ingestion Jobs

新增：

- `packages/ingestion/src/jobs.ts`
- `packages/ingestion/test/jobs.test.ts`

Public API：

```ts
createExtractionJob(...)
claimChunkTask(...)
completeChunkTask(...)
failChunkTask(...)
supersedeJob(...)
getJobStatus(...)
```

規則：

- Claim 使用 expected job revision 與 lease metadata，不靠檔案存在。
- Processing task 可在 lease 過期後重試；attempt 單調增加。
- Complete 必須帶 source revision、chunk set、chunk ID/hash 與 result batch hash。
- 舊 revision、stale lease、錯 chunk hash、superseded job 結果拒絕。
- Job complete 由所有 required tasks completed 推導。

先寫失敗測試：

- Claim/complete happy path。
- 並行 claim 只有一方成功。
- Session 中斷後 lease expiry 可續接。
- 單片 failed 不完成 job，可重試。
- 舊 revision 遲到結果拒絕。
- 全部完成才更新 source job status。
- transaction failure 不產生 processing/completed 漂移。

驗收：不依 OpenCode session 記憶即可列出待處理 chunks 並安全續接。

### Task 7：Evidence 與 Candidate Batch 驗證

新增：

- `packages/ingestion/src/evidence.ts`
- `packages/ingestion/src/candidates.ts`
- `packages/ingestion/test/evidence.test.ts`

Public API：

```ts
validateCandidateBatch(projectRoot, input)
submitCandidateBatch(projectRoot, input, expectedRevision)
```

Evidence validator：

- 重驗 snapshot、revision、chunk set、chunk hashes。
- 驗證 source/revision/set/chunk 引用鏈。
- 驗證 normalized character/line range與可用 raw byte range。
- Quote 必須在指定 normalized range 精確匹配；只容許已記錄的 newline normalization。
- Overlap evidence 正規化到 revision 唯一 range。

先寫失敗測試：

- 單行、多行、Unicode、chunk boundary 與 overlap quote。
- 錯 source/revision/set/chunk、錯 hash、越界 range、偽造 quote。
- snapshot 或 chunk 篡改。
- `source_fact`、`reasonable_inference`、`creative_completion` 各自 gate。
- Batch 任一 candidate 無效時整批不落地。
- 重複提交同 batch id/hash idempotent；同 ID 不同 payload衝突。

驗收：任何 accepted 候選的 evidence 都可重現驗證至 snapshot。

### Task 8：Deterministic Dedup 與 Conflict Engine

新增：

- `packages/ingestion/src/canonical-fact.ts`
- `packages/ingestion/src/deduplicate.ts`
- `packages/ingestion/src/conflicts.ts`
- `packages/ingestion/test/deduplicate-conflict.test.ts`

分類：

- Exact duplicate：subject/predicate/value/scope/time/evidence 相同。
- Deterministic equivalent：subject/predicate/value/scope/time 相同、evidence 不同。
- Semantic suggestion：只接受 Agent 提供並保存，核心不自行計算為等價。
- Conflict：subject/predicate 及 scope/time 重疊，canonical value 不同。

先寫失敗測試：

- JSON object key order 不影響 canonical value。
- 陣列順序預設有語義，不任意排序。
- Evidence 差異建立 merge proposal，不自動改 accepted fact。
- Scope/time 不重疊不形成衝突。
- 同 Source 新 revision 值改變形成 conflict 並標示 lineage。
- Source tier 不自動決定 winner。
- 重複 conflict members 只更新同一 conflict。
- Semantic suggestion 不直接合併或關閉 conflict。

驗收：每個 candidate 得到 deterministic disposition 與可解釋 trace。

### Task 9：Review、Decision Journal 與 Projection Rebuild

新增：

- `packages/ingestion/src/review.ts`
- `packages/ingestion/src/decisions.ts`
- `packages/ingestion/src/projector.ts`
- `packages/ingestion/src/journal.ts`
- `packages/ingestion/test/review-projector.test.ts`

Public API：

```ts
reviewCandidate(...)
resolveConflict(...)
verifyFactProjection(...)
rebuildFactProjection(...)
queryFacts(...)
```

Review rules：

- Accepted、rejected、superseded、withdrawn 都由 decision event 驅動。
- 修改 accepted fact 需要 expected fact/projection revision。
- 新 evidence 加入 accepted fact 仍需明確 decision。
- Resolution schema 驗證 choose-one/coexist/temporal/scope-split/unresolved/supersede 所需欄位。
- Unresolved conflict 保留 members 並暴露 gate status。

Journal rules：

- 每行 canonical JSON、sequence、prior revision、payload hash。
- 不修改既有行；撤銷使用 compensating event。
- Projector 不使用 timestamp 排序。
- Rebuild 先 staging、驗證，再 transaction replacement。

先寫失敗測試：

- Candidate accept/reject 與 fact revision。
- Accepted fact 無 decision 不可修改。
- Stale review 與 concurrent resolution conflict。
- 所有 resolution types 及 invalid payload。
- Journal line corruption、sequence gap、prior mismatch、duplicate event、payload hash mismatch。
- Rebuild 結果與目前 projection canonical 等價。
- Rebuild failure 不改 register/conflicts。
- Timestamp 變更不改 aggregate semantic projection revision。

驗收：register/conflicts 可完全由 immutable batches與 decisions 重建，且歷史不丟失。

### Task 10：Provenance Index 與 Trace API

新增：

- `packages/ingestion/src/provenance.ts`
- `packages/ingestion/test/provenance.test.ts`

修改：

- `packages/schemas/src/ir.ts`，僅在需要時收斂 provenance typed ref。
- `packages/compiler/src/normalize.ts`
- `packages/compiler/src/build.ts`
- `packages/compiler/src/manifest.ts`

Public API：

```ts
buildProvenanceIndex(loadedProject)
traceProvenance(projectRoot, id)
verifyProvenance(projectRoot)
```

Index edges：

- fragment → fact。
- fact → evidence。
- evidence → chunk。
- chunk → revision。
- revision → snapshot。

先寫失敗測試：

- 雙向 trace 完整。
- Rename display title/path metadata 不破壞 stable refs。
- Missing、rejected、withdrawn fact reference。
- Accepted fact evidence失效。
- Unresolved conflict fact 被要求單一值。
- 相同輸入 index hash deterministic。
- `.build/provenance-index.json` 納入原子 publish 與 build manifest hash。

驗收：任一作者 fact provenance 可追到不可變 snapshot，strict build 前完成驗證。

### Task 11：Forge Loader、Audit 與 Strict Gate 整合

修改：

- `packages/project/src/load-author-project.ts`
- `packages/compiler/src/build.ts`
- `packages/diagnostics/src/audit.ts`
- 對應 tests。

整合：

- Loader 精確載入 Sources/Facts projections 並聚合 diagnostics。
- Normalize 接受 `kind: fact` refs，但內容仍來自作者草稿，不直接把 raw fact value 偷寫成設定。
- Build 驗證 referenced fact accepted、evidence valid、conflict gate resolved。
- Workspace audit 新增 stable rule IDs：invalid fact ref、non-accepted fact、broken evidence、unresolved conflict、stale source revision。
- Strict block 仍在 emit/publish 前，exports 不變。

先寫失敗測試：

- Accepted fact reference build success。
- Pending/rejected/withdrawn/missing fact reference block。
- Broken snapshot/evidence block。
- Unrelated unresolved conflict 不阻斷；被引用且要求單一答案者阻斷。
- Audit finding layer 必須是 workspace，不冒充 CCv3 normative。
- Failure diagnostics 帶 fact/chunk/source evidence chain。

驗收：Forge Core 與 Facts 使用同一 revision snapshot，build race 由 transaction expectation 阻止。

### Task 12：CLI 命令族

修改：

- `packages/cli/package.json`
- `packages/cli/src/program.ts`
- `packages/cli/src/index.ts`
- `packages/cli/test/sources-facts-cli.test.ts`

新增命令：

```text
source add / revise / list / chunk / status / verify
fact submit / validate / review / conflicts / resolve / query
provenance trace / verify
```

CLI requirements：

- 所有輸出 canonical JSON。
- Source add/revise 可讀明確的外部 absolute file path；其他輸入預設 workspace boundary。
- Mutation 命令要求 expected revision，或先建立後回傳 revision 的 create-only 操作。
- Actor 必須可指定，預設 `user`，後續 Agent/MCP 傳入 Agent ID。
- 穩定 exit codes：validation、conflict/stale、path/security、internal。
- 不輸出模型思維鏈，只輸出 facts、evidence、decision summary 與 diagnostics。

先寫失敗測試：

- OpenCode terminal E2E：init → source add → chunk → fact submit → review → trace。
- External explicit file success；directory/glob/symlink/traversal failure。
- Machine JSON stdout，error JSON stderr。
- Stale review、invalid evidence 與 unresolved conflict exit code。
- CLI 與 library semantic results 相同。

驗收：完整 Sources/Facts 工作流無 Dashboard、MCP 或 Agent 仍可操作與驗證。

### Task 13：Fixtures、文件與最終驗收

新增/修改：

- `packages/testing/src/source-builder.ts`
- `packages/testing/src/fact-builder.ts`
- `packages/testing/fixtures/sources-facts/**`
- `docs/architecture/sources-facts.md`
- `docs/architecture/project-transactions.md`
- `README.md`
- 本計畫狀態與實作校正。

Fixtures 至少包含：

- 小型 Markdown 章節文本。
- 大型無章節文本與跨 chunk evidence。
- CRLF、Unicode、巨大段落。
- JSON/YAML/chat projection。
- V1/V2/V3 card JSON 與 ccv3/chara PNG。
- 同 Source 兩 revisions。
- Exact duplicate、equivalent candidate、conflict、temporal 與 scope split。
- Corrupt snapshot、chunk、journal、range 與 quote。

文件說明：

- OpenCode-first 操作流程。
- Snapshot/Revision/Chunk/Fact/Conflict 心智模型。
- 哪些檔案可人工修改、哪些不可變。
- Agent/MCP 下一階段整合契約。
- Recovery、verify、rebuild 與安全限制。

最終命令：

```powershell
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 audit --prod --audit-level high
```

Coverage 不得低於既有全域門檻：statements/lines/functions 85%、branches 80%。不得以降低 threshold 使新 package 通過。

## 6. 完成定義

- Source、Revision、Snapshot、Chunk Set、Chunk、Job、Candidate、Fact、Conflict、Decision 與 Provenance schemas 完整。
- 本機與 retrieved source 一律建立 immutable snapshot。
- 同 Source 新內容建立新 revision；同 bytes 重試 idempotent。
- Sliding-window chunking 在 5k–10k target 內 deterministic，保存 overlap、line、character、byte 與 token metadata。
- Extraction jobs 可跨 OpenCode sessions claim、retry、complete 與 resume。
- Source fact evidence 可精確驗證到 quote、range、chunk、revision 與 snapshot hash。
- Exact duplicate、deterministic equivalent、semantic suggestion 與 conflict 分離。
- Accepted fact 只能經 decision 與 expected revision 修改。
- Conflict resolution 完整保存 choose-one/coexist/temporal/scope-split/unresolved/supersede。
- Register/conflicts 可由 journal deterministic rebuild。
- Author fragment fact refs 可追到 snapshot；無效 provenance 可阻斷 strict publish。
- CLI 完整且不依賴 Dashboard；下一階段 MCP 可直接包裝 library。
- 所有 I/O 使用 temp fixtures，不修改正式 `projects/` 或 `exports/`。
- Frozen install、build、lint、typecheck、tests、coverage 與 production audit 全綠。

## 7. 實作順序與切點

執行順序固定為 Task 1 → 13。以下切點必須各自保持 root `check` 通過：

1. Task 4 後：可以安全匯入 source 並驗證 snapshot/revision/event。
2. Task 5 後：可以 deterministic chunk。
3. Task 7 後：可以提交具可驗證 evidence 的 candidates。
4. Task 9 後：可以審核、衝突裁決與 rebuild projections。
5. Task 11 後：Forge strict build 具完整 provenance gate。
6. Task 13 後：CLI 與所有品質門禁完成。

禁止先建立 Agent 提示詞來代替尚未完成的 deterministic API。Sources/Facts 契約穩定並驗收後，才進入 Agents and Workflow。

## 8. 實作校正

實作依已批准的不變量落在 `@card-workspace/schemas`、`@card-workspace/project`、`@card-workspace/ingestion`、compiler provenance gate 與共用 testing builders。OpenCode、CLI 及下一階段 Agent/MCP 的邊界維持為同一 ingestion library API；Agent/MCP 尚未建立，也不以提示詞代替 deterministic API。

Task 13 fixture 採「小型可讀 golden + 程式生成」：Markdown、JSON、YAML 與 chat 保留小型文字檔；大型無章節/跨 chunk、CRLF/Unicode/巨大段落、兩 revisions、V1/V2/V3 card、ccv3/chara PNG 及 corruption 由 `@card-workspace/testing` builders 產生。這避免提交巨大二進位，同時讓未來 ingestion、compiler、CLI 與 MCP 測試可重用同一資料模型。

Task 13 已補齊 Sources/Facts CLI、共用 fixture builders、架構與交易文件。CLI E2E 涵蓋來源匯入、分片、job 狀態、來源驗證、fact 查詢、provenance 驗證與外部路徑拒絕；領域層其餘 candidate/review/conflict 分支由 ingestion 整合測試覆蓋。

2026-07-14 最終自動化驗收結果：

- `install --frozen-lockfile`：通過。
- `check`：build、ESLint、TypeScript 與 29 個測試檔共 203 項測試全綠。
- Coverage：statements/lines 87.09%、branches 81.75%、functions 87.98%，高於既定 85%/80% 門檻。
- Production audit（high）：`No known vulnerabilities found`。

真實 SillyTavern 的 V3 JSON、只有 `ccv3` PNG 與 `ccv3+chara` PNG 人工匯入仍屬 Forge Core 外部驗收，不影響本階段 Sources/Facts 自動化完成狀態。
