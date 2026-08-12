# ST Workspace V3 第三次完整靜態 Audit

- 日期：2026-08-11
- 檢視目標：`C:\AI\projects\ST-workspace-v3`
- 基準分支：`main`
- 基準 Commit：`d4802f3`（`V3.2fix: 修復 UX2-05 artifact 工作台與 UX2-12 文件同步`）
- Git 狀態：`main...origin/main [ahead 6]`
- 方法：靜態閱讀與跨層資料流追蹤；本次沒有執行測試，也沒有修改產品程式碼

## 一、結論摘要

Audit 2 的修復已明顯補強 V3：多角色來源訪談、strict Fact Review Run、Blueprint-derived manifest、圖片驗證、transaction journal、Dashboard 與 CCv3/PNG 輸出都已不是「只有 schema 沒有執行」的狀態。

但目前仍不能判定為「所有主要工作流都可靠閉環」。本次確認 14 項缺口：

- P0：2 項。Dashboard 事實裁決閉環，以及既有專案訪談遷移會直接卡住或破壞正式狀態。
- P1：9 項。包含二創 coverage、Fact revision、operation identity/lease、Publish Plan、mixed-mode、多角色上下文與內建網路搜尋。
- P2：3 項。包含 DNS rebinding、零圖片診斷與知識 refresh 語意。

最重要的總判定：

1. 全新、單一 mode、由具備外部聯網能力的 Agent 透過 typed proposal 操作，現有 V3 已可完成相當完整的多角色二創卡。
2. 只靠目前 Dashboard／CLI 自己進行網路搜尋與事實裁決，仍做不到可靠閉環。
3. 10 名以上角色在資料模型上可表示，但 Fact context、review context、逐題訪談、N² 關係矩陣與全量 materialization 都沒有為這個規模設計。
4. 程式碼精簡不應先做大規模搬檔；應先完成第 1～5 批正確性修復，再以穩定行為拆分大型模組。

## 二、Audit 範圍與限制

本次追蹤以下主路徑：

- 新專案、多角色、source adaptation、continue、existing-world、character expansion 訪談。
- source search／selection／fetch、knowledge refresh、fact curation、strict fact review、coverage gate。
- natural request、typed proposal、needs_input resume、crash recovery、operation lease。
- Required Artifact Manifest、workflow gate、Build Plan、compiler、JSON/PNG publish。
- Dashboard／REST／MCP 邊界。
- 10+ 角色時的 context、關係、review 與持久化規模。

本報告是靜態 audit。以下項目都有明確程式碼路徑支持，但仍應在修復時加入 regression test；未執行測試代表本報告不宣稱目前測試套件的通過／失敗狀態。

## 三、仍存在的 BUG

## P0：會阻斷核心工作流或破壞正式狀態

### BUG3-01：Dashboard／REST 的 strict Fact Review 閉環仍不可用

證據：

- `packages/runtime/src/index.ts:3031-3059` 的 Dashboard 入口用 `factReviewOperationId()` 尋找既有 `kind === "review"` operation；使用者直接在 Dashboard 按「建立 Review Run」時，專案未必已有 review operation，因此會得到 `OPERATION_NOT_FOUND`。即使找到，也可能把 fact review 掛在不相干的角色審查 operation 上。
- `packages/server/src/dashboard.ts:1843-1850` 把 `run.candidate_set_revision` 傳成 `expected_projection_revision`。前者是固定候選集合 hash；`KnowledgeService.applyReviewBatch()` 需要的是會隨每筆決策更新的 `reviewRunProjectionRevision`。兩者資料內容不同，第一筆裁決即可得到 `FACT_PROJECTION_STALE`。
- `packages/server/src/index.ts:352-376` 的 `factDecisionsValue()` 宣告 evidence、evidence_refs、coverage，實際卻一律重建為空陣列。REST reviewer 無法補 evidence、chunk reference 或 coverage，也就無法修復 `needs_evidence`／coverage 缺口。
- `packages/server/src/index.ts:678` 在未提供 reviewer 時直接使用 `director`；Dashboard 沒有傳 reviewer，導致一般裁決不是由 `fact-reviewer-1/2/3` 執行，獨立 reviewer 的語意被繞過。
- `packages/runtime/src/index.ts:2763-2786` 的 Dashboard snapshot 只回傳 `candidate_set_revision`，沒有回傳目前可提交的 `projection_revision`。

影響：Dashboard 看起來已有完整 fact adjudication UI，實際上可能無法成功送出第一筆；即使繞過 stale 檢查，也無法用 REST 補證據與 coverage。這對任何需要來源事實的二創專案都是 P0。

