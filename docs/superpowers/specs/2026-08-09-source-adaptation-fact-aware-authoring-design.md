# V3 二創角色：Source Adaptation 與 Fact-aware Authoring 設計

日期：2026-08-09  
狀態：已實作（focused vertical slice）

## 1. 目的

本規格補齊 V3 的「二創角色」流程。這裡的二創是：使用者以動漫、漫畫、遊戲、小說等既有作品為靈感，創作出自己心中的角色形象；不是匯入既有 SillyTavern 角色卡，也不是把原作資料原封不動轉成角色卡。

核心要求是：

1. 使用者自己的 Blueprint 可以先完成，並且是創作意圖的最高優先來源。
2. 來源研究產生的 Facts 必須能經過候選來源選擇、事實審查，成為創作階段可用的正式上下文。
3. Facts 不得自動覆寫 Blueprint；只有 Creator 明確引用的 Fact 才成為該段內容的事實依據。
4. 每個明確引用都必須可追溯到 accepted Fact 與來源證據。
5. 原作與使用者心中形象衝突時，要保存「採用哪一方」的創作決定，而不是默默覆寫或直接阻塞整個流程。

本規格只處理二創創作的 intake、Facts 接入 authoring、來源選擇、引用驗證與創作決策；不改動另一個 agent 正在處理的 `2026-08-09-workflow-gates-editable-publish-design.md` 所負責的 editable/publish gate 細節。

## 2. 現況與缺口

V3 已有 Blueprint、SourceCandidate、KnowledgeService、FactReview proposal schema 及 template provenance 欄位，但它們沒有串成二創流程：

- Interview 沒有 `source_adaptation` 分支，二創會退回普通 `character` 流程，來源意圖因而沒有結構化保存。
- `KnowledgeService` 能更新 Fact 狀態，但 accepted Facts 目前主要在 compiler 階段變成 `lore_entries`；Creator 的 zhuji/template context 沒有收到 Blueprint、accepted Facts、來源與適應決策。
- SourceService 目前會在執行研究時替所有未 ingested candidates 自動 approve，無法表達「使用者只選這幾個來源」。
- Template 已有部分 `provenance`/`fact_refs` 形狀，但沒有統一驗證「引用的 Fact 是否 accepted、是否有證據、是否仍有未解衝突」。
- Blueprint 與原作 Fact 發生差異時，沒有正式的 adaptation decision；使用者只能把差異埋在自然語言內容中，後續 Creator 無法知道那是有意改編。

## 3. 設計原則

### 3.1 Blueprint-first，不等於 Fact-free

原作改編的 Blueprint 可以在研究前或研究後建立。Blueprint 表達使用者的創作意圖；Facts 表達經審查的原作資訊。兩者是不同層級的輸入，但無論 Blueprint 先後，Facts Gate 通過前不得開始世界或角色正式 authoring。

### 3.2 Facts 是可選引用的創作材料，但不是可跳過的前置流程

accepted Facts 會進入 Creator context，讓 Creator 能選擇性使用；但原作改編仍必須完成來源與 Facts Gate，才能開始正式 authoring。系統不把所有 Fact 自動拼接到角色欄位，也不要求所有欄位都必須引用 Fact。

### 3.3 明確引用才建立硬約束

Creator 只有在 proposal 的 `provenance` 或 `fact_refs` 明確引用 Fact 時，才對該 Fact 建立可驗證的追溯關係。一般 Fact 引用要求 Fact 已 accepted；若引用加上 `requires_single_value: true`，則還要求該 Fact 沒有未解衝突。

### 3.4 衝突是創作決策，不是全域故障

原作來源互相矛盾，或原作與使用者 Blueprint 不同，不能讓所有創作工作停止。系統要把衝突呈現在 context，並讓使用者/Creator 建立 adaptation decision：保留 Blueprint、採用 Fact、混合、或暫緩。只有明確標成單一值硬約束的引用才會阻塞提交或發布。

