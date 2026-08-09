# Agent、Skill 與 Personality 高階相容遷移設計規格

- 狀態：待審閱
- 日期：2026-08-08
- 目標工作區：`C:\AI\projects\ST-workspace-v3`
- 來源工作區：`C:\AI\projects\card-workspace`

## 1. 背景

舊工作區已具備完整的 Agent、Skill 與 personality 生態：

- 22 個註冊 Agent
- 22 份 personality YAML（含共用 base profile）及 1 份 runtime 輔助文件
- 20 個可重用 Skill
- Creator/Critic 分工、來源研究、事實整理、角色卡、世界設定、MVU、EJS、HTML、匯入與審查等功能

舊架構的主要問題不是功能不足，而是底層工作流資料直接暴露在 Agent 契約中。缺少 `task_id`、`batch_id`、`candidate_id`、`revision`、`capability`、檔案格式或儲存欄位時，流程會在尚未完成主要工作前直接中止。

新工作區已採用高階 `workspace.request` 執行層。本規格定義如何把舊 Agent、Skill 與 personality 遷移到新工作區，同時保留既有能力與人格，並移除不必要的底層操作負擔。

## 2. 目標

1. 保留舊工作區提供的高階功能與專業規則。
2. personality YAML 原樣保留，不改變既有語氣、風格與禁止行為。
3. Agent 與 Skill 只處理自然語言 Intent 和必要上下文。
4. 將工作流 ID、儲存格式、路由碼與狀態欄位封裝在 Runtime 內部。
5. 保留舊 Agent ID 的相容路由，避免既有使用方式失效。
6. 缺少選填資料時採用安全推斷或預設值；只有高風險歧義才提出簡短問題。
7. 保留來源可追溯性、Creator/Critic 隔離與禁止捏造等安全規則。
8. 不因外部 fetch、格式或儲存層錯誤而讓整個工作流無法產出可用的部分結果。

## 3. 非目標

- 不重新發明舊 Skill 的領域知識、創作規則或審查標準。
- 不移除來源驗證、事實可信度、唯讀 Critic 或人格禁止行為等安全約束。
- 不讓 Agent 直接呼叫舊的低階 capability 或 MCP 工具名稱。
- 不繞過受控擷取管道、權限檢查或外部服務的安全限制。
- 本階段不實作新的 UI，也不改變已完成的核心 Runtime 行為。

## 4. 核心決策

採用「高階相容適配層」：

```text
使用者 Intent
    ↓
workspace.request
    ↓
Agent Router
    ↓
Agent prompt + Personality + Skill
    ↓
Runtime Adapter（隱藏低階資料與格式轉換）
    ↓
既有核心服務與儲存層
```

人格檔保持原樣；Agent prompt 與 Skill 的操作契約改成高階介面；Runtime 仍可保留必要的內部狀態，但這些狀態不再由使用者或 Agent 組裝。

## 5. 新工作區目錄

```text
ST-workspace-v3/
├─ .agents/
│  ├─ agents/              # 新版 Agent prompt
│  ├─ personalities/       # 舊 personality YAML 原樣複製
│  ├─ skills/              # 遷移後的 Skill
│  ├─ registry.yaml        # 最小化 Agent 登錄
│  └─ aliases.yaml         # 舊 ID 與新版 ID 對應
└─ docs/
   └─ superpowers/
      └─ specs/
         └─ 2026-08-08-agent-skill-personality-migration-design.md
```

舊 `.opencode/prompts` 不直接作為新版執行來源。其角色與專業內容會轉換到 `.agents/agents/` 與 `.agents/skills/`；如需保留稽核依據，可另存於遷移文件，但不載入 Runtime。

## 6. Personality 設計

### 6.1 原樣保留

所有舊 personality YAML 都以原內容複製，包括：

- `tone`
- `style`
- `prohibited_behaviors`
- `inherits`
- Agent 特有的語氣、角色與互動限制

