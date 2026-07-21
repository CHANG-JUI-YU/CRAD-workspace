# Card Workspace vNext 主架構設計

日期：2026-07-13  
狀態：使用者已批准  
範圍：全新重建 `card-workspace`，不遷移既有草稿與舊 Agent／Skill

## 1. 摘要

Card Workspace vNext 是一套以對話式 Director 為主要入口、以可驗證 TypeScript Forge 為工程核心的 SillyTavern Character Card V3 製作工作區。

它的核心產物不是傳統主卡欄位，而是附著於角色卡的結構化世界書。角色設定支援珠璣模式與調色盤模式，單角色與多角色群像卡使用同一專案模型；來源文本、網路資料與既有角色卡先進入具證據鏈的事實寄存器，再由專職 Agent 建立角色與世界觀草稿。Forge 負責確定性的解析、驗證、規劃、模擬、編譯、診斷及原子輸出。

正式輸出鎖定：

- Character Card V3 JSON。
- 內含 `ccv3` metadata 的 PNG。
- 選配由同一份 Canonical IR 降級產生的 `chara` 相容 chunk。

## 2. 目標

### 2.1 產品目標

- 透過 Director 完成需求訪談、來源整理、角色創作、審查、開場白、世界書規劃與輸出。
- 每個角色可獨立選擇珠璣模式或調色盤模式。
- 同一專案原生支援一名或多名主要角色。
- 將角色設定與多維世界設定編譯為附著世界書。
- 從小說、設定集、聊天記錄、網頁與既有角色卡提取可追溯事實。
- 支援原創、二創、舊卡改造及珠璣／調色盤雙向模式轉換。
- 對 Token 成本、觸發、位置、遞迴與衝突做編譯前模擬。
- 讓未知 V3、SillyTavern extension 在匯入、編輯與輸出間無損保存。
- 透過 Dashboard 管理、預覽、比較、診斷與手動微調專案。

### 2.2 工程目標

- TypeScript monorepo，共享型別、schema、IR、compiler 與測試 fixture。
- AI 與確定性工具嚴格分離。
- 所有修改具備 dry-run、diff、備份、交易式寫入與路徑邊界保護。
- 所有核心能力可由 library、CLI、MCP 與 Dashboard 共用，不重複實作。
- 規格、SillyTavern 相容行為及工作區品質政策分層。
- 以 golden fixture、round-trip、property test 與真實 SillyTavern 匯入驗收。

## 3. 非目標

- 不保留舊 workspace 的程式、草稿格式、Agent 或 Skill 相容層。
- 不遷移現有 `drafts/` 與 `exports/`；使用者自行備份。
- 不把 AI 語意能力偽裝成 Forge 工具能力。
- 不正式輸出 V1 或 V2 角色卡。
- 不把 MVU、EJS、狀態欄、Regex 或第二 API 設為核心依賴。
- 不直接複製第三方受限制授權的提示詞、文件或範例內容。
- 不以「SillyTavern 能載入」取代 Character Card V3 schema 合格判定。

## 4. 核心設計原則

### 4.1 三層規則

所有驗證規則必須標明所屬層級：

1. **CCv3 Normative**：Character Card V3 Living Standard 的必要結構與語義。
2. **SillyTavern Compatibility**：SillyTavern 的位置、遞迴、觸發及 extension 實際行為。
3. **Workspace Policy**：空白 description、XML 包裝、風格、Puppeteering、遞迴預設等創作品質政策。

Workspace Policy 不得冒充 CCv3 必要規格。每條 policy 都有規則 ID、嚴重度、說明、適用範圍與可否覆寫。

### 4.2 單一權威與衍生資料

- 作者草稿是創作意圖的權威來源。
- 事實寄存器是來源事實與證據的權威來源。
- Canonical IR 是一次編譯期間的語意權威，不手動編輯。
- Build Manifest、索引、Token 報告、編譯輸出都是衍生資料。
- 匯入卡片的未知欄位保存在 passthrough 區，不因 schema 尚未認識而消失。

### 4.3 固定骨架、內容可擴充

必要欄位由 schema 保證，作者可在 `sections` 或 `extensions` 增加自訂內容。編譯器只對已知語意做結構化處理，未知內容需保留並給出可理解的預設編譯策略。