建議修正：

1. 建立專用 `fact_review` operation command；`startFactReviewRun()` 應原子建立或重用該 operation，不得依賴任意舊 review operation。
2. Dashboard snapshot 回傳 `projection_revision`；每次 mutation 後刷新，再使用新的 projection。
3. server boundary 直接重用 core Zod schema，不要手寫會丟欄位的 parser。
4. 非 conflict 裁決由 runtime 指派下一位 `fact-reviewer-1/2/3`；只有 conflict endpoint 可固定 Director。
5. Regression 至少覆蓋：無既有 review operation、第一筆與第二筆決策、補 evidence、補 coverage、conflict、reviewer rotation。

### BUG3-02：continue／existing-world／character-expansion 的目標專案遷移仍會改壞狀態

證據：

- `packages/runtime/src/project-manager.ts:236-317` 先在 placeholder 回答，再把整份 `placeholderState.interview` 覆寫到 target。
- `packages/runtime/src/project-manager.ts:274-275` 不論 placeholder interview 是否已 complete，都把 target 設為 `project_status: "interviewing"`。continue 在選定 target 時已完成，因此結果回報 completed，target 卻停在 interviewing。
- 原本 target 的完整 interview history 被替換，不是追加一個可追溯的 continuation session。
- existing-world 完成後，`packages/runtime/src/index.ts:1117-1131` 只有 character expansion 走 merge；world flow 直接 `createBlueprintArtifact(state, precheck, ...)`。existing-world 的 `interviewCharacterSubjects()` 回傳空 roster，因此新 Blueprint／precheck 會取代原有 roster 與 source-adaptation intent。
- `packages/runtime/src/project-manager.ts:149`、`:253` 的提示允許「名稱或路徑」，實際 selector 沒有比較完整 `item.path`；輸入完整路徑會找不到。
- 找不到 target 時，continue interview 已經 complete，卻只回傳 needs_input，沒有把 current question 還原成可重新輸入 target 的狀態。
- target commit 與 placeholder cleanup 是兩個 repository commit；第二個失敗時會留下重複 operation／interview。
- `mergeExpansionIntoBlueprint()` 用 `character-${maxOrdinal + 1}` 配置 ID，沒有檢查既有 ID；import／手動 roster 的 ordinal 與 ID 不一致時可能碰撞。

影響：續作回報成功但 project status 不正確；補世界可能抹掉既有角色／二創設定；錯誤 target 可能無法在同一訪談中修正。這是 Audit 2 BUG2-11 的未完整收斂。

建議修正：

1. 先選定並驗證 target，再在 target 上建立獨立 `InterviewRun`，不要搬移／覆寫 project 的唯一 interview。
2. continue 只切換專案並回傳原 status，不建立 Blueprint、不把 target 設為 interviewing。
3. existing-world 與 expansion 都使用通用 `patchBlueprint(previous, changeSet)`；world patch 只改 world 欄位，保留 roster、primary、source adaptation、relationships 與未受影響方向。
4. target selector 統一支援 project_id、project_name、basename 與 resolved full path；歧義名稱要 needs_input。
5. 使用 durable handoff／跨 repository transaction，或把 placeholder 保留到 target commit 與 cleanup 都完成後再標記 migrated。
6. 新角色 ID 以「第一個未使用 ID」或穩定 UUID 配置，不由 ordinal 猜測。

## P1：常見工作流、可信度或發布一致性問題

### BUG3-03：二創 Fact coverage 依賴暫態 interview.flow，primary 也用陣列第一名

`packages/domain/src/workflow-gate.ts:418-464` 只有 `state.interview.flow === "source_adaptation"` 才執行角色 coverage。continue／world／character expansion 會改寫 interview flow；即使最新 Blueprint 仍有 `source_adaptation`，coverage gate 也可能被跳過。

同一段以 `subjects.forEach((subject, index)...)` 與 `index === 0` 套用 primary 的六項必要 coverage，而不是讀 Blueprint 的 `primary_character_id`。重新排序 roster 或明確指定非第一名 primary 時，事實要求會套錯角色。

建議修正：建立共用 `ProjectIntentProjection`，由最新 recorded Blueprint／manifest 判定 source adaptation、roster 與 primary；runtime authoring gate、workflow gate、Dashboard readiness 全部使用同一 projection。

### BUG3-04：accepted fact 合併新證據後不會進 successor Review Run

