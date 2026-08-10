# 設計藍圖：修復 BUG-17/18/19（user evidence 例外、rejected candidate 解決、source execute 快照）

日期：2026-08-10
範圍：BUG-17（user-provided accepted fact 的 provenance 例外無效）、BUG-18（拒絕 source-research candidate 仍可能永久卡 publish）、BUG-19（SourceService.execute 使用全專案 approved 候選，非 operation snapshot）

## 背景

- BUG-17：`workflow-gate.ts` reportFacts 中 `unproven` 判定（約 275-284 行）：`if (fact.source_ids.length === 0 && !fact.evidence.some(userProvidedEvidence)) return true;` 之後仍無條件 `if (references.length === 0) return true;`——即使 evidence 文字已標記為 user/manual/provided，無來源 reference 的使用者明示事實仍被判 unproven（FACT_PROVENANCE_MISSING）。
- BUG-18：`workflow-gate.ts` reportSourceResearch（93-125 行）：unresolved 判定只看候選是否已被 ingest（`match === undefined || !sourceCandidateIds.has(match.id)`），沒有把 `state.candidates` 的 `status === "rejected"` 視為已解決——使用者正確拒絕低品質來源後仍報 SOURCE_RESEARCH_NOT_INGESTED / SOURCE_RESEARCH_OFFICIAL_REQUIRED。
- BUG-19：`domain/src/index.ts` SourceService.execute（285-400 行）：`const candidates = initial.candidates.filter((candidate) => candidate.status === "approved");` 讀取全域 approved 候選，而非該 operation 的 selection snapshot；並行 execute 可讀到相同候選並各自 ingest，commit 時無重新驗證 candidate 是否已被其他 operation ingest。

## 設計原則

1. 向後相容：無 `selection_snapshot` 的候選（舊資料、手動 fixture）維持全域行為；有 snapshot 才限定 operation。
2. rejected 是終局狀態：被明確拒絕的候選不阻塞 publish，也不參與 official 要求。
3. 並行安全：ingest 前與 commit 回調內雙重檢查 candidate 現行狀態，已 ingested 則跳過不重複新增 source。
4. 使用者明示事實（evidence 文字含 user/manual/creator/provided 標記）不需要來源 reference 即可視為 proven。

## BUG-17：userProvidedEvidence 例外分支

`packages/domain/src/workflow-gate.ts` reportFacts unproven 判定改為：

```ts
const unproven = accepted.filter((fact) => {
  if (fact.source_ids.length === 0) {
    if (fact.evidence.some(userProvidedEvidence)) return false;
    return true;
  }
  const references = fact.evidence_refs ?? [];
  if (references.length === 0) return true;
  return references.some((reference) => { ...原 source/chunk 檢查... });
});
```

- `userProvidedEvidence`（70-72 行）正則不變：`/(?:^|[\s:])(?:user|manual|creator|provided)(?:$|[\s:])/iu`。
- 語意：無 source_ids 且 evidence 含 user 標記 → proven；無 source_ids 且無標記 → unproven；有 source_ids → 維持原 evidence_refs 檢查。

## BUG-18：rejected candidate 視為已解決

`packages/domain/src/workflow-gate.ts` reportSourceResearch：

1. unresolved 判定：`match === undefined → unresolved；match.status === "rejected" → 已解決；否則 !sourceCandidateIds.has(match.id)`。
2. official 檢查同理：`match === undefined || match.status === "rejected" → 不算官方已入庫`（rejected 的官方候選不構成 SOURCE_RESEARCH_OFFICIAL_REQUIRED 阻塞）。
3. outOfPolicy（SOURCE_DOMAIN_NOT_ALLOWED）不變。

## BUG-19：execute 使用 operation snapshot

`packages/domain/src/index.ts` SourceService.execute 三處修改：

1. 候選篩選（290 行）：
```ts
const candidates = initial.candidates.filter(
  (candidate) => candidate.status === "approved" &&
    (candidate.selection_snapshot === undefined || candidate.selection_snapshot.operation_id === operationId)
);
```
- `selectCandidates` 與 `resume` 建立的候選均有 `selection_snapshot`，因此只會命中本次 operation 的候選；無 snapshot 的舊候選維持全域相容。

2. acquire 前跳過檢查（domain policy 檢查之後）：
```ts
const preState = await this.repository.read();
const preCandidate = preState.candidates.find((item) => item.id === candidate.id);
if (preCandidate !== undefined && preCandidate.status === "ingested") {
  completed.push(candidate.id);
  if (isOfficialCandidate(candidate)) officialCompleted.add(candidate.id);
  continue;
}
```
- 並行 operation 已入庫的候選視為完成，不重複新增 source。

3. commit 回調內 race 保險（currentOperation 檢查之後）：`current.candidates` 中該 candidate 已 `ingested` 時，僅追加 progress（"來源已被並行處理入庫。"），不新增 sources、不寫 audit；否則維持原 commit（sources 追加、candidates map ingested、progress 含 source_id、audit source.ingested）。

## 測試策略

- workflow-gate.test.ts：
  - BUG-17：accepted fact 無 source_ids、evidence 含 "user provided" 標記 → 不報 FACT_PROVENANCE_MISSING；同 fixture 改無標記 → 仍報。
  - BUG-18：source_research artifact 的候選對應 candidate 已 rejected → 不報 SOURCE_RESEARCH_NOT_INGESTED；approved 未 ingest → 仍報；官方候選 rejected → 不報 SOURCE_RESEARCH_OFFICIAL_REQUIRED。
- source.test.ts：
  - BUG-19：operation-snapshot——operation-A 與 operation-B 各自 selectCandidates 批准不同候選，execute(A) 只 ingest A 的候選、B 的 approved 候選保持未動；並行 pre-ingested——候選已被標 ingested 時 execute 視為 completed 且不新增重複 source。
- 既有測試（source.test.ts 全部、workflow-gate.test.ts 13 個）必須維持全綠（無 snapshot 相容性）。

## 驗證

- `pnpm build` + `pnpm typecheck` + `pnpm vitest run` + `pnpm agent:lint` 全綠。
- Commit：「V3.8: 修復 BUG-17/18/19(DS)」。