### 4.4 Stable Identity

專案、角色、來源、證據、事實、世界觀實體、世界書條目與 greeting 都有不依賴檔名或顯示名稱的 stable ID。重新命名不得破壞引用、歷史、diff 或 merge。

## 5. 六層架構

### 5.1 互動編排層

- Director 狀態機。
- 使用者決策閘門。
- 專職子 Agent 與隔離 Skill。
- 任務續接、revision 與 artifact 狀態。

### 5.2 作者專案層

- Project Manifest。
- 來源庫、事實寄存器與衝突報告。
- 珠璣角色草稿。
- 調色盤角色草稿。
- 多維世界設定。
- 專案級 Greetings。
- 工作區 policy 與 plugin profile。

### 5.3 Canonical IR 層

- 與作者檔案及 SillyTavern JSON 解耦的角色與世界書語意。
- Stable entry ID、activation、position、recursion、route、provenance。
- 三層 extensions passthrough。

### 5.4 Forge 編譯層

`Parse → Validate → Normalize → Plan → Simulate → Policy Lint → Emit → Audit → Atomic Publish`

### 5.5 Adapter 與 Plugin 層

- CCv3 JSON。
- PNG `ccv3` 與選配 `chara`。
- V1/V2/V3 Import。
- 獨立 Lorebook。
- 選配 MVU／EJS／狀態欄／Regex／第二 API。

### 5.6 操作入口層

- TypeScript library。
- CLI。
- MCP server。
- Dashboard。
- Query、JSON Patch、diff、audit 與 round-trip 工具。

## 6. Monorepo 佈局

```text
card-workspace/
  apps/
    dashboard/
  packages/
    schemas/                 # 作者模型、IR、CCv3、policy schema
    project/                 # 專案讀寫、索引、交易與 migrations
    ingestion/               # 來源快照、分片、證據定位、去重
    compiler/                # normalize、plan、simulate、lint、emit
    adapters-ccv3/           # JSON、V1/V2/V3 import
    adapters-png/            # PNG chunks 與 round-trip
    diagnostics/             # 結構、相容、政策與內容報告
    plugins/                 # 官方選配 plugin SDK 與內建 profiles
    cli/
    mcp/
    testing/                 # fixtures、builders、ST 驗收輔助
  agents/                    # OpenCode 專職 Agent
  skills/                    # 每個 Agent 的專用規則包
  projects/                  # 作者專案
  exports/                   # 正式輸出；不作資料來源
  docs/
  opencode.jsonc
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

套件不得反向依賴 app、CLI 或 MCP。`compiler` 只依賴 domain packages，不知道呼叫來自何種 UI。

## 7. 作者專案模型

### 7.1 專案目錄

```text
projects/<project-id>/
  project.yaml
  workflow.yaml
  policies.yaml
  sources/
    manifest.yaml
    snapshots/
    chunks/
  facts/
    register.yaml
    conflicts.yaml
  blueprint.yaml
  characters/
    <character-id>/
      character.yaml
      zhuji/                  # 或 palette/，二選一
      palette/
  world/
    people/
    geography/
    organizations/
    history/
    concepts/
    systems/
    items/
    events/
  greetings.yaml
  extensions/
  passthrough/
  .build/
    manifest.json
    ir.json
    provenance-index.json
    token-report.json
    trigger-report.json
    audit.json
```

`zhuji/` 與 `palette/` 對單一角色互斥。schema 與編譯前驗證同時阻止混用。

### 7.2 Project Manifest

`project.yaml` 至少包含：

```yaml
schema_version: 1
id: project_stable_id
title: 顯示名稱
kind: character_card
characters:
  - id: character_stable_id
    mode: zhuji
    role: primary
card:
  name: 卡片名稱
  profile: minimal_worldbook
  avatar: assets/avatar.png
output:
  json: true
  png: true
  v2_backfill: false
policies:
  profile: workspace-default