`packages/domain/src/knowledge.ts:86-99` 的 `mergeFactEvidence()` 保留 target 的 `status`、`review_run_id`、`decision_id`。refresh／curation 在 `:385`、`:464` 合併新來源後遞增 `fact_revision`，但 accepted fact 仍是 accepted；`beginFactReviewRun()` 又只收 `status === "candidate"`。

workflow gate 只確認存在 accepted decision，沒有確認 `fact.fact_revision === decision.resulting_fact_revision`。因此舊 decision 可以繼續替「已新增、未經 reviewer 看過的 evidence revision」背書。

建議修正：

- 將 fact claim 與 evidence set 分開 version；新增 evidence 產生 successor evidence revision。
- 至少在現行模型中，把新 evidence 標成 `pending_evidence_review` 或重新進 candidate run。
- authoring readiness 與 publish gate 比對 accepted decision 的 `resulting_fact_revision`、目前 fact revision 與 source revision。
- successor review 完成前可保留舊 accepted claim 供閱讀，但不得把新 evidence 視為已裁決。

### BUG3-05：同一 curation proposal 內的重複 claim 會建立重複 FactRecord

`packages/domain/src/knowledge.ts:441` 建立 `known`，`:469` 只做 `known.add(key)`，迴圈判斷卻只查初始化時的 `knownFactsByKey`（`:457`）。同一 `claims[]` 內出現兩個相同 subject／predicate／value 時，兩筆都被 push 進 `facts`。

建議修正：用 batch-local `Map<factKey, FactRecord>`；新 fact 建立後立刻更新 map，後續相同 claim 合併 evidence。加入同批完全相同、同批不同來源、既有 accepted + 同批新 evidence 三種測試。

### BUG3-06：needs_input 的一般 resume 又硬編碼 execution identity

`packages/runtime/src/index.ts:3168-3248` 的 `resumePendingIfAnswered()` 在 fallback authoring 使用 `director`（`:3216`），review 使用 `fact-reviewer-1`（`:3233`），沒有使用 operation 的 `execution_snapshot`、target-specific critic 或 capability。

這會讓 Audit 2 已修復的 normal／crash recovery identity 規則，在「使用者回答問題後繼續」這條路徑再次失效；review target 也可能被錯誤 reviewer 處理。

建議修正：所有 request、replay、recover、resume 共用單一 `resolveExecutionContext(operation, optionalAgent)`，並使用同一 typed command dispatcher；移除所有 resume hard-code。

### BUG3-07：Publish Plan 仍未真正由 Blueprint roster 限定

`packages/core/src/index.ts:547-586` 的 `computeBuildPlan()` 取每個 artifact key 的最新版，再排除 technical kind 與未選 mode；它沒有依 Blueprint roster 排除已移除角色的 character、wardrobe、greeting 或其他殘留 artifact。

`packages/domain/src/workflow-gate.ts:144-148` 又把 manifest scope 與 plan IDs 做 union；只要 plan 收進 stale artifact，gate 也會要求 review／reference／issue 檢查。`packages/compiler/src/index.ts:768-783` 最後重新呼叫 `computeBuildPlan()`，不是消費 gate 已驗證的 exact immutable plan。`required-artifacts.ts:376` 甚至把所有 current wardrobe 都加入 manifest scope。

影響：從 Blueprint roster 移除的角色／衣櫃仍可能被打包，或反過來以 missing reference 阻擋發布。Gate、preview、compiler 還不是同一份不可變輸入。

建議修正：建立唯一 `PublishPlan`，內容至少含 Blueprint binding、roster、primary、每角色 mode、feature flags、exact artifact id/revision、image、plugin 與 output paths。gate 驗證該 plan，compiler 只接受該 plan，不自行重新投影。

### BUG3-08：mixed-mode 多角色卡可保留角色、卻移除該角色唯一設定模組

`packages/domain/src/required-artifacts.ts:287-294` 在 exportMode 不等於角色 mode 時，直接把該角色視為 `missing_modules: []`、`mode_complete: true`；character artifact 仍在 scope。compiler 的 global `mode_selection` 又會移除另一 mode 的 module。

現有測試甚至明確接受「alpha=zhuji、beta=palette，選 zhuji 時 beta complete 且 palette module 不在 scope」的結果。最後卡片仍含 beta 角色／關係／greeting metadata，卻沒有 beta 的主要角色設定。

建議修正：分開兩種概念：