### 3.5 來源選擇必須是顯式的

研究只能讀取使用者批准的候選來源。未選取的 mirror、低可信來源或待確認來源不得因為被列在候選清單中而自動進入 ingest。

## 4. 目標流程

```text
source_adaptation intake
        │
        ├── 使用者 Blueprint（可先做）
        │
        ├── source candidates
        │       └── 使用者明確 approve / reject
        │
        ├── source research → chunks → fact candidates
        │
        ├── fact curation → independent fact review
        │       └── accepted / rejected / unresolved conflict
        │
        ├── Creator context
        │       ├── Blueprint / user intent
        │       ├── accepted Facts / evidence
        │       ├── unresolved conflicts
        │       └── adaptation decisions
        │
        ├── typed creator proposals
        │       └── explicit fact_refs / provenance
        │
        └── proposal validation → existing publish/compiler gates
```

Facts Gate 不再被解讀成「Blueprint 必須晚於 Facts」；它的責任是確認被 Creator 明確當成事實依據的輸入可用且可追溯。

## 5. 資料模型變更

### 5.1 Interview 增加 source adaptation intake

在 `InterviewFlow` 增加 `source_adaptation`。角色設定入口先詢問 `card_shape`，再以 `character_origin` 明確確認「完全原創」或「原作改編」；只有後者進入來源角色、作品與辨識資訊問題。引擎仍接受舊版以「二創／同人／原作改編」直接回答工作類型的輸入，但不再把它作為新的首題選項。

Interview completion 產出的 Blueprint 仍走現有 Blueprint artifact 建立流程，但要保存可選的 source adaptation metadata，至少包含：

```ts
type SourceAdaptationIntent = {
  subject_name: string;
  source_medium?: string;
  source_identifiers?: string[];
  adaptation_intent: string;
  canon_policy?: "reference_only" | "canon_inspired" | "canon_faithful";
};
```

其中 `adaptation_intent` 是使用者對「我想創作什麼版本」的描述，不能被來源研究結果取代。舊專案沒有此欄位時視為普通 character flow，保持向後相容。

### 5.2 AuthoringKnowledgeContext

新增一個由 Runtime 從目前 project state 建出的唯讀 context，供 zhuji 與一般 template Creator 共用：

```ts
type AuthoringKnowledgeContext = {
  blueprint?: Blueprint;
  source_adaptation?: SourceAdaptationIntent;
  accepted_facts: FactRecord[];
  unresolved_facts: FactRecord[];
  sources: Array<{
    id: string;
    title: string;
    url?: string;
    status: string;
    revision?: string;
  }>;
  fact_register_revision: string;
  adaptation_decisions: AdaptationDecision[];
};
```

`accepted_facts` 只包含 status 為 `accepted` 的 Fact；`unresolved_facts` 用於讓 Creator 看見候選、衝突與待決定內容，但不把它們當成正式事實。Context 是建立 proposal 時的 snapshot，不允許 Creator 透過 context 直接改 state。

### 5.3 Fact provenance

沿用 V3 現有 `templateProvenanceSchema` 的 `kind: "fact"`，補足舊版需要的可驗證語意：

```ts
type FactProvenanceRef = {
  kind: "fact";
  ref: string; // FactRecord.id
  requires_single_value?: boolean;
  note?: string;
};
```

`fact_refs` 是 Blueprint 或結構化欄位用的簡寫；`provenance` 是欄位/段落/模組的細粒度追溯。兩者均解析成同一套 Fact ref validator，不得各自實作不同規則。

角色 Blueprint/document 若目前缺少 top-level `fact_refs`，補上可選欄位；既有 section/module 的 provenance 與 world entry 的 `fact_refs` 保持相容。

### 5.4 AdaptationDecision

新增可持久化的適應決策記錄，建議作為 project state 中的專用 collection 或 artifact kind，由 Runtime 統一建立：