plugins: []
```

多角色卡可有多個 `primary`；其世界書核心條目按角色分開，greetings 保持專案級。

### 7.3 珠璣模式

珠璣模式保留七個語意模組：

1. 外顯。
2. 內質。
3. 外延。
4. 外延擴展。
5. 特質細化。
6. 場景語料。
7. 自我介紹。

模組7是角色對自身、他人與關係的認知及自我陳述素材，屬常態角色設定並編入世界書。模組7不是 `first_mes`，不得被映射到開場白。

### 7.4 調色盤模式

調色盤模式包含：

- 基礎信息。
- 性格調色盤：底色、主色調、點綴、場景衍生。
- 三面性：觸發、能量、語料、身體行為、功能、過渡與滲透。
- 二次解釋：避免模型把複雜性格扁平化或誤讀的校準說明。

### 7.5 自訂章節

兩種模式都允許：

```yaml
sections:
  - id: stable_section_id
    title: 自訂標題
    content: ...
    compile:
      category: character_detail
      activation: keyed
extensions: {}
```

未知 `extensions` 保留；已知 `compile` 欄位經 schema 驗證。

### 7.6 Greetings

`greetings.yaml` 是專案級場景資料：

- 一個 primary greeting 對應 `first_mes`。
- 其餘一般 greeting 對應 `alternate_greetings`。
- 群組限定 greeting 對應 `group_only_greetings`。
- 每個 greeting 可同時安排多名角色。
- 每個 greeting 保存場景、出場角色、視角、玩家自由度與 provenance。
- Greetings Critic 必須檢查 Puppeteering、封閉式結尾、角色一致性及群像歸屬。

## 8. 來源與事實管線

### 8.1 支援來源

- 本機 TXT、Markdown、JSON、YAML 及聊天匯出文字。
- 既有 Character Card V1/V2/V3 JSON 或 PNG。
- 經 Agent 擷取的網頁、百科、Wiki、Fandom、訪談與官方資料。
- 原創訪談中由使用者直接提供的設定。

可透過 adapter 增加其他文件格式；核心不將特定文件解析器寫死。

### 8.2 來源快照

每個來源保存：

- Stable source ID。
- 類型、URI 或本機相對路徑。
- 標題、作者、語言、取得日期。
- 內容 hash 與 byte size。
- 網頁的擷取時間與 canonical URL。
- 本機不可變快照或明確的外部引用。
- 來源層級：官方設定、常見二創、單作者二創、使用者原創。

### 8.3 流式分片提煉

- 依 tokenizer 切成目標 5k–10k token 的重疊視窗。
- 優先在章節、段落、對話邊界切分。
- 每片保存字元範圍、行號、章節、前後重疊與 hash。
- 大型來源可中斷續接；已完成且 hash 未變的分片不重跑。
- Agent 只處理分片與必要相鄰上下文，不一次吞入全文。

### 8.4 事實寄存器

每項事實至少包含：

```yaml
id: fact_stable_id
subject: entity_stable_id
predicate: appearance.hair
value: 黑色長髮
classification: source_fact
confidence: 0.95
evidence:
  - source_id: source_stable_id
    chunk_id: chunk_stable_id
    chapter: 第三章
    lines: [120, 124]
    quote: 原文引句