- Blueprint 每角色 authoring mode：mixed roster 必須依每名角色保留其必要 mode，通常自動形成 `both` package，不應再問 global mode。
- 同一角色同時擁有兩套完整模式時的 export variant：這時才詢問 zhuji／palette／both。

若產品真的允許「只輸出某 mode 的角色」，Publish Plan 必須連 character、relationship、greeting、wardrobe 與 reference 一起做 roster subset，不能只拿掉 module。

### BUG3-09：operation lease 有 heartbeat，但沒有 end-to-end fencing

`packages/runtime/src/index.ts:1269-1318` 只在 recovery 前後檢查 lease。實際 domain side-effect commits 沒有攜帶 fencing token；lease 到期、另一 worker takeover 後，舊 worker 仍可能完成中途 commit，最後才發現 lease lost。

`renewOperationLease()` 在 read 後 commit，沒有在 transaction mutator 內重新驗證 owner/token；`packages/runtime/src/worker.ts:204-208` 的 interval 只處理 resolved false，沒有 catch renewal 的 CAS／I/O rejection，可能形成 unhandled rejection，且不會把 `leaseLost` 設為 true。

建議修正：

1. lease claim 產生單調遞增 fencing generation；每個 operation side-effect transaction 都必須驗證 generation。
2. renew／release 在 CAS mutator 內重驗 owner、token、expiry。
3. heartbeat rejection 一律轉為 leaseLost、停止新副作用並記錄 typed diagnostic。
4. 對長時間 fetch／compile 使用 AbortSignal；失去 lease 時中止外部工作。

### BUG3-10：server／CLI 宣稱有來源搜尋，但 production runtime 沒有 search provider

`WorkspaceRuntime` 支援可選 `searcher`（`packages/runtime/src/index.ts:873-887`），搜尋時沒有 provider 就得到空陣列（`:1652`、`:2426`）。server 與 CLI 建立 runtime 時只注入 `HttpSourceFetcher`，沒有注入 searcher（`packages/server/src/index.ts:918-922`、`packages/cli/src/index.ts:71-78`）。

因此：

- 外部具備原生 web tool 的 Agent 可以自行 discovery，再提交 `source_research` proposal。
- 使用者也可以直接提供 URL，讓受控 fetch 擷取。
- 但 Dashboard／CLI 對「搜尋某角色官方來源」的自然語言請求不會自行搜尋，通常只得到零候選 needs_input。

建議修正：定義正式 `SourceSearchProvider` adapter，server／CLI 由設定注入；未配置時明確回傳 `SOURCE_SEARCH_PROVIDER_UNAVAILABLE` 與「貼 URL／交由聯網 Agent」next action，不要把「沒有 provider」偽裝成「搜尋沒有結果」。10+ 角色應支援 per-character query、語言、官方域名、去重、分頁與 rate limit。

重要架構決策：
BUG3-10 已重新定義。系統預設來源搜尋模式為 agent_managed：
由具備聯網能力的 Source Researcher Agent 搜尋並提交 typed source_research proposal；
Runtime 不需要內建或預設提供搜尋引擎 Provider。

Runtime Search Provider 僅為可選模式，不得因未配置 Provider 而把 agent_managed
流程判定為失敗，也不得自行新增第三方搜尋服務。

Agent 提供的結果只能建立 source candidate；正式事實仍必須經過 Runtime 擷取 URL、
保存來源、抽取、curation 與 fact review，不能直接成為 accepted fact。

### BUG3-11：大型來源專案的 Fact／Authoring context 無分頁也無角色篩選

`packages/domain/src/knowledge.ts:554-601` 的 `factReviewContext()` 一次回傳目前 run 的全部未裁決 candidates；Dashboard snapshot 也回傳全部 facts、sources、candidates、operations。`packages/runtime/src/index.ts:320-330` 又把全專案 accepted／unresolved facts 放進每一個 creator context；`buildTemplateContext()` 與 Zhuji context 原樣附上整包 knowledge。

10 名角色、多個來源與 sentence candidates 很容易造成：

- reviewer context 過大；
- 每個角色每個 module 都反覆收到其他九名角色的 facts；
- token 成本與延遲線性甚至乘上 module 數；
- 模型把其他角色事實寫錯對象。

建議修正：所有 list/context 使用 cursor；creator context 接受 target character、module、related character IDs 與 coverage filter，只提供相關 accepted facts、必要 world facts、直接關係與 compact project summary。完整 register 留在查詢 API，不要每次注入模型。

## P2：安全、診斷與資料生命週期問題

### BUG3-12：SSRF 防護仍有 DNS rebinding／TOCTOU 窗口