```ts
type AdaptationDecision = {
  id: string;
  topic: string;
  choice: "keep_blueprint" | "adopt_fact" | "blend" | "defer";
  blueprint_refs?: string[];
  fact_refs?: string[];
  rationale: string;
  created_at: string;
  created_by: string;
};
```

它的用途是保存「這是刻意改編」的理由；它不是把 rejected Fact 變成 accepted，也不是替代 Fact Review。

### 5.5 Source candidate selection

保留 V3 現有 candidate schema 的相容欄位，增加可辨識的使用者決策狀態（可採用 `approved`/`rejected`，或等價的 selection record）。SourceService 執行 ingest 時只接受 approved candidate IDs：

- 未選取的 candidate 保持 pending，不得自動 ingest。
- 使用者明確 reject 的 candidate 不得 ingest。
- 已 approved 的 candidate 才能進入 source revision/chunk/fact pipeline。
- 執行結果要保留 selection snapshot，讓後續 Fact provenance 能知道當時使用了哪一批來源。

## 6. Context 與 Creator 行為

### 6.1 Runtime context

`zhujiContext` 與 `templateContext` 都要呼叫同一個 `buildAuthoringKnowledgeContext(state, options)`，避免兩套 creator context 再次分叉。至少下列創作 kind 必須收到它：

- character / character expansion
- zhuji / palette
- world lore
- relationship
- greetings
- 其他會產生正式內容的 template kind

Context 中同時保留三個清楚分區：

1. `blueprint`：使用者意圖與創作方向。
2. `accepted_facts`：有審查結果、可以引用的原作資料。
3. `unresolved_facts` 與 `adaptation_decisions`：需要判斷或已經刻意偏離的地方。

### 6.2 Creator contract

Creator prompt/contract 要明確要求：

- 先依 Blueprint 形成角色形象，再把 accepted Facts 當作可選依據。
- 若採用 Fact，在輸出的 section/module/field 放入 `provenance` 或 `fact_refs`。
- 若與 Blueprint 不同，建立或引用 adaptation decision，不能用沒有說明的覆寫表示。
- 不得把 `unresolved_facts` 當作已確認事實。

這不改變 Creator 仍以 typed proposal 送出的方式；只補足 proposal 所需的知識輸入與追溯要求。

## 7. 提交與 Gate 驗證

新增共用 `validateFactReferences`（名稱可依現有模組調整），在 template/zhuji proposal 進入 authoring state 前執行：

1. 每個 `kind: "fact"` provenance ref 必須能找到同一 project 的 FactRecord。
2. Fact 必須是 `accepted`；candidate、rejected、pending 或不存在的 Fact 不能成為正式引用。
3. source-derived Fact 必須有 source IDs 與 evidence；沒有證據的人工 Fact 必須標示為 user/creator provenance，不得冒充 source fact。
4. `requires_single_value: true` 的引用若對應 unresolved conflict，提交失敗並回傳可定位的 finding。
5. 沒有被引用的 unresolved conflict 不阻塞普通創作；它仍會在 context 和 review output 中可見。
6. `fact_refs` 與 `provenance` 的結果要合併去重，避免同一 Fact 只因出現在兩個欄位而產生不同判定。

驗證錯誤必須使用結構化 finding，至少包含 code、severity、path、fact_id（如適用）與可操作訊息；不要只回傳一段字串。

現有 compiler 行為保留：正式輸出只把 accepted Facts 編入 runtime lore/metadata；pending/rejected/unresolved Facts 不得被編譯成正式 lore。Compiler 不負責猜測 Creator 是否應該採用某個 Fact，該決定在 authoring proposal 階段完成。

## 8. API / 執行面

V3 Runtime/Server 至少提供下列可呼叫能力（可沿用現有 workspace request envelope）：

