# 角色設定擴充路線圖

- 日期：2026-08-19
- 狀態：方向已核准，待逐項建立設計與 issue
- 規劃方式：近期可交付 MVP + 長期擴充
- 適用範圍：Blueprint、Character、Zhuji、Palette、Relationships、Greetings、World、Wardrobe

## 目的

在不破壞既有角色卡、來源追溯與雙模式輸出的前提下，補強目前角色設定中較難穩定表達的動機、知識邊界、關係變化、衝突反應與日常運作。新增欄位必須能改善訪談、創作、審查或執行期表現；只增加篇幅、但沒有明確消費者的欄位不納入正式 schema。

本文件是產品路線圖，不是直接實作規格。每個項目進入開發前，仍需各自建立 schema、遷移、編譯投影與測試設計。

## 現況基線

目前角色資料已分為數個明確 artifact：

- Character：角色摘要、自由 sections、關係摘要與 Fact references。
- Zhuji：每名角色七個固定模組。
- Palette：每名角色四個固定模組。
- Relationships：角色摘要、自我視角、有向關係與群組。
- Greetings：primary、alternate、group-only 開場白。
- World：人物、地理、組織、歷史、概念、系統、物品與事件條目。
- Wardrobe：跨模式的角色衣櫃 Markdown。

現有優點是 artifact 邊界與 provenance 已建立；主要缺口是部分重要設定仍只能藏在自由文字、`extensions` 或模式專屬模組內，難以讓訪談、Critic、Coverage 與 Compiler 一致使用。

### 珠璣 schema 的既有決策缺口

[珠璣模組舊版與 V3 差異紀錄](../zhuji-schema-comparison.md) 已確認 V3 對 `inner_nature`、`extension`、`self_introduction` 等模組大幅鬆綁，部分最低數量限制也被移除。該文件維持原狀作為調查證據；本路線圖不直接決定「完整退回舊版 strict schema」。

建議採混合方案：恢復會影響角色一致性、可演出性與審查的必要結構，保留純文風或作品差異很大的欄位為 extensible section。這能避免兩個極端：完全自由造成內容漂移，或完整複製舊版造成高填寫成本與低彈性。

## 資料所有權原則

新增設定應依下列規則決定唯一 canonical owner：

| 資料性質 | Canonical owner | 其他 artifact 的角色 |
|---|---|---|
| 專案意圖、角色名單、模式與創作方向 | Blueprint | 提供 authoring input，不複製完整內容 |
| 跨模式且屬於單一角色的穩定設定 | Character | Zhuji／Palette 只負責表現方式 |
| 珠璣或調色盤專屬的表現細節 | Zhuji／Palette | Character 不重複保存長篇內容 |
| 角色對角色的方向性狀態 | Relationships | Character 只保留個人普遍傾向 |
| 故事開始瞬間的場景與關係快照 | Greetings | 不取代長期關係設定 |
| 外部世界的客觀事實 | World | Character 只引用或記錄主觀認知 |
| 可替換服裝組合 | Wardrobe | Appearance 只定義穩定外觀與穿著習慣 |

同一概念若必須出現在多個輸出，應以 reference 或 projection 產生，不建立多份可各自修改的 source of truth。

## 建議新增的角色設定維度