`packages/adapters/src/index.ts:60-61` 先由 `assertTargetAllowed()` 使用自訂 DNS lookup 驗證 IP，隨後 `fetchImpl(current)` 會由底層 HTTP stack 再做一次 DNS resolution。攻擊者可讓第一次解析為 public IP、第二次解析為 private／loopback IP。redirect 每一跳仍有同一窗口。

建議修正：把 HTTP connection pin 到已驗證 IP，同時保留原 Host header／TLS SNI，並驗證實際 remote address；或使用支援 lookup hook 的 dispatcher，讓「驗證」與「連線」使用同一解析結果。加入 rebinding 與 redirect rebinding 測試。

### BUG3-13：完全沒有 image record 時不會產生 CARD_IMAGE_MISSING 警告

`packages/domain/src/build.ts:119-134` 只有 `initial.images.length > 0` 才進入圖片選擇與 warning。零圖片時 compiler 使用內建 placeholder，但 build diagnostics 是空的；「有別人的圖卻沒有 primary 圖」反而會警告。

建議修正：角色卡且 `images.length === 0` 時也加入 warning；獨立 world-only export 可依產品規則不警告。Dashboard readiness、build record、Tavern verifier 使用同一 image readiness projection。

### BUG3-14：knowledge refresh 無法重新處理已知來源，且自動候選仍會淹沒 review

`packages/domain/src/knowledge.ts:348-350` 只處理沒有任何 chunk 的 source。來源一旦被 chunk 過，後續即使 extractor／classification 改善、使用者要求重新整理，也只得到「No new sources」。這個 API 實際是 `processNewSources()`，不是 refresh。

同檔 `sentenceCandidates()`（`:70-75`）會把每個八字以上句子變成 strict candidate；Review Run 又要求目前 candidate occurrence 全部有終局決策。大量官方頁面會產生很多無關導覽、版權、商品與敘述句，使用者必須逐筆 reject 才能過 gate。

建議修正：

- 明確分成 `processNewSources` 與 `reextract(source_ids, extractor_revision)`。
- chunk set、extractor revision、curation run 都要 versioned。
- sentence segmentation 只建立 chunks；正式 FactCandidate 由 Fact Curator／高信心 extractor 產生。
- 支援 reviewer 批次 reject、按來源／分類 triage，但仍保留 exact occurrence audit。

## 四、程式碼精簡與可維護性評估

### OPT3-01：建立唯一 Current Project Projection 與 Publish Plan

目前 latest-by-key 邏輯至少存在於 core、compiler、workflow-gate、conversion、required-artifacts、runtime。它們的排序、fallback 與 scope 已經出現差異。

建議新增只讀投影層，例如：

- `ProjectProjection.currentArtifacts`
- `ProjectProjection.blueprint`
- `ProjectProjection.intent`
- `ProjectProjection.roster`
- `ProjectProjection.factRegister`
- `PublishPlanService.plan(state, selection)`

其他層只能消費投影，不再自行掃 `state.artifacts`。

### OPT3-02：OperationCommand 改成 versioned discriminated union

`packages/core/src/index.ts:431-435` 仍是 `{ type: string; payload?: unknown }`。runtime 各 replay 路徑自行 cast／parse，造成 source select、review、resume 的 shape 漂移。

改成：

```ts
type OperationCommandV1 =
  | { version: 1; type: "source_select"; payload: SourceSelectPayload }
  | { version: 1; type: "fact_review"; payload: FactReviewPayload }
  | { version: 1; type: "template_proposal"; payload: TemplateProposalValue }
  | ...;
```

每一種 command 只有一個 codec 與一個 handler；request／recover／resume 都走同一 dispatcher。

### OPT3-03：以 ExecutionContext 取代位置式 actor／agent 字串

目前 service methods 常見 `(operationId, request, reviewer, auditActor, targetId)`。同型別字串容易互換，也已造成 hard-coded resume bug。

建議使用：

```ts
interface ExecutionContext {
  operationId: string;
  executionAgent: { id: string; role: string };
  initiatedBy: string;
  lease?: FencingLease;
  target?: ArtifactRef;
}
```

這能同時簡化 identity、audit 與 lease 傳遞。

### OPT3-04：HTTP/MCP boundary 必須重用 domain Zod schema

server 目前有大量手寫 `...Value()` parser；`factDecisionsValue()` 已實際造成欄位遺失。建議每個 route 定義 input schema，統一 `parseRequest(schema, body)`，再由同一 error mapper 產生 4xx diagnostic。MCP input schema、REST schema、runtime input 不應維護三份。