- 以 `source_adaptation` 啟動或完成 Interview，並在 Blueprint 中保存 source adaptation intent。
- 列出 source candidates，提交明確 approve/reject 的 candidate IDs。
- 取得包含 Blueprint、accepted/unresolved Facts、sources、decisions 的 authoring context。
- 建立 adaptation decision。
- 提交帶 Fact provenance 的 zhuji/template proposal，回傳共用 Fact validation findings。

這些能力可以先由現有 `workspace_interview_*`、`workspace_template_*` 擴充；不要求一次重建 V2 的 task/lease/chunk/job 系統。重要的是 API 不得再把 source candidate 的「列出」當成「全部批准」。

## 9. 測試要求

### 9.1 Interview / Blueprint

- `source_adaptation` 入口會留在 source adaptation flow，不會降級成 character flow。
- 二創訪談完成後可在沒有 Facts 的情況下建立 Blueprint。
- Blueprint 會保留 `source_adaptation` metadata 與使用者 adaptation intent。

### 9.2 Fact-aware context

- accepted Fact 出現在 zhuji/template context。
- pending/rejected/conflict Fact 不出現在 `accepted_facts`，但 unresolved 資訊可被 Creator 看見。
- context 同時包含 Blueprint、source metadata、fact register revision 與 adaptation decisions。

### 9.3 Provenance validation

- accepted、具 source evidence 的 Fact ref 通過。
- pending、rejected、missing Fact ref 失敗，且 finding 能指向 proposal path。
- `requires_single_value` 遇到 unresolved conflict 失敗。
- 沒有明確引用的 unresolved conflict 不阻塞一般 proposal。
- `fact_refs` 與 section/module provenance 混用時判定一致。

### 9.4 Source selection

- 候選清單中只批准一個來源時，SourceService 只 ingest 該來源。
- 未選取與 rejected candidate 不會因執行研究而變成 ingested。
- selection snapshot 能被後續 source/fact provenance 讀到。

### 9.5 Regression

- 普通原創 character flow 不需要 source adaptation metadata 仍能工作。
- 舊 state 缺少新增 optional 欄位時可讀取與建立 proposal。
- compiler 仍只輸出 accepted Facts。

## 10. 非目標與邊界

- 不做 ST 角色卡 PNG/CCv3 匯入；那是不同工作流。
- 不強制所有二創專案先完成 Facts Gate 才能寫 Blueprint。
- 不把所有 accepted Facts 自動填入 personality、description 或 greeting。
- 不在本規格內重做另一個 agent 的 editable/publish gates、交易/CAS 或 compiler 實作。
- 不把 Fact Review 的獨立裁決改成單一 agent 自動接受；fact-reviewer-1/2/3 以獨立身分分工處理同一固定 Review Run，不再以 pass-1/2/3 quorum 表達。
- 不要求本次就完整移植 V2 的背景 worker、lease、job queue；本次只補齊 V3 二創創作真正需要的資料流與安全邊界。

## 11. 實作順序

1. Core schema：`source_adaptation` intake、Blueprint metadata、Fact provenance extension、AdaptationDecision、AuthoringKnowledgeContext 型別。
2. Interview/runtime：建立 source adaptation flow，完成訪談時生成可先於 Facts 的 Blueprint。
3. Source domain：加入 candidate selection，移除「所有未 ingested candidate 自動 approve」的路徑。
4. Runtime context：集中建立並注入 AuthoringKnowledgeContext 到 zhuji/template Creator。
5. Proposal validation：共用 Fact refs/provenance validator，接入 zhuji/template submit。
6. Decision/API：提供 adaptation decision 與 source selection 的 workspace request。
7. Tests：依第 9 節順序加入 unit、runtime integration、compiler regression tests。

完成標準是：使用者可以從二創訪談建立自己的 Blueprint；批准來源後可產生並審查 Facts；Creator 能在 Blueprint 不被覆寫的前提下讀到 accepted Facts；採用的 Facts 有可驗證 provenance；未選來源與未解衝突不會被系統默默當成正式輸入。