status: accepted
```

`classification` 僅允許：

- `source_fact`：來源直接支持。
- `reasonable_inference`：由多項證據推論。
- `creative_completion`：為可玩性新增，不能冒充原作事實。

### 8.5 去重與衝突

- Forge 以 subject、predicate、正規化 value、來源及時間做候選去重。
- 語意是否同義由 Fact Curator 判斷，Forge 保存決策。
- 不同值並存時建立 conflict，不靜默覆寫。
- 使用者或 Director 可選擇採信、並存、時間分期或標記未決。
- 增量安全追加器只自動加入全新事實；修改已批准事實需 patch 與審核紀錄。

### 8.6 網路搜尋責任

Agent 負責：

- 中、英、日名稱與別名展開。
- 搜尋、來源判讀、摘要、證據提取與可信度建議。

Forge 負責：

- URL、標題、日期、快照、hash、去重、衝突、schema 與落盤。

網路內容不得未經事實寄存器直接進角色草稿。

## 9. Blueprint 與創作

`blueprint.yaml` 是可驗證的創作契約，描述：

- 專案目的、受眾、語言與調性。
- 每名角色的模式、核心概念與關係定位。
- 允許使用的 facts 與待補空白。
- 原作忠實度與創作補全界線。
- 世界觀範圍。
- Greetings 需求。
- 世界書與 Token 初步預算。
- 需由使用者決定的 gates。

Creator 只可使用 Blueprint、已批准 facts、所屬 Skill 與必要上下文。Critic 不共享 Creator 的生成上下文，只讀產物、Blueprint、facts 與負面檢查規則。

## 10. Agent 與 Skill 架構

### 10.1 Director

Director 只負責：

- 判斷工作流入口。
- 一次一題的需求訪談。
- 建立與推進狀態機。
- 管理使用者閘門。
- 委派專職 Agent。
- 彙整差異與決策，不直接生成完整角色模組。

### 10.2 專職 Agent

| Agent | 唯一責任 |
|---|---|
| Fact Curator | 來源提取、證據、事實分類、去重與衝突建議 |
| Zhuji Creator | 依 Blueprint 生成或修訂珠璣模組 |
| Palette Creator | 依 Blueprint 生成或修訂調色盤模組 |
| Character Critic | 審查角色模組的一致性、具體性與反 AI 問題 |
| Greetings Creator | 建立專案級單人或群像開場白 |
| Greetings Critic | 檢查 Puppeteering、場景開放性與角色一致性 |
| Mode Conversion | 執行珠璣與調色盤的語意轉換 |
| Card Import Analyst | 分析舊卡內容、欄位、世界書與模式候選映射 |
| World Lore Creator | 從 facts 或原創 Blueprint 建立多維世界設定 |
| World Lore Critic | 檢查世界觀衝突、依賴、冗餘與可觸發性 |

每個 Agent 只載入自己的 Skill。Creator Skill 只含正面生成規則；Critic Skill 才含禁詞、套路與失敗模式，避免負面提示污染創作。

### 10.3 可維護性與性格分層

Agent 與 Skill 必須讓使用者不修改 TypeScript 即可自行調整：

- Agent 定義、Skill 規則、工具權限與工作流綁定使用可直接編輯的 Markdown／YAML。
- 每個 Skill 保持單一職責，入口文件只負責索引與載入條件；詳細規則按主題拆入 references。
- 共用術語與不變量集中管理，不在多個 Skill 複製貼上。
- Agent 的輸入、輸出與 handoff 使用版本化 schema，提示詞修改不能繞過結構驗證。
- `opencode.jsonc` 只負責註冊與權限，不承載大段創作規則。
- 提供靜態檢查，驗證 Agent 引用的 Skill、reference、工具與 schema 都存在，並偵測循環引用、失效名稱及孤兒文件。
- 提供最小 fixture 與回歸案例，讓使用者修改 Skill 後能快速確認路由、輸出格式與核心規則未被破壞。

Agent 性格與工作契約分離。工作契約定義責任、工具、輸入、輸出、禁區與品質閘門；性格 profile 只調整語氣、互動節奏、價值偏好與表達風格，不得改變權限或 schema。首輪重建使用中性 profile，待所有 Agent 核心能力穩定後，再由使用者逐一設定性格。

### 10.4 工作流狀態

`workflow.yaml` 具備：

- `stage`：目前階段。
- `revision`：單調遞增版本。
- `artifacts`：草稿、來源、報告的狀態與 hash。
- `gates`：pending、approved、rejected、superseded。
- `tasks`：可續接工作單位。
- `decisions`：決策摘要、選項、時間與影響。

禁止只以「檔案存在」判定已完成。

## 11. Canonical IR

### 11.1 角色與條目

IR 將作者模組正規化成語意節點，再規劃為世界書條目。核心 entry：

```ts
interface CanonicalLoreEntry {
  id: string;
  ownerId?: string;
  category: string;
  title: string;
  content: ContentFragment[];
  activation: ActivationPolicy;
  placement: PlacementPolicy;
  recursion: RecursionPolicy;
  route?: RuntimeRoute;
  provenance: ProvenanceRef[];
  extensions: JsonObject;
}
```

### 11.2 Activation Policy

支援：

- `constant`：核心身份與核心人格常駐。
- `keyed`：主關鍵字與 secondary 邏輯。
- `conditional`：由選配 plugin 提供條件式啟動。
- `disabled`：保存但不注入。

Planner 依 Token、召回風險、使用頻率與依賴決定預設，不以條目數量作唯一依據。

### 11.3 Placement Policy

IR 使用語意位置，不直接散播 ST magic number。CCv3 adapter 產生 `before_char`／`after_char` fallback；ST adapter 在 entry extensions 輸出 0–7 position、depth、role 或 outlet。

### 11.4 Recursion Policy

遞迴策略明確分為：

- 是否可被其他條目內容觸發。
- 啟用後是否可觸發下一層。
- 是否延遲至遞迴階段。
- 最大遞迴層級與依賴圖。

Workspace 預設可採雙隔離，但允許經驗證的 lore chain 覆寫。雙遞迴不是 CCv3 必要條件。

### 11.5 Provenance

每個內容片段可追溯至：

- 使用者直接輸入。
- 事實寄存器 fact ID。
- Creator inference。
- 模式轉換來源節點。
- 匯入卡片欄位或 entry ID。

## 12. Forge 編譯流程

### 12.1 Parse

- 遞迴讀取專案 allowlist 內 YAML／JSON。
- 聚合所有語法錯誤，不在第一個錯誤停止。
- 每個錯誤包含檔案、行、列、JSON path 與建議。

### 12.2 Validate

- 驗證 project、workflow、facts、blueprint、角色模式、world、greetings 與 plugins。
- 驗證 stable ID 唯一、引用存在、單角色模式互斥。
- 將 CCv3 schema、ST compatibility 與 workspace policy 分開報告。

### 12.3 Normalize

- 展開 defaults。
- 將作者自訂章節轉成標準內容片段。
- 保留未知 extension 與 future fields。
- 將名稱、別名與引用解析為 stable ID。

### 12.4 Plan

- 將角色核心、角色細節、語料、關係與世界觀規劃成條目。
- 核心身份與核心人格預設常駐。
- 語料、關係、地理與深層細節預設按需。
- 產生 insertion order、keys、secondary keys、position、recursion 與依賴。
- 任何作者明確覆寫都保留並接受 linter 檢查。

### 12.5 Simulate

- 使用與目標模型匹配或可配置 tokenizer。
- 報告每條 Token、常駐總量、位置分布、最壞同時啟動量。
- 以測試對話模擬 keys、secondary、regex、scan depth、group 與 recursion。
- 顯示未觸發、過度觸發、互相遞迴與 budget eviction 風險。

### 12.6 Policy Lint

預設 profile 包含：

- 主卡 `description/personality/scenario/mes_example` 清空。
- 角色與世界設定以編譯期 XML 邊界包裝。
- 開場白 Puppeteering 檢查。
- 角色模組與 greetings 一致性。
- 敘事套路與禁詞採密度、語境與嚴重度，不採不可覆寫的全域硬禁。
- 遞迴採安全預設，但可由已驗證策略覆寫。

### 12.7 Emit

- 從 IR 產生 canonical V3 JSON。
- 所有必要欄位、三層 extensions 與 `group_only_greetings` 完整。
- 不產生非必要 V1 root mirrors。
- PNG 使用合法 `tEXt` chunk：`ccv3` 小寫 keyword，UTF-8 JSON 後 Base64。
- 選配 `chara` 必須從同一 IR 做真正 V2 降級，不可只改 discriminator。

### 12.8 Audit 與 Publish

- 在記憶體或 staging directory 完成 schema、policy、PNG 與 round-trip audit。
- strict profile 失敗時不得修改正式 exports。
- 成功後以同磁碟暫存檔、fsync 與 atomic rename 發布。
- 產生 machine-readable JSON 與人類可讀 Markdown audit。

## 13. Character Card V3 與 SillyTavern 相容

### 13.1 主卡政策

`minimal_worldbook` profile：

- `name`、greetings、必要 metadata 有值。
- `description`、`personality`、`scenario`、`mes_example` 清空。
- 完整角色設定進 `data.character_book.entries`。
- `creator_notes` 僅作不進 prompt 的專案說明。

這是 workspace policy，不是 Character Card V3 normative 規格。

### 13.2 Extensions Preservation

必須深層保存：

- `data.extensions`。
- `data.character_book.extensions`。
- 每個 `entry.extensions`。
- 未知 canonical future fields。

Merge policy 預設物件 deep merge、陣列 replace；個別 plugin 可在 schema 中聲明其他策略。未知資料不可因 parse 後重建物件而消失。

### 13.3 Import

- V1：辨識六個 legacy 根欄位並建立完整 V3 defaults。
- V2：補 `group_only_greetings`、entry `use_regex` 及 V3 defaults。
- V3：接受 `3.x` 匯入並提示未知版本能力；輸出固定 `3.0`。
- PNG 同時有 `ccv3` 與 `chara` 時以 `ccv3` 為權威，不盲目 merge。
- 匯入後保留原始卡快照與 passthrough，再由 Card Import Analyst 提出映射。

### 13.4 Decompile

反編譯不是單純抽出三個欄位。流程為：

1. Adapter 解析 canonical 與 extension。
2. 保存原始 JSON/PNG metadata。
3. 依 entry 結構、標題、XML 與內容分析候選角色及世界觀。
4. Card Import Analyst 提出珠璣或調色盤映射與信心。
5. 使用者確認後建立可立即驗證與重新編譯的完整專案。
6. Round-trip 報告列出已知有損、未映射及 passthrough 內容。

## 14. 雙向模式轉換

雙向模式轉換是 Agent 語意任務，不是 Forge 複製資料夾：

- 珠璣 → 調色盤：收斂線性細節，建立底色、主色調、點綴、衍生、三面性及二次解釋。
- 調色盤 → 珠璣：展開性格機制為外顯、內質、外延、特質、場景語料與自我介紹。
- 來源草稿永不原地覆寫。
- 轉換建立 side-by-side revision，保存 source node → target node provenance。
- Forge 驗證目標骨架完整、模式互斥及引用正確。
- 使用者先比較 diff，再批准切換 active mode。

模式轉換不承諾逐字可逆，但必須做到事實與主要創作意圖可追溯、不靜默遺失。

## 15. 多維世界設定

世界設定按人物、地理、組織、歷史、概念、制度、物品與事件分類。每個實體：

- 有 stable ID、別名、摘要、細節與關係。
- 可引用 facts、角色及其他世界觀實體。
- 有 activation、placement、recursion 及 Token 覆寫。
- 共享 provenance 與關係索引，但不與角色核心模組混成同一檔。
- 編譯器依分類提供預設，不依目錄位置硬編碼不可覆寫規則。

## 16. Dashboard

### 16.1 定位

Dashboard 不是主要創作入口。它用於：

- 專案與角色總覽。
- 工作流進度、gates 與 Agent 產物。
- Schema-aware YAML 表單與完整文字編輯器。
- 事實、證據、來源與衝突比較。
- 珠璣／調色盤 side-by-side diff。
- 世界書 entry、依賴與遞迴圖。
- Token budget 與觸發模擬。
- Greetings 預覽與審查。
- 編譯、audit、round-trip 及 exports 管理。

### 16.2 編輯模型

- 草稿表單依文件 schema 生成，不用 V3 `data.*` 表單編輯任意 YAML。
- Advanced mode 提供 Monaco 或等價編輯器。
- 儲存前 parse、schema validate、diff preview。
- 使用 RFC 6902 patch 交易，不整檔盲寫。
- Draft 與 Export 是不同資源型別；切換視圖不保留可寫的錯誤選取。

### 16.3 本機安全

- 預設只綁 loopback。
- 寫入 API 要求 session token 與 Origin 檢查。
- 所有路徑用 `path.relative`、realpath 與 symlink/junction 檢查限制在 workspace。
- 寫入目錄及副檔名採 allowlist。
- Dashboard 不提供偽造的 MCP 啟停狀態；程序操作必須由真實 health/PID 驗證。

## 17. CLI 與 MCP

### 17.1 CLI 命令族

```text
card-workspace init
card-workspace source add|snapshot|chunk
card-workspace facts validate|conflicts
card-workspace project validate
card-workspace query
card-workspace patch --dry-run
card-workspace plan
card-workspace simulate
card-workspace compile
card-workspace audit
card-workspace import
card-workspace decompile
card-workspace diff
card-workspace roundtrip
```

### 17.2 MCP 工具原則

- 工具採小而明確的輸入 schema。
- `characterId`、`moduleName` 與檔名不能直接拼接為路徑。
- 修改工具預設 dry-run，確認後以 revision token 提交。
- 大檔採分頁、range 或 artifact reference，不把整份內容塞回上下文。
- MCP 不提供「提煉成功」等虛假語意工具；Agent 產生候選 facts，再由 Forge 驗證與保存。
- 所有工具回傳 structured errors、warnings、artifact IDs 與 next actions。

## 18. Query、Patch 與交易

- Query 使用受限 JSONPath 或 typed selectors，只讀作者模型與衍生 manifest。
- Patch 採 RFC 6902，需帶 base revision 防止 lost update。
- Apply 前完成路徑 allowlist、schema、引用與 policy 預檢。
- Dry-run 回傳 semantic diff、受影響 artifacts 與需重建範圍。
- Commit 建立備份與 journal；任何步驟失敗全部回滾。
- 不提供任意 filesystem patch 或任意程式碼執行。

## 19. Plugin Profile

MVU、EJS、狀態欄、Regex、第二 API 為官方選配 profile：

- Plugin 只能透過版本化 SDK 讀取 Canonical IR。
- Plugin schema、產物、依賴與 policy 必須宣告。
- Runtime route 使用結構化 enum，不依 comment 前綴作唯一語意來源。
- MVU schema 變更要傳播至 InitVar、更新規則、EJS path、UI path 與 greetings override。
- 遠端資產必須鎖 commit/hash，不保存 API key 到角色卡或 localStorage。
- 所有 LLM 派生字串在 UI 層 escape；富文字採 allowlist sanitizer。
- Plugin 失敗不能破壞核心 V3 專案或 exports。

## 20. 錯誤處理與可觀察性

### 20.1 診斷格式

每項診斷包含：

- 穩定規則 ID。
- 規則層級與嚴重度。
- 檔案、行列、JSON path 或 IR node ID。
- 問題、證據、影響與建議修正。
- 是否可自動修正。

### 20.2 失敗原則

- 解析錯誤聚合報告。
- Strict compile 在 publish 前失敗。
- 未決 gate 不用 debug 字串污染卡片欄位。
- 無 fallback 時明確失敗，不假裝套用預設。
- 部分來源或 Agent 任務失敗可續接，不標記整階段完成。

### 20.3 Build Trace

每次 build 記錄：

- 輸入 revision 與 hash。
- Compiler、schema、policy、plugin 版本。
- 每個 pass 的摘要與耗時。
- 產物 hash、audit 結果與發布路徑。

## 21. 測試策略

### 21.1 單元與 Property Tests

- Schema defaults、strict/passthrough 邊界。
- Stable ID 與 rename。
- Path traversal、symlink/junction、危險檔名。
- Activation、secondary、regex failure、recursion 與 ordering。
- Token budget 與 deterministic planner。
- RFC 6902 revision、rollback 與 idempotency。

### 21.2 Golden Fixtures

至少包含：

- 空值合法 V3。
- 單角色珠璣。
- 單角色調色盤。
- 多角色混合模式。
- 模組7獨立於 greetings。
- 多角色 primary、alternate、group-only greetings。
- 多維世界設定與 lore chain。
- V1、V2、V3、未來 3.x 匯入。
- 未知巢狀 extensions 與 future fields。
- Unicode、大型 metadata、錯誤 Base64、錯誤 JSON、錯誤 CRC。
- PNG、APNG、雙 chunk 衝突及 ancillary chunks preservation。

### 21.3 Round-trip

- Author drafts → IR → V3 → import → IR，語意等價。
- JSON → PNG → JSON，V3 payload 等價。
- V3 import → 無關欄位 patch → export，未知資料等價。
- Decompile → recompile，所有未映射資料仍在 passthrough 或明列有損。
- 珠璣 → 調色盤 → 珠璣，facts 與主要意圖有 provenance 對帳。

### 21.4 整合與真實驗收

- CLI、MCP、Dashboard 共用相同 compiler 結果。
- Strict failure 不落正式輸出。
- Dashboard concurrent edit 產生 revision conflict。
- 以受控版本 SillyTavern 實際匯入 golden JSON/PNG。
- 驗證世界書觸發順序、位置、Token eviction 與 greetings 顯示。

## 22. 實作工作流切割

本主規格不以單一巨型實作計畫落地。後續分成六份可獨立驗收的 plan：

1. **Foundation**：monorepo、schemas、project I/O、交易、CLI 骨架、測試基座。
2. **Forge Core**：Canonical IR、planner、simulator、CCv3 JSON/PNG、audit、round-trip。
3. **Sources and Facts**：快照、分片、證據、事實寄存器、衝突與增量合併。
4. **Agents and Workflow**：Director、專職 Agent、Skills、workflow state、gates、OpenCode 設定。
5. **Dashboard**：專案管理、schema editor、diff、圖譜、模擬、audit 與本機安全。
6. **Optional Plugins**：MVU/EJS/狀態欄/Regex/第二 API SDK 與 profiles。

依賴順序：Foundation → Forge Core；Sources and Facts 可在 Foundation 後與 Forge Core 後半平行；Agents 依賴 Foundation 與來源契約；Dashboard 依賴穩定 library API；Plugins 最後進行。

Agent 工作流階段先完成中性的契約、工具權限、Skill 結構、schema 與回歸測試；性格 profiles 排在核心與選配插件穩定後，作為最後一個獨立設計與調校工作項目。

## 23. 切換策略

- 直接建立全新目錄結構與套件，不在舊程式內漸進修補。
- 舊程式、skills、agents、dashboard 與文件移出正式路徑或刪除，避免誤執行。
- 先建立最小 end-to-end vertical slice：單角色 → 世界書 → V3 JSON/PNG → audit。
- 再加入多角色、雙模式、來源事實、反編譯、轉換與 Dashboard。
- 每一工作流達到驗收條件後才移除對應的臨時 scaffold。

## 24. 驗收條件

vNext 核心完成需同時滿足：

- 單角色與多角色專案皆可混合使用不同角色模式。
- 單一角色無法同時啟用珠璣與調色盤。
- 模組7編入世界書且永不誤作 greeting。
- 來源事實具可驗證引句、章節、行號、hash 與分類。
- 衝突不靜默覆寫。
- V1/V2/V3 可匯入；V3 JSON/PNG 可正式輸出。
- 三層未知 extensions 與 future fields round-trip 不遺失。
- Token 與觸發模擬可重現，budget 超標可阻斷。
- Strict compile 失敗不修改 exports。
- JSON 與 PNG 通過 schema、CRC、round-trip 與真實 SillyTavern 匯入。
- Director、CLI、MCP、Dashboard 對同一 revision 產生相同編譯結果。
- Dashboard 僅能在 workspace allowlist 內交易式寫入。
- 所有核心 package 有單元、golden、整合與回歸測試，CI 必須通過 typecheck、lint、test、build 與 dependency audit policy。

## 25. 已確定決策

- 以全新核心直接切換，不保留舊版相容。
- 主要入口是 Director，Dashboard 為管理與微調工具。
- 主卡採 minimal worldbook profile。
- 單角色與多角色皆為首版核心。
- 每個角色獨立選模式，單角色情況下兩模式互斥。
- Greetings 為專案級，模組7不是開場白。
- 來源文本、二創精煉、網路搜尋與世界觀提取皆為核心需求。
- AI 做語意工作；Forge 做確定性工程工作。
- 正式輸出只鎖定 V3 JSON/PNG。
- MVU 等進階能力採選配 plugin profile。
- 規範、相容行為及工作區政策分層。
- Agent／Skill 必須模組化、可由使用者直接修改且具引用與回歸檢查。
- Agent 性格與工作契約分離，性格設計延至核心功能完成後。

## 26. 規格自審結果

- 無 TBD、TODO 或未定義 placeholder。
- 架構與資料流一致：來源先進 facts，再進 Blueprint、角色／世界觀、IR 與編譯。
- 模組7與 greetings 的責任無衝突。
- 空白 description 與雙遞迴已明確降為 workspace policy。
- CCv3 canonical position 與 SillyTavern extension position 已分離。
- 匯入、反編譯與模式轉換均明確區分 Agent 語意步驟與 Forge 驗證步驟。
- 主規格規模大，但已拆成六個具依賴關係的實作工作流；後續不得用一份巨型 plan 同時實作。