### OPT3-05：拆分三個 God Module，但按責任拆，不按行數任意切

目前主要大型檔案：

- `packages/runtime/src/index.ts`：約 3378 行。
- `packages/core/src/index.ts`：約 2917 行。
- `packages/server/src/dashboard.ts`：約 2399 行。
- `packages/server/src/index.ts`：約 895 行。

建議拆法：

- runtime：`interview-application.ts`、`operation-runner.ts`、`operation-recovery.ts`、`fact-review-application.ts`、`build-application.ts`、`dashboard-query.ts`。
- core：`project-state.ts`、`schemas/`、`artifact-projection.ts`、`operations.ts`、`repository/file-repository.ts`、`materialization.ts`、`repair.ts`。
- server：route modules、request schemas、error mapper；Dashboard HTML、CSS、state reducer、API client、各 panel renderer 分離。

先抽出純函式與 schema，再搬 application service；不要一次大改 package boundary。

### OPT3-06：Blueprint binding 改成 dependency fingerprint

目前所有正式 artifact 綁整份 Blueprint precheck revision。新增一名角色會讓原有角色模組全部 stale，即使它們依賴的角色方向未變。10 人專案新增第 11 人時，可能被迫重做 10 人的 review。

建議每個 artifact 保存 dependency fingerprint：

- character/module：該角色 Blueprint slice + world dependency + selected facts。
- relationship：participant roster + relevant relationship direction。
- world：world slice + world facts。
- greeting：primary／participants + scenario dependencies。

只有 fingerprint 改變的 artifact 需要 re-author/review。

### OPT3-07：ProjectState 需要 query/read model 與分頁

目前 Dashboard 與 model context 常直接映射整份 state。建議把 persistence aggregate 與 read model 分開：summary endpoint 只給 counts／current status；facts、artifacts、audit、operations 各自 cursor 查詢。這也能減少 server／Dashboard 對 ProjectState 欄位的直接耦合。

### OPT3-08：materialization 改成增量 write-set

`FileProjectRepository.writeTransactional()` 每次 commit 都呼叫 `materializedFiles(state)`；該函式遍歷所有歷史 artifacts，並重建 sources manifest、chunks、facts register 與公開檔案。10 人、40～70 個 mode modules、多次 review/revision 時，每個小 audit commit 都會重算與重寫大量未變檔案。

保留 transaction journal，但由 mutation 回傳受影響 projection／write-set；只有 project.json 與真正變動的 materialized files 進 transaction。另以背景 reconcile／repair 驗證完整投影。

### OPT3-09：Knowledge pipeline 分離 chunking、extraction、curation、review

現在 `knowledge.ts` 同時負責 chunk、句子解析、Fact merge、Review Run、conflict 與 legacy review。建議拆成：

- `source-chunking.ts`
- `fact-candidate-store.ts`
- `fact-curation-service.ts`
- `fact-review-service.ts`
- `fact-projection.ts`
- `fact-policy.ts`

這不是單純搬檔；先定義 candidate/evidence/review revision invariants，再拆服務。

### OPT3-10：清除 legacy 雙路徑與過時 fallback

目前仍保留 legacy `applyReview`／`fact_review_passes`、legacy compiler fallback、無 Blueprint 時 full-artifact gate、自然語言多重 fallback。應先建立 migration version 與 telemetry，確認現有專案已轉換，再把 legacy 行為限制在 import/migration adapter，避免新專案走到兩套語意。

### OPT3-11：大型關係模組改用 sparse graph，compile 時再產生總覽

`relationshipsDocumentSchema` 要求每個 source-target 有序 pair，包含 self-pair。10 人就是 100 個 perspective；20 人是 400 個。技術上能存，但修改一條關係會使整份 artifact revision 與 review 全失效。

建議正式資料使用：character summaries + self perspective + 有內容的 directed edges + groups；缺少 edge 代表未定義／中性，而不是 schema error。compiler 仍可輸出使用者要的單一「關係」總覽 worldbook entry，不必把使用者介面改成每角色一份總覽。

### OPT3-12：用 scenario builders 與 invariant tests 取代重複巨型 fixture

現有測試已有不少大段手工 ProjectState。建議建立 `projectScenario()` builder，提供 source-adaptation、10-character mixed roster、reviewed artifact、accepted fact、published state 等語意化方法。再用 invariant test 驗證：

