# SillyTavern V3 終極生成工作流

本上下文定義了 SillyTavern V3 終極生成工作流（Ultimate Workflow）的核心本體、設定模式與專有名詞，旨在統一編譯器、AI 智能體（Director, Creator, Critic）與創作者之間的語意理解。

## 語言 (Language)

**性格調色盤 (Personality Palette)**:
描述角色性格層次與跨場景行為/傾向的設定模組，包含底色（Base/Undercoat）、主色調（Main Tone）、點綴（Accent）與場景衍生（Derivatives）。可用於靈活描寫角色的多重性格傾向。
_Avoid_: 性格描述, 性格大綱, Personality description

**三面性 (Tri-faceted)**:
描述角色在不同壓力、社交環境或情境切換時呈現出的多重面孔與生存行為機制。包含觸發、能量、語料、身體行為、功能，以及面孔之間的過渡與滲透。
_Avoid_: 性格狀態, 角色多面性, Multi-states

**珠璣模式 (Zhuji Mode)**:
傳統且極致詳細的 7 階段線性展開設定模式，將角色設定細緻拆分為外顯、內質、外延、外延擴展、特質細化、場景語料、自我介紹 7 個模組，適用於白描細緻且細節豐富的角色。
_Avoid_: 7模組模式, 線性模式, Linear mode

**調色盤模式 (Palette Mode)**:
基於靈魂寫意與壓力生存策略的角色設定模式，包含基礎信息、性格調色盤、三面性與二次解釋。適用於擁有多重性格防禦機制與高度環境適應性特徵的角色。
_Avoid_: 三面模式, 策略模式, Survival mode

**雙向模式轉換 (Bi-directional Mode Conversion)**:
一種按需觸發（On-demand）的進階轉換功能，允許使用者將現有的「珠璣模式」草稿智能收斂為「調色盤模式」草稿，或將「調色盤模式」草稿智能擴展為「珠璣模式」草稿。
_Avoid_: 模式重寫, 格式翻譯, Mode rewrite

**實體卡片智慧診斷 (Card Diagnostics / Card Auditor)**:
指針對已編譯導出的實體角色卡（PNG/JSON）進行的品質與規格審計。它以「空白 Description 鐵律」、「敘事禁詞 Linter」、「開場白 Puppeteering 檢測」以及「雙遞迴常態防禦」等 4 大指標為核心，產生智慧診斷報告書（Audit Scorecard）或在打包編譯期觸發安全閥阻斷。
_Avoid_: 角色卡分析, 卡片審查, Card inspection

**事實寄存器 (Fact Register / imported-base.yaml)**:
指儲存從小說、百科或網頁搜尋中提煉出的、未經二次創作加工的角色與世界觀最原始、客觀的事實檔案。它作為專案冷啟動與後續 Drafts 生成的單一事實來源（Source of Truth），供使用者手動增減與審核對齊。
_Avoid_: 原始草稿, 原始數據, Raw data

**多維世界設定 (Categorized World Lore / Categorized Worldbook)**:
指在 `世界設定/` 下按分類目錄（人物、地理、組織、概念）組織的世界書設定。編譯器在編譯期會根據目錄位置自動注入最佳的插入順序、插入位置、雙遞迴防禦與 XML 標籤，同時優先尊重創作者在單個 YAML 草稿中手動指定的覆蓋屬性。
_Avoid_: 扁平世界設定, 雜亂世界書, Uncategorized lore

**流式分片提煉 (Sliding-window Ingestion)**:
針對超大型二創小說或文本的分片提取機制。將文本切割為 5k-10k Token 的分片滑動視窗，分段提取事實以防止 Context 溢出與 LLM 注意力丟失。
_Avoid_: 全量大文本提取, 暴力全文提取, Raw full text extraction

**增量安全追加器 (Incremental Merger)**:
提煉事實轉化為 Draft 檔案時的安全合併機制。只增量寫入全新設定或條目，對於存量手寫條目則輸出「設定衝突對照報告」，由創作者決定是否更新，杜絕暴力覆寫。
_Avoid_: 暴力覆寫, 全覆蓋寫入, Overwrite-all