不把 personality 內容重複貼進 Agent prompt，避免兩份規則日後漂移。

### 6.2 載入與檢查

Runtime 在載入 Agent 時解析 personality 繼承鏈。Lint 必須檢查：

- Agent 指定的 personality 檔案存在。
- `inherits` 的父人格存在且沒有循環。
- Agent prompt 只引用指定 personality，不自行覆寫其禁止行為。
- 所有 personality 的 YAML schema 可解析。

## 7. Agent 設計

### 7.1 Prompt 原則

新版 Agent prompt 只描述：

- 角色與目標
- 可處理的高階 Intent
- 可使用的 Skill
- 產出形式（草稿、建議、審查結果或完成結果）
- 安全與禁止行為

Prompt 不描述或要求組裝：

- task、lease、batch、candidate、revision、capability ID
- approval audit 的欄位格式
- 儲存 API 的檔案參數
- 受控 fetch 的內部路由名稱

### 7.2 最小化 Registry

新版 registry 只保留路由所需的欄位：

```yaml
agents:
  - id: source-researcher
    role: research
    personality: source-researcher
    skills: [source-research]
    intents: [research-source, verify-source]
    aliases: [source-research]
```

`role`、`personality`、`skills`、`intents` 是系統設定，不是 Agent 每次執行時要填寫的參數。舊 registry 中只為低階 workflow 而存在的 capabilities、leases、tasks 與欄位契約不遷移到公開 registry。

### 7.3 重複 Agent 的處理

行為完全相同的 Agent 可以在 Runtime 內部共用執行器：

- `fact-reviewer-1/2/3` 共用 Fact Reviewer 執行器，Runtime 自動執行多次獨立審查。
- 同類 Creator/Critic 共用模板，但保留各自 personality、Skill 與舊 ID。

此合併只減少重複設定，不改變原本的獨立審查與隔離語義。

## 8. Skill 設計

每個遷移後 Skill 以以下結構表達：

```text
purpose       解決的問題與適用範圍
knowledge     舊 Skill 的領域知識與工作方法
quality       必須遵守的品質、可信度與安全規則
interaction   缺資料、失敗、不確定時的處理方式
```

Skill 的輸入是 Intent 加上 Runtime 提供的上下文；Skill 的輸出是可讀的草稿、建議、審查結果或完成結果。Skill 不要求 Agent 自行建立底層 payload。

### 8.1 必須保留的專業規則

- Source Research：不可捏造來源；候選、已擷取、已驗證內容必須區分。
- Fact Curation/Review：事實需可追溯；未驗證內容不可標記為正式事實。
- Creator/Critic：Critic 唯讀，不能批准自己的產物。
- Card、World Lore、Greetings、MVU、EJS、HTML：保留舊有格式語義、品質檢查與相依規則。
- 所有人格的 `prohibited_behaviors` 仍有效。

### 8.2 不再由 Skill 管理的資料

以下資料如果仍是儲存或稽核所需，交由 Runtime Adapter 自動處理：

| 資料 | 新版處理方式 |
|---|---|
| task / lease ID | Runtime 自動建立與回收 |
| batch / candidate ID | 由來源服務自動產生，Agent 只看人類可讀名稱 |
| revision | 儲存層自動版本化 |
| capability 名稱 | 由 Router 對應內部服務 |
| approval audit 欄位 | 使用者以自然語言表達批准，Runtime 寫入稽核記錄 |
| `file_path` / `bytes_base64` | Adapter 依內容與環境選擇儲存方式 |
| source format | 由 MIME、延伸名或內容推斷；必要時轉成內部純文字表示 |

## 9. Runtime Adapter

### 9.1 統一入口

Agent 只使用高階入口：

```text
workspace.request(
  "請研究這個角色的官方資料，整理成可用於角色卡的背景"
)
```

Runtime 負責：

1. 判斷高階意圖與適用 Agent。
2. 載入 personality 與 Skill。
3. 自動建立必要的內部識別與狀態。
4. 進行格式轉換、來源保存與產物寫入。
5. 將低階錯誤轉換成可理解的結果。
6. 讓使用者用自然語言繼續中斷或部分完成的工作。