- gate artifact IDs 等於 compiler artifact IDs；
- accepted fact revision 必有 matching decision revision；
- operation side effect 必有有效 fencing token；
- current Blueprint roster 外 artifact 不得進 Publish Plan。

## 五、10+ 角色網路來源原作改編卡可行性

### 短答

「資料模型上做得到；目前 main 需要有條件地做，還不適合宣稱 Dashboard／CLI 可穩定一條龍完成。」

### 已具備的能力

- 多角色 roster 沒有 10 人上限。
- 訪談已保存每角色 `source_subject:<id>`、source medium、identifiers 與 authoring mode。
- Blueprint 有 per-character source subjects、primary、world、relationships 與方向。
- source candidate／approval／HTTPS fetch／chunks／structured facts／strict review／provenance 已存在。
- primary 需要 6 個固定 coverage + 1 個 optional；其餘每名 supporting character 需要 3 個 coverage。10 人合計至少 34 個 subject-dimension coverage 槽位，但不一定要 34 個 facts，單一高品質 fact 可覆蓋多個 dimension。
- Zhuji 每角色 7 模組、Palette 每角色 4 模組；10 人約 40～70 個 mode artifacts，另有 10 個 character artifacts、世界、關係、greetings、選填 wardrobes/plugins。
- compiler／CCv3 worldbook 可以放入多個角色模組、世界設定、單一關係總覽與 greeting。

### 現在的限制

| 面向 | 現況判定 | 原因 |
| --- | --- | --- |
| 10 人訪談與 Blueprint | 可行但很慢 | 依選項約需 80～100 次逐題回答，缺少批次 roster editor／Blueprint editor |
| 內建網路搜尋 | 尚不可行 | server／CLI 未配置 searcher；需外部聯網 Agent 或人工提供 URL |
| URL 擷取與來源保存 | 可行 | 受控 HTTPS fetch 已存在，但需補 DNS pinning |
| Fact curation | 有條件可行 | typed Fact Curator 路徑可用；sentence auto extraction 會產生大量低價值 candidates |
| Dashboard Fact Review | 目前不可行 | BUG3-01 的 operation、projection、payload 與 reviewer 問題 |
| Agent typed Fact Review | 可行但需小心 | 可避開 Dashboard parser，但 evidence merge revision 與 context 規模仍有缺口 |
| 10 人角色創作 | 有條件可行 | 建議同一 mode、逐角色／逐模組執行；目前 knowledge context 未按角色裁切 |
| 世界設定 | 可行 | 全新專案可由 Blueprint + accepted facts 產生；existing-world 先受 BUG3-02 影響 |
| 關係總覽 | 技術可行、操作成本高 | 10 人 schema 要 100 個 directed perspectives（含 self） |
| mixed Zhuji／Palette | 目前不可靠 | 選單一 global mode 可留下角色但拿掉其唯一設定 |
| Review 與 publish | 規模大 | 約 50～90 份 current content artifacts 需要 exact-revision review |
| CCv3／PNG 輸出 | 基本可行 | 同 mode、乾淨 roster 最安全；Publish Plan scope 尚需修正 |

### 若現在一定要做，最低風險條件

1. 使用全新專案，不走 continue、existing-world 或 expansion。
2. 10 名角色先全部使用同一 mode；若 mixed，打包固定選 both 並人工核對每人世界書條目。
3. 使用具備原生網路工具的 Source Researcher Agent，提交真實 URL 的 `source_research` proposal；或人工貼官方 URL。
4. 以 typed Fact Curator 產生結構化 facts，不依賴整頁 sentence auto extraction。
5. 用 typed fact-review proposal，而不是目前 Dashboard fact buttons。
6. 每個 creator 只處理一名角色／一個 module，人工提供該角色相關 accepted fact 子集，避免全域 context 汙染。
7. 發布前人工比對 Blueprint 10 人 roster、worldbook 角色條目數、每人 module 完整度、relationship participants、greeting primary 與 cover。

在這些限制下「可以完成」，但仍屬受控 workaround，不是低風險的一鍵流程。完成第 1、3、4、5、6 批後，才適合把答案提升為「工作區本身可穩定完成」。

## 六、建議工作順序與可併做範圍

