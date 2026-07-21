# SillyTavern V3 終極生成工作流系統設計與規格說明書 (System Design & Specs) - 最終決定版

本文件詳述了為 SillyTavern V3 量身打造的「終極生成工作流 (Ultimate Workflow)」之系統架構、元件設計、資料流以及與現有 `card-workspace` 架構的整合規範。

本系統在保護現有架構高度可維護性、非侵入式特性的前提下，完美融入「珠璣模式」與「調色盤模式」雙重設定邏輯，並外加反向智能解包、實體 PNG 卡片合成、草稿熱修補、二創事實提取、決策暫存與安全阻斷等高級智能工具箱。

---

## 1. 系統架構與技能拆分 (System & Skill Architecture)

為避免規則混淆、節約 Token、分離「設定設計」與「文學創作」，本系統將核心技能進行**完全解耦拆分**。系統共包含六個獨立 Subagent 技能：

1. **Director (狀態主控機 `st-director`)**：管理流程狀態，在 Stage 1 引導模式選擇，依據模式分流載入對應的 Creator 與 Critic。在所有設定鎖定後，於 Stage 5 召喚 Greetings 技能組撰寫開場白。
2. **珠璣模式 (Zhuji Mode) 技能組**：
   - `st-creator-zhuji-skill`：專職負責 7 個線性設定模組（外顯、內質、外延、外延擴展、特質細化、場景語料、自我介紹）的 YAML 生成。
   - `st-critic-zhuji-skill`：專職依據 7 模組白描標準進行品質審查。
3. **調色盤模式 (Palette Mode) 技能組**：
   - `st-creator-palette-skill`：專職負責 4 個階梯式設定模組（基礎信息、性格調色盤、三面性、二次解釋）的 YAML 生成。
   - `st-critic-palette-skill`：專職依據調色盤與三面性的邏輯邊界進行品質審查。
4. **開場白專屬 (Greetings System) 技能組 (全新引入)**：
   - `st-greetings-skill`：專職開場白文學創作。在所有設定模組鎖定後，全局俯瞰角色設定，撰寫首發開場白（`first_mes`）與交替開場白（`alternate_greetings`）草稿。
   - `st-critic-greetings-skill`：專職開場白品質把關。審查並剔除 Closed Endings、Puppeteering（控制玩家言行）、AI-isms 禁詞與人稱出戲。
5. **Forge Core (MCP 伺服器 `st-forge`)**：底層工具箱，提供編譯、解包、圖像合成、熱修補、Regex Linter 與決策暫存註冊表等 API。

---

## 2. 核心雙模式設計與草稿規格 (The Dual-Mode Paradigms)

在 `模組0_概覽.yaml` 中，新增 `設定模式` 屬性（可選 `珠璣` 或 `調色盤`）。

### A. 珠璣模式 (Zhuji Mode) - 極致詳細版
沿用現行 V3 架構的線性設定模組（模組 1 至 5 為設定，模組 6 至 7 為語料與心理動機參考）。
*   **目錄結構**：`模組1_外顯.yaml`、`模組2_內質.yaml`、`模組3_外延.yaml`、`模組4_外延擴展.yaml`、`模組5_特質細化.yaml`、`模組6_場景語料.yaml`、`模組7_自我介紹.yaml`。

### B. 調色盤模式 (Palette Mode) - 生存策略與寫意版
引入調色盤、三面性與生存防禦策略。
*   **目錄結構**：`基礎信息.yaml`、`性格調色盤.yaml`、`三面性.yaml`、`二次解釋.yaml`。
*   **重疊度共識**：允許「性格調色盤中的衍生（Derivatives）」與「三面性中的語料/身體行為」在細節、動作與台詞上產生適度的自然重疊與呼應，不進行字面上的死板限制，以提供更豐富的 LLM 上下文鎖定。

---

## 3. 獨立解耦的開場白系統 (Greetings System)

開場白屬於文學性白描與環境渲染，與結構化設定必須在草稿層與生成步驟上完全解耦。

*   **草稿存放位置**：`drafts/<project>/<character>/greetings.yaml`（與所有設定 YAML 徹底分離，保持純淨度）。
*   **YAML 撰寫規格**：
    ```yaml
    first_mes: |
      （首發開場白：具備極佳的畫面感、環境烘托與留白懸念，嚴禁 puppeteering 與閉合結尾）
    alternate_greetings:
      - |
        （交替開場白 1：適用於不同場景、關係或好感度階段）
      - |
        （交替開場白 2）
    ```