| 優先度 | 維度 | 建議 owner | 使用價值 | 與既有資料的邊界 |
|---|---|---|---|---|
| P0 | 目標與動機 | Character | 讓 Agent 知道角色正在追求什麼、為何採取行動 | Zhuji `內在驅動力` 負責模式化描寫，不另存第二份事實 |
| P0 | 知識與認知邊界 | Character | 防止角色知道尚未得知的世界事實或其他角色秘密 | World 保存客觀事實；Character 保存已知、誤解與未知範圍 |
| P0 | 禁止破壞的角色約束 | Character | 將核心底線、不可突然改變的特質交給 Critic 與生成器 | 不等同一般 personality prose；只放可驗證約束 |
| P1 | 秘密與揭露條件 | Character／World reference | 支援逐步揭露、誤導與劇情鉤子 | 客觀秘密留在 World；角色持有狀態與揭露規則留在 Character |
| P1 | 關係階段與轉換條件 | Relationships | 讓信任、敵意、親密或合作能有明確演變 | Greeting 只選用起始階段，不保存完整狀態機 |
| P1 | 衝突升級與降溫 | Character + Relationships | 避免角色在壓力下反應隨機或永遠只有單一情緒 | Character 定義普遍模式；edge 定義特定對象差異 |
| P1 | 日常節奏、責任與資源 | Character／World reference | 讓角色在場景外仍有可信生活與可用資源 | 地點、組織、制度本體仍屬 World |
| P1 | 互動界線與同意偏好 | Character／Relationships | 讓親密、衝突與敏感互動有可預期的界線與恢復方式 | 不將使用者的即時選擇固化成角色永久設定 |
| P2 | 記憶錨點與觸發聯想 | Character | 讓重要人事物在合適情境被召回，而非每回合重述背景 | 不取代 Runtime conversation memory |
| P2 | 場景鉤子與未完成線索 | Character／World | 提供可啟動但不強迫發生的故事入口 | 不直接寫死 Greeting 劇情結果 |
| P2 | 自我敘事與外界觀感差異 | Character | 強化角色盲點、不可靠自我認知與他人視角差異 | Relationships 保存特定角色的外部觀點 |

## 建議的跨模式 Character v2 形狀

以下僅表示欄位責任，不是最終 Zod schema：

```json
{
  "schema_version": 2,
  "id": "character-1",
  "display_name": "角色名稱",
  "summary": "跨模式摘要",
  "drives": [
    {
      "id": "protect-home",
      "goal": "想達成的結果",
      "motivation": "為何重要",
      "priority": "core",
      "conflicts_with": []
    }
  ],
  "knowledge_boundaries": {
    "known_fact_refs": [],
    "misbeliefs": [],
    "unknown_topics": []
  },
  "invariants": [
    {
      "id": "never-abandon-companion",
      "rule": "不可被一般場景任意推翻的角色約束",
      "exceptions": []
    }
  ],
  "secrets": [
    {
      "id": "secret-1",
      "world_fact_ref": "fact-1",
      "disclosure_conditions": [],
      "concealment_behavior": "尚未揭露時的行為"
    }
  ],
  "conflict_profile": {
    "escalation_triggers": [],
    "deescalation_cues": [],
    "repair_behavior": []
  },
  "daily_life": {
    "responsibilities": [],
    "routines": [],
    "resource_refs": []
  }
}
```

欄位應允許 provenance；引用已接受事實時使用穩定 Fact／World reference，不把來源句子複製進每個 artifact。

## Now：近期 MVP

### 1. 完成珠璣必要結構盤點

- 以差異紀錄為輸入，將舊版欄位分成「生成與審查必要」、「建議提示」、「純擴充」三類。
- 優先恢復 `inner_nature` 的驅動力／情感／衝突、`extension` 的關係／行為／對 user，以及 `self_introduction` 的自我與人生觀等高價值欄位。
- 恢復能代表內容多樣性的下限，但不要僅為湊數恢復所有舊版 min/max。
- Zhuji context、Creator skill、Critic 與 schema 必須使用同一欄位目錄。

### 2. 建立 Character v2 的最小核心

第一階段只加入三組跨模式資料：

1. `drives`：核心目標、動機、優先度與內部衝突。
2. `knowledge_boundaries`：已知引用、錯誤認知與明確未知。
3. `invariants`：角色不可在一般生成中被無理由推翻的約束。

這三組最能直接改善訪談、雙模式一致性與 Critic 判定，且不需要先導入完整狀態機。

### 3. 串接訪談、Coverage 與 Critic

