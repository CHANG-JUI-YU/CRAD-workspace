# SillyTavern V3 稱呼本地化規範與打包編譯清單說明書

本文件旨在為創作者與 AI 技能組提供「角色稱呼本地化（去日文殘留）」的最高行為準則，並詳細拆解當前終極工作流在打包編譯時，究竟封裝了哪些草稿內容。

---

## 一、 稱呼本地化與變數化原則 (Address Localization & Variable Standards)

為了徹底杜絕動漫角色卡中常出現的日文原字（假名）、日語羅馬音或生硬的日式後綴，所有 `Creator` 技能（寫作）與 `Critic` 技能（審查）必須對齊以下三層防禦：

### 1. 嚴禁日語人稱原字與羅馬音洩漏 (No Japanese Pronouns)
*   **禁忌**：在對話、神態描寫或旁白中，出現 `あなた`、`お前`、`君 (kimi)`、`Omae`、`Anata`。
*   **本土化規範**：必須根據角色與使用者的親疏關係，轉譯為符合自然正體中文（zh-TW）口語習慣的稱呼。例如：
    *   *疏離/敵對*：寫成「你這傢伙」、「你這小子」、「這傢伙」。
    *   *親密/依賴*：寫成「你」、「親愛的」（若是夫妻/情侶設定）。
    *   *常態尊稱*：直接寫「你」或使用符合角色的職稱、輩分。

### 2. 嚴禁生硬日式關係後綴殘留 (No Transliterated Japanese Suffixes)
*   **禁忌**：在正體中文對白中，出現帶有日語發音後綴的硬譯。例如「-kun (君)」、「-san (桑/さん)」、「-sama (大人/様)」、「-chan (醬/ちゃん)」。
    *   *錯誤範例*：「綾小路君，這件事你怎麼看？」、「雪乃桑，請等等我。」、「清隆sama，我一直...」
*   **本土化規範**：
    *   將 `-kun` 翻譯為「同學」或直接稱呼名字。例如：「綾小路同學，這件事你怎麼看？」或直接叫「綾小路」。
    *   將 `-san` 翻譯為「小姐」、「先生」或名字。
    *   將 `-chan` 翻譯為親暱的簡稱。例如：「小雪乃」或「雪乃」。
    *   將 `-sama` 翻譯為符合中文語境的尊稱，如「大人」或「少爺」。

### 3. SillyTavern 稱呼變數規範 (Always Use ST Macros)
*   當角色提及、呼喚使用者（Player）時，**必須**使用系統巨集變數 `{{user}}`，嚴禁硬編碼具體人名。
*   **禁忌**：`{{user}}-kun`、`{{user}}君`、`{{user}}桑`。
*   **本土化規範**：若要表現禮貌，寫成 `{{user}}同學`；若要表現親暱，寫成 `小{{user}}`（需契合角色語氣），其餘一律直接寫為 `{{user}}`。

---

## 二、 角色卡打包編譯清單 (What Gets Packed in V3 Card?)

當您啟動編譯打包（調用 `merge_and_export` 或 `export_png_card`）時，`st-forge` 引擎會將以下物理草稿與設定檔**一體化熔煉、編譯、優化**，並封裝至最終的 `.json` 或 `.png`（Metadata）角色卡中：

```text
📁 drafts/<projectId>/ (專案目錄)
│
├── 模組0_概覽.yaml .................... [讀取] 確定打包模式（珠璣/調色盤）、角色卡真實名稱與合圖頭像
├── greetings.yaml .................... [編譯] 封裝至主卡頂層: first_mes (首發開場白) 與 alternate_greetings (備用陣列)
├── (註: ComfyUI 視覺 Prompt 由 AI 在對話中直接輸出呈現給創作者，免去物理文件生成與打包)
│
├── 📁 世界設定/ (選填世界書目錄) ........ [遞迴編譯]
│   ├── 📁 人物/、📁 組織/、📁 地理/ 等 ... 自動讀取關鍵字與內容，XML 包裹，強制注入 [雙遞迴防禦 flags]，熔煉入嵌入式世界書
│
└── 📁 <character_name>/ (角色草稿目錄)
    │
    ├── [模式 A: 珠璣模式]
    │   ├── 模組1_外顯.yaml ............. [編譯] 格式化為 Markdown，自動包裹 <module_1_appearance>，寫入世界書
    │   ├── 模組2_內質.yaml ............. [編譯] 格式化為 Markdown，自動包裹 <module_2_inner_psychology>，寫入世界書
    │   └── 模組3至模組7.yaml ........... [編譯] 依序格式化，XML 標籤包裹，熔煉入世界書條目。
    │                                          (*備註：模組7自我介紹將做為常態設定封裝，開場白則由 greetings.yaml 接管)
    │
    └── [模式 B: 調色盤模式]
        ├── 基礎信息.yaml ............... [編譯] 格式化為 Markdown，自動包裹 <character_basic>，寫入世界書
        ├── 性格調色盤.yaml ............. [編譯] 格式化為 Markdown，自動包裹 <personality_palette>，寫入世界書
        ├── 三面性.yaml ................. [編譯] 格式化為 Markdown，自動包裹 <tri_faceted>，寫入世界書
        └── 二次解釋.yaml ............... [編譯] 格式化為 Markdown，自動包裹 <secondary_interpretation>，寫入世界書
```

### 核心編譯規格與安全防禦
1.  **酒館規格兼容**：
    *   主卡的 `personality`、`scenario`、`mes_example`、`description` 欄位**自動保持清空**（防止 Token 重複宣告浪費）。
    *   所有角色的設定、世界觀設定**100% 封裝於嵌入式世界書 (Embedded Worldbook)** 內，透過精細的 Position（如 `after_char`、`before_char`）與優先級（Insertion Order）進行智慧注入。
2.  **雙遞迴常態預防**：
    *   所有的世界設定與角色條目，編譯時會自動在 JSON 中注入 `"prevent_recursion": true` 與 `"exclude_recursion": true`，徹底防止因關鍵字交叉引用導致的死循環（Token 暴漲與崩潰）。
3.  **品質門禁與 Linter**：
    *   編譯期自動全量掃描「一絲」、「一抹」、「弧度」、「喉結」等 AI 敘事禁詞。
    *   自動進行 `pending_decisions.json` 決策 fallback 填充。
    *   於 `exports/` 同步輸出 Markdown 品質診斷報告書（Audit Scorecard）。