*   **編譯期行為 (`st-forge`)**：編譯器讀取 `greetings.yaml`，將內容精準寫入主卡的 `first_mes`（首發開場白）與 `alternate_greetings`（交替開場白陣列）欄位。**（此處主卡的開場白欄位不再淨空，保證酒館完美觸發首句對話！）**

---

## 4. 世界觀設定與非角色條目 (World Lore System - 選填)

為支持豐富的世界觀（如組織、歷史背景、特殊道具、場景），本工作流導入與 `tavern-workspace` 高度對齊的世界設定條目。
*   **目錄位置**：`drafts/<project>/世界設定/`（**100% 完全選填**。若無此目錄，編譯器自動跳過）。
*   **條目檔案格式**：每個 `.yaml` 檔案代表一個世界書條目，例如 `世界設定/侍奉部.yaml`：
    ```yaml
    條目設定:
      comment: "世界設定_侍奉部"
      enabled: true
      constant: false                   # 是否常駐藍燈
      selective: true                  # 是否啟用二級關鍵字
      selectiveLogic: "AND ANY"        # 觸發邏輯
      position: "before_char"          # 插入位置：before_char (0) / after_char (1) 等
      insertion_order: 100             # 優先順序

    關鍵字:
      primary: ["侍奉部", "club", "service club"]
      secondary: []

    設定內容: |
      侍奉部是總武高中的一個神祕社團，旨在「授人以漁」解決學生的委託和煩惱...
    ```
*   **編譯期補全規格**：
    - **雙遞迴常態防禦**：編譯器強制在世界書條目中注入 `"prevent_recursion": true` 與 `"exclude_recursion": true`，防止條目在酒館執行時觸發遞迴爆炸。
    - **XML 自動包裹**：根據檔案名稱與設定，自動用 XML 標籤包裹條目內容（如 `<scene>` 或 `<item>`），保證 Draft 檔案的純淨。

---

## 5. 按需雙向模式轉換 (Bi-directional Mode Conversion)

為支持創作者在「珠璣模式」與「調色盤模式」之間自由切換與互補，本系統增設**雙向模式轉換**功能。
*   **觸發機制**：此功能非 Workflow 自動步驟，僅在使用者明確發出指令時按需執行（On-demand）。
*   **並行分身專案 (Side-by-Side Clone Project) 策略**：
    - 當執行 `convert_chara_draft_mode` 時，原草稿專案 `drafts/雪乃/` 保持完全不動。
    - 轉換結果將被輸出到一個全新的並行專案目錄（如 `drafts/雪乃-調色盤/`），並自動更新其 `設定模式` 標記。
    - **優點**：100% 避免 AI 轉換時覆寫或遺失創作者手寫的原始細節，支持創作者對比兩版導出效果。

---

## 6. 智能反編譯解包與舊卡升級 (Vanilla Decompiler)

`st-forge` 中的 `decompile_chara_card` 實行**「智能判定 ＆ 雙軌還原」**的解包策略，使其成為舊卡無痛升級至 V3 工作流的強大傳送門：

1. **模組化卡片軌道 (High-Fidelity Reconstruct)**：
   - 若檢測到世界書中含有本系統特定的 `${charName}_設定` 或 `<personality_palette>` 等標籤，自動判定對應模式（珠璣/調色盤），並精準反解析為各自的 YAML 草稿。
2. **普通角色卡軌道 (Vanilla Decompile)**：
   - 若檢測到普通卡（所有設定塞在主卡欄位，世界書為空），自動預設為 `珠璣` 模式，並建立 `模組0_概覽.yaml`。
   - 將主卡的 `personality` 與 `description` 內容寫入 `drafts/<characterId>/imported-base.yaml` 作為參考底稿。
   - 將主卡的 `first_mes` 寫入 `模組7_自我介紹.yaml` 的「初始對話」，將 `mes_example` 寫入 `模組6_場景語料.yaml` 的「對話範例」，完成自動歸檔。
   - 提示使用者可調用事實提取器（`extract_lore_facts`）將參考底稿提煉至模組 1-5 中。