| 批次 | 一起處理 | 主要檔案範圍 | 可否平行 | Code Review |
| --- | --- | --- | --- | --- |
| 第 1 批：Fact trust chain | BUG3-01、BUG3-03、BUG3-04、BUG3-05 | domain knowledge/workflow-gate、runtime fact API、server route/dashboard | 同批內不要拆成多 Agent；共享 revision invariant | 必須，重點檢查 evidence、projection、reviewer identity、publish gate |
| 第 2 批：Targeted project flows | BUG3-02 | runtime project-manager、interview application、Blueprint patch | 可與第 5B 網路安全平行；不要與第 1 批同時改 runtime index | 必須，需 state-transition review |
| 第 3 批：Operation execution | BUG3-06、BUG3-09 | runtime operation/recovery/worker、repository transaction context | 不建議拆開；identity 與 lease 都應走同一 ExecutionContext | 必須，需 concurrency／replay review |
| 第 4 批：Exact Publish Plan | BUG3-07、BUG3-08、BUG3-13 | core projection、required-artifacts、workflow-gate、build、compiler | 同批一個 Agent；不可讓 gate/compiler 各自修 | 必須，需逐 ID 比對 gate 與 compiler |
| 第 5A 批：Search provider | BUG3-10 | runtime interface、新 search adapter、server、CLI | 可與第 5B 平行，先約定 adapter interface | 必須，功能與錯誤語意 review |
| 第 5B 批：Fetcher security | BUG3-12 | adapters network transport | 可與第 2／5A 平行；避免同改 adapters index 同區塊 | 必須，安全 review |
| 第 6 批：Large-project data flow | BUG3-11、BUG3-14 | fact context、authoring context、dashboard query、knowledge extraction | 第 1 批完成後再做，因 API shape 會改 | 必須，需 10-character scenario review |
| 第 7 批：核心去重 | OPT3-01～04 | projection、command union、ExecutionContext、boundary schemas | 先小步抽取；每次只移一條 vertical slice | 必須，屬結構性重構 |
| 第 8 批：模組拆分與效能 | OPT3-05～12 | core/runtime/server split、incremental materialization、sparse relationship | 正確性批次穩定後才開始 | 必須；以行為不變與效能基準審查 |

### 建議的實際執行原則

- 第 1～4 批完成前，不做大規模檔案重新命名或 package 搬移。
- 每批只接受一個行為主題與一個 commit chain，避免把 refactor 混入 bug fix。
- 第 1、3、4 批不能只看單元測試；Code Review 必須手工核對「誰建立 operation、誰有權執行、哪個 revision 被驗證、compiler 最後消費哪些 artifact」。
- 第 5B 可由獨立 Agent 同時進行，因為它主要位於 adapters；合併前仍要檢查與第 5A 的 transport interface 是否衝突。
- 第 7 批開始前，先建立 10-character source-adaptation acceptance fixture，作為重構保護網。

## 七、建議的最終大型驗收情境

修復完成後，應以一個全新 10 角色專案做端到端驗收：

1. 10 名 source-adaptation 角色，其中至少 3 名 Zhuji、3 名 Palette，另有同角色雙 mode variant。
2. 每名角色至少一個官方或高可信來源，另有重複佐證、無關句子、衝突事實與來源擷取失敗。
3. primary 不在 roster 第一位，用來驗證 primary coverage 與 cover selection。
4. 完成 34 個 coverage 槽位、分頁 fact review、successor evidence review。
5. 建立世界、10 人關係、primary／alternate／group-only greetings、部分 wardrobes。
6. 從 Blueprint 移除一人，確認該人的 character/module/wardrobe 不進 Publish Plan。
7. 模擬 operation restart、lease takeover、CAS conflict，再確認沒有重複副作用。
8. 分別輸出 mixed roster、單角色雙 mode variant 的 JSON／PNG，核對 gate artifact IDs 完全等於 compiler trace IDs。
9. 將 PNG 實際匯入 SillyTavern，驗證空白 card fields、greetings、世界書名稱、10 人中文模組條目、關係與衣櫃。

## 八、最終判定

V3 現在已經是可用系統，不再是早期「合約很多、執行很少」的骨架；Audit 2 的修復成果大多確實存在。

不過，Fact Review Dashboard、targeted interview、Fact revision、Publish Plan 與 lease fencing 仍有跨層斷點。這些修好之前，不建議直接把 10 人網路二創專案當作穩定主流程。

最值得優先投入的不是更多功能，而是把四個唯一真相建立起來：

1. 唯一 Project Intent／Blueprint projection。
2. 唯一 Fact revision／Review decision invariant。
3. 唯一 ExecutionContext／fencing lease。
4. 唯一 immutable Publish Plan。

這四項完成後，再拆 God modules、做分頁與增量 materialization，才能同時達成「易維護、易修正、精簡、方便後續內容與功能增加」。