### 9.2 缺資料與錯誤策略

處理順序固定為：

1. 從 Intent、目前專案與既有產物推斷。
2. 套用安全預設值。
3. 由 Adapter 自動補齊或轉換。
4. 只有可能導致錯誤對象、錯誤版本、錯誤權限或不可逆結果時，才詢問一句簡短問題。
5. 外部服務失敗時，保留可用的部分結果並明確標記限制，不暴露底層錯誤碼。

### 9.3 來源研究的特殊處理

- 受控 fetch 被拒絕時，不繞過限制。
- 若已取得可保存的內容，Adapter 嘗試轉成支援的內部表示。
- 若只能取得摘要或候選資訊，結果標記為「未驗證草稿」，不得直接寫入正式事實。
- 若無法保存正式來源，工作流仍可產出研究清單、待補來源或使用者可提供的內容位置，而不是整個流程卡死。

## 10. 相容路由

`aliases.yaml` 保留舊 Agent 名稱與常用呼叫方式，例如：

- `director`
- `source-researcher`
- `fact-curator`
- `fact-reviewer-1/2/3`
- `zhuji-creator`
- `palette-creator`
- `character-critic`
- `relationship-creator`
- `greetings-creator/critic`
- `mode-conversion`
- `card-import-analyst`
- `world-lore-creator/critic`
- `mvu-creator/critic`
- `ejs-creator/critic`
- `html-creator/critic`

直接指定舊 Agent 名稱時，Router 仍能找到新版 Agent；未指定時則由 Director 依 Intent 自動路由。

## 11. 安全與品質邊界

為了降低卡點而刪除的是操作參數，不是安全規則。下列邊界不可由預設值繞過：

- 不捏造來源、引用、批准或完成狀態。
- 不把未驗證資料標記為正式事實。
- Critic 不得修改或批准自己檢查的產物。
- 受控 fetch、權限與外部服務限制不可繞過。
- Personality 的禁止行為優先於一般便利性。
- 對不可逆或高風險操作仍需取得明確意圖。

## 12. 遷移步驟（實作前的設計順序）

1. 建立舊 Agent、Skill、personality 與新版 ID 的對照表。
2. 複製並驗證 personality YAML，不修改內容。
3. 產生最小化新版 registry 與 aliases。
4. 將舊 prompt 轉寫成高階 Intent prompt。
5. 保留 Skill 專業內容，移除其低階 payload 要求。
6. 建立 Runtime Adapter 與錯誤轉換規則。
7. 加入 personality binding、registry、alias 與禁止低階參數的 lint。
8. 以既有高階功能做逐項 smoke test，再執行完整測試與 coverage。

本文件只定義設計，不代表上述步驟已執行。

## 13. 驗收條件

遷移完成後必須滿足：

- 22 個舊 Agent 都有新版對應或明確的相容 alias。
- 22 份 personality YAML 都能載入，繼承鏈完整且沒有循環；runtime 輔助文件會由需要維持舊人格執行語義的 active prompt 載入，並保留遷移參考副本。
- 20 個 Skill 都能由高階 Intent 路由。
- 使用者不需輸入任何底層 ID，即可完成既有主要工作。
- 缺少選填資料不會直接造成流程終止。
- Source Research、Fact Review、Creator/Critic 隔離與來源可追溯性仍成立。
- 來源 fetch 或儲存失敗時能提供部分結果與下一步，而不是只回傳低階錯誤。
- 舊工作區的低階 prompt 不會被新版 Runtime 載入。
- 新工作區既有 `pnpm check`、測試與 coverage 門檻不回退。

## 14. 待審閱決策

本規格需要使用者確認後，才進入下一份「實作計畫」。在實作前不會搬移檔案、不會建立 Agent/Skill 程式碼，也不會改動核心 Runtime。