---

## 7. 決策暫存註冊表與交付安全閥 (Decision Register)

為妥善管理設計爭議與分支，每個專案目錄下設有專屬的決策暫存檔案 `drafts/<characterId>/pending_decisions.json`。

1. **暫存註冊**：AI 遇到重大主觀設計分歧時，調用 `request_user_decision` 寫入決策項，狀態記為 `pending`，並必須包含 `default_fallback`（預設備用值）。
2. **交付安全閥 (Linter Safety Gates)**：
   - **常規導出模式 (`strict_review: false`)**：放行編譯與測試。編譯器自動採用 `default_fallback` 填入卡片對應位置，並在該條目內容最前方動態包裹 `[DEBUG] This section uses temporary decision fallback for DEC-XXXX.` 提示標籤。這保障了創作者的快速迭代與測試。
   - **嚴格審查模式 (`strict_review: true`)**：硬性阻斷編譯。若存在任何 `pending` 的決策項，編譯器將強制中斷並列出未決策清單，防止不成熟的設定外流。

---

## 8. 二創事實與設計提取器 (Lore Facts Extractor)

`extract_lore_facts` 採用**「規劃先行、增量安全寫入 (Plan-then-Extract)」**的提煉機制：
1. **大綱規劃 (Blueprint Stage)**：AI 首先讀取長篇設定，生成輕量級 JSON/Markdown 提煉分析大綱，表明哪些事實預備填入哪些 YAML 的哪些欄位。
2. **創作者裁剪 (User Review)**：創作者對大綱進行刪除、調整或確認。
3. **增量安全寫入 (Increment Merge)**：大綱確認後，AI 執行寫入。工具採取**增量合併**而非全覆寫，已存在的手寫 YAML 屬性將被予以保留，新提取的事實將以追加（Append）或非破壞性合併的方式併入，並在決策註冊表中登記待創作者驗收。

---

## 9. 編譯期補全規格與 Linter (Compile-Time Formatting & Linter)

為保持草稿 YAML 的高度純淨與易讀，編譯器在編譯時會自動完成以下工作：
- **Description 淨空**：將最終主卡的 `description` 設為空 `""`，將核心概念移入世界書，防止 Token 浪費。
- **雙遞迴常態防禦**：強制在世界書條目中注入 `"prevent_recursion": true` 與 `"exclude_recursion": true`，防止條目被酒館丟棄。
- **XML 自動包裹**：根據草稿模式，自動在條目內容前後包裹對應的 XML 標籤（如 `<character_basic>`、`<personality_palette>` 等）。
- **語意化 Position 映射**：將 `before_char` 等語意字串自動轉換為酒館標準整數。

### 敘事禁詞 Regex Linter（三層防禦機制）
全量掃描 Drafts 中的對白與描述，檢測 AI 腔禁詞（如：一抹弧度、喉結、指節發白等）與套路比喻。
1. **第一層：常規警告**：預設情況下，發現禁詞會在終端列印詳細的位置與 Quote，但不中斷編譯，方便日常撰寫與測試。
2. **第二層：嚴格阻斷**：當 `strict_review: true` 時，檢測到任何禁詞立刻報錯並終止編譯。
3. **第三層：智能容錯豁免**：允許在 YAML 中使用特殊註釋或豁免前綴（如 `# linter-allow`），或在 `模組0_概覽.yaml` 中配置白名單豁免詞彙，向 Linter 聲明此處為創作者刻意的藝術留白，從而予以放行。

---

## 10. PNG 實體卡片合成：`export_png_card`

本工具利用專用 PNG 讀寫庫（`png-chunks-extract` 與 `png-chunk-text`），接受 `exportFileName`、`avatarPath`（頭像絕對路徑）與 `characterId`：
1. 底層調用 `mergeAndExport` 的編譯與 Zod 驗證，獲取完整的 V3 JSON。
2. 將該 JSON 轉為 Base64。
3. 精準寫入 PNG 圖像的 `chara` 輔助文本區塊（tEXt chunk）中。
4. 將最終可拖入酒館的實體 PNG 寫入 `exports/<exportFileName>.png`。

---

本設計文件為「終極工作流」的終極規格。所有元件均需嚴格對齊此設計進行實作。