- 訪談只在資料缺失或彼此衝突時提問，不把每個欄位變成固定問卷。
- Coverage 顯示缺少的是哪個角色與哪個維度。
- Creator context 接收相關切片，不注入整個專案的全部 Character v2 資料。
- Critic 可指出違反哪一個 invariant、knowledge boundary 或 accepted fact。

### 4. 相容與遷移

- Character v1 必須持續可讀、可編譯與可發布。
- V1 → V2 migration 只能搬移能確定對應的欄位；自由文字推測需產生 proposal，不得靜默寫成正式資料。
- 新欄位缺失時維持既有行為，不以空陣列假裝內容已完成。
- Mode conversion 不應把 Character v2 當作 Zhuji／Palette 之間的可丟棄內容。

## Next：動態關係與可演出生活

### 1. Relationship progression v3

- 每個有向 edge 可選擇加入 `stages`、`current_stage`、`advance_conditions`、`regress_conditions` 與 `repair_paths`。
- 初始階段由 Blueprint／Greeting 明確選擇；生成器不得僅因單次對話自行永久改寫正式 artifact。
- 若未啟用動態階段，v2 sparse relationship 行為保持不變。

### 2. 秘密與揭露

- 秘密必須區分「客觀真相」、「角色是否知道」、「角色是否願意說」三件事。
- 揭露條件應是可判定的條件或人工確認，不使用只能由模型主觀猜測的模糊文字作唯一 gate。
- 編譯輸出只投影角色在目前起始狀態應知道的內容。

### 3. 衝突、修復與界線

- 增加 escalation trigger、de-escalation cue、apology/repair behavior 與不可接受行為。
- 角色普遍模式放 Character；針對特定對象的例外放 Relationship edge。
- 使用者即時表達的界線屬 session state；只有明確保存時才成為專案設定。

### 4. 日常節奏與資源

- 記錄責任、固定習慣、可支配資源與限制。
- 以 World references 連結工作地點、組織、物品與制度，避免重複設定。
- Greeting 與 scene dialogue 可引用日常資料建立合理時間與場景。

## Later：長期擴充

- 多個時間點或 alternate timeline 的角色 variant，但共享穩定 identity。
- 可選的關係／情緒狀態機，與 MVU plugin 明確分工。
- 自動一致性檢查：動機與行動矛盾、知識越界、秘密提前揭露、關係階段跳躍。
- 跨專案角色模板與可選設定片段，保留來源與授權資訊。
- 以真實生成樣本評估角色聲線、一致性與可演出性，而不只計算欄位完整率。

## 主要風險與控制

| 風險 | 控制方式 |
|---|---|
| Character、Zhuji、Palette 重複保存同一設定 | 定義 canonical owner；其他 artifact 只引用或投影 |
| Schema 過嚴導致所有角色看起來相同 | 只結構化會被 workflow 消費的欄位，文風內容保留 extensible |
| Schema 過鬆導致 Creator 任意命名 | 必要欄位進 schema；guide 與 Critic 共用欄位 catalog |
| 舊資料被錯誤自動推測 | 不確定轉換只產生 proposal，需人工審核 |
| 新欄位使模型 context 膨脹 | 依角色、場景與任務切片，不注入完整 register |
| 動態狀態與正式 artifact 混淆 | Artifact 保存批准的基線；session state 由 Runtime/MVU 管理 |

## 路線圖完成標準

- [ ] 每個正式欄位都有唯一 owner、明確 consumer 與 provenance 規則。
- [ ] V1 專案不遷移也能維持現有 build/publish 行為。
- [ ] V2 最小核心能被訪談、Creator、Critic、Coverage 與 Compiler 一致讀取。
- [ ] Zhuji schema、生成指南與 Critic 不再對必要欄位各說各話。
- [ ] 關係、秘密與日常擴充不複製 World 或 Greeting 的 source of truth。
- [ ] 每個階段都有 migration fixtures、雙模式 fixtures 與至少一個完整角色端到端樣本。

