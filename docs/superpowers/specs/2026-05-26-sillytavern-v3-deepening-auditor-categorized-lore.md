# SillyTavern V3 終極工作流：卡片智慧診斷與多維世界書編譯設計規格 (Deepening Spec)

本規格書詳細記錄了「第一階段：實體卡一鍵安全診斷工具（Card Auditor）」與「多維度範本世界設定編譯引擎」的架構設計與程式碼實現方案。

---

## 一、 補全項目 A：實體卡一鍵智慧診斷工具 (`audit_compiled_card`)

智慧診斷工具將作為一個全新的 MCP 工具註冊於 `st-forge` 中，能直接讀取導出的實體 PNG 角色卡或 JSON 檔案，全量掃描並輸出精準的 Markdown 格式「智慧診斷報告書（Audit Scorecard）」。

### 1.1 診斷邏輯與代碼架構設計

我們將在 `src/tools/assembly.ts` 中新增以下函數：

```typescript
export interface AuditReport {
  cardName: string;
  totalScore: number;
  checks: {
    category: string;
    passed: boolean;
    score: number;
    maxScore: number;
    details: string;
  }[];
  suggestions: string[];
}

export function auditCompiledCard(filePath: string): AuditReport {
  // 1. 讀取卡片 JSON 數據
  let cardJson: any = null;
  if (filePath.endsWith('.png')) {
    cardJson = extractJsonFromPng(filePath); // 使用現有的 png-utils
  } else if (filePath.endsWith('.json')) {
    cardJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else {
    throw new Error("不支援的檔案格式，僅支援 .png 與 .json 角色卡。");
  }

  const report: AuditReport = {
    cardName: cardJson.name || "未命名角色",
    totalScore: 100,
    checks: [],
    suggestions: []
  };

  // 【檢查項 1：空白 Description 鐵律】(權重: 20分)
  const desc = cardJson.description || "";
  const descPassed = desc.trim() === "";
  report.checks.push({
    category: "空白 Description 鐵律 (Blank Description Rule)",
    passed: descPassed,
    score: descPassed ? 20 : 0,
    maxScore: 20,
    details: descPassed 
      ? "完美通過！主卡 Description 為空，無感規格由世界書在運行時高內聚接管。"
      : `警告：主卡 Description 含有 ${desc.length} 字。這會導致 SillyTavern 重複發送角色背景，破壞雙遞迴隔離。建議清空並移至世界設定。`
  });

  // 【檢查項 2：敘事禁詞掃描 (Narrative Forbidden Words)】(權重: 20分)
  const forbiddenRegex = /(一絲|一抹|一縷|弧度|彎起嘴角|喉結|指節發白|無奈地搖了搖頭)/g;
  const fullTextToScan = JSON.stringify(cardJson);
  const foundForbidden = fullTextToScan.match(forbiddenRegex);
  const forbiddenPassed = !foundForbidden;
  report.checks.push({
    category: "敘事禁詞與 AI 腔掃描 (Narrative Linter)",
    passed: forbiddenPassed,
    score: forbiddenPassed ? 20 : Math.max(0, 20 - (foundForbidden?.length || 0) * 4),
    maxScore: 20,
    details: forbiddenPassed
      ? "完美通過！未檢測到「一絲、一抹、弧度、喉結」等高頻 AI 廉價敘事詞。"
      : `發現 ${foundForbidden?.length} 處 AI 腔禁用詞：[${Array.from(new Set(foundForbidden)).join(', ')}]。這會破壞角色扮演的白描文學沉浸感。`
  });

  // 【檢查項 3：開場白 Puppeteering 檢測】(權重: 20分)
  const firstMes = cardJson.first_mes || "";
  // 檢測是否控制了玩家言行（例如：代指 {{user}} 做出動作或心理描寫）
  const puppeteeringRegex = /({{user}}|你)(的內心|想道|看著|無奈|嘆氣|走過來)/;
  const pupPassed = !puppeteeringRegex.test(firstMes);
  report.checks.push({
    category: "開場白 Puppeteering 檢測 (No User Control)",
    passed: pupPassed,
    score: pupPassed ? 20 : 5,
    maxScore: 20,
    details: pupPassed
      ? "完美通過！首頁開場白未檢測到替玩家代白、預設言行或控制心理的行為。"
      : "警告：開場白中似乎存在替玩家 {{user}} 代白、控制玩家肢體或心理活動的描述，這會嚴重損害使用者的主體扮演權。"
  });

  // 【檢查項 4：雙遞迴常態預防】(權重: 20分)
  const entries = cardJson.character_book?.entries || [];
  let doubleRecursionSafe = true;
  let unsafeCount = 0;
  entries.forEach((e: any) => {
    const isSafe = e.extensions?.prevent_recursion === true && e.extensions?.exclude_recursion === true;
    if (!isSafe) {
      doubleRecursionSafe = false;
      unsafeCount++;
    }
  });
  report.checks.push({
    category: "世界書雙遞迴預防 (Double Recursion Defense)",
    passed: doubleRecursionSafe,
    score: doubleRecursionSafe ? 20 : Math.max(0, 20 - unsafeCount * 5),
    maxScore: 20,
    details: doubleRecursionSafe
      ? `完美通過！檢測到全部 ${entries.length} 個世界書條目均已正確啟用雙遞迴常態預防。`
      : `警告：發現有 ${unsafeCount} 個條目未正確啟用 prevent_recursion / exclude_recursion 標記！這會導致 Token 產生指數型膨脹黑洞。`
  });

  // 【檢查項 5：開場白篇幅與 Closed Endings】(權重: 20分)
  const mesLength = firstMes.length;
  const isLengthOk = mesLength >= 400 && mesLength <= 1000;
  // 檢測是否以玩家無法接話的「Closed Ending」結尾
  const closedEndingRegex = /(說完這句話。|便轉身離開。|不發一言。|陷入了死寂。)$/;
  const openEndingPassed = !closedEndingRegex.test(firstMes.trim());
  
  const greetingPassed = isLengthOk && openEndingPassed;
  report.checks.push({
    category: "開場白深度與留白 (First Message Quality)",
    passed: greetingPassed,
    score: greetingPassed ? 20 : (isLengthOk ? 12 : 5),
    maxScore: 20,
    details: `開場白總字數: ${mesLength} 字。` + 
      (isLengthOk ? " 字數合規。" : " 字數偏短或過長（推薦 400-800 字）。") + 
      (openEndingPassed ? " 結尾留白良好，便於接話。" : " 警告：結尾疑似採用了玩家極難接話的封閉式結局。")
  });

  // 4. 計算總分與生成改進建議
  report.totalScore = report.checks.reduce((acc, curr) => acc + curr.score, 0);
  
  if (!descPassed) report.suggestions.push("一鍵清空主卡 Description，將背景設定封包至世界書對應條目。");
  if (!forbiddenPassed) report.suggestions.push("對草稿進行 Narrative Linter 脫敏，使用更具白描感的客觀描寫替換 AI 詞彙。");
  if (!pupPassed) report.suggestions.push("修改開場白，移除任何對 {{user}} 心理、動作的越權描寫。");
  if (unsafeCount > 0) report.suggestions.push("重新運行 merge_and_export 編譯器，使編譯器自動為存量條目熱修補防禦擴展。");

  return report;
}
```

---

## 二、 補全項目 B：二創智慧搜尋與本體知識冷啟動提取器 (`Smart Bootstrapping`)

針對使用者給予「我要創作某個知名二創角色」的情況（例如玩家直接指定「我想寫《原神》的芙寧娜」），且並未提供現成文本。我們設計了一套 **「二創智慧搜尋與本體知識激發」** 流程，提供 100% 自動化、高品質的專案冷啟動（Bootstrapping）。

### 2.1 智慧搜尋與激發冷啟動流程圖

```dot
[使用者指令: "我要做芙寧娜"] 
      │
      ▼
[1. 檢索與激發] ───► 調度網頁搜尋工具，或直接激發 Gemini 大模型內置的深度二創人設知識
      │
      ▼
[2. 事實提取大綱] ───► 提煉角色外顯、內質、能力與關係，生成「事實與人設大綱」
      │
      ▼
[3. 模式建議評估] ───► 評估角色複雜度：
      │               ├──► 屬於神經質、多重壓力狀態？ ──► 推薦「調色盤模式」
      │               └──► 屬於傳統單一線性白描？    ──► 推薦「珠璣模式」
      │
      ▼
[4. 專案一鍵初始化] ──► 創建專案文件夾、模組0_概覽.yaml、以及預先填入提取事實的 Draft 模組
```

### 2.2 漸進式提取與自動化草稿生成規範

我們將在 `st-extractor-skill` 技能中實現此流程，包含以下三個自動化步驟：

#### Step 1: 智慧資料檢索與摘要整合 (Smart Retrieval)
- **運作**：Subagent 會自動分析作品名與角色名，調用 `webfetch` 或使用內置的高質量資料，將其彙整為以下結構的「檢索結果摘要」：
  - 身份/世界觀定位（作品背景、陣營）
  - 外貌特徵（衣著、髮色、瞳色、體態、標誌性飾物）
  - 性格側面（常規狀態下、高壓/戰鬥狀態下、以及內心深處的自我保護面）
  - 標誌性台詞（經典口癖、自稱、說話習慣）

#### Step 2: 模式匹配評估 (Mode Recommendation)
- **評估標準**：
  - 如果角色在不同環境下有極端的言行/心理轉折（如：芙寧娜在眾人前扮演水神的神經質、與內心深處懦弱悲傷的對比），AI 會強烈推薦 **調色盤模式**。
  - 如果角色是以白描、客觀環境與具體事件堆疊、台詞線性累積為主（如：雪乃），AI 會推薦 **珠璣模式**。

#### Step 3: 自動草稿生成 (Auto-Draft Bootstrapping)
- 用戶同意後，AI 直接調用 `st-forge` 初始化專案，並**全自動寫入符合規格的 YAML 草稿**。
- **調色盤模式下，AI 將自動生成並填入：**
  - `模組0_概覽.yaml`（設定模式為調色盤）
  - `基礎信息.yaml`（自動寫入年齡、外貌白描）
  - `性格調色盤.yaml`（自動寫入底色、主色調、點綴色、衍生傾向）
  - `三面性.yaml`（自動規劃：平常偽裝面、高壓崩潰面、神之眼釋放面）
  - `二次解釋.yaml`（自動寫入其 500 年扮演水神的孤獨與痛苦動機）
- **珠璣模式下，AI 將自動生成並填入：**
  - `模組0_概覽.yaml`（設定模式為珠璣）
  - `模組1_外顯.yaml`、`模組2_內質.yaml`... 等 7 個 YAML 模組，並填入提取到的基礎事實。

這樣一來，使用者便能直接跳過繁瑣的 YAML 結構手動初始化，一秒進入 Stage 3 與 AI 一起進行潤色、審查與細化，實現真正的「零開銷冷啟動」！

---

## 三、 補全項目 D：多維度範本世界設定編譯引擎

世界設定由原來的單一層平鋪掃描，升級為**多維度、具有內置範本參數的分類管理系統**。

### 3.1 分類目錄與自動化參數映射

編譯引擎 `mergeAndExport` 將遞迴掃描 `世界設定/` 底下的四個核心預設目錄，並在編譯為世界書時自動、無感地注入以下特定技術指標，無需創作者在 YAML 中重複書寫：

| 子目錄 | 常駐狀態 (`constant`) | 啟用選擇性 (`selective`) | 插入順序 (`insertion_order`) | 插入位置 (`position`) | XML 標籤包裹 | 技術目的 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`世界設定/人物`** | `false` | `true` | `30` | `after_char` | `<character_lore>` | 便於運行時根據名字提及動態啟用對應 NPC 人際網，防止過早污染 Context。 |
| **`世界設定/地理`** | `false` | `true` | `40` | `before_char` | `<location_lore>` | 地理場景常在切換場景或提及時觸發，位置靠前以形成全景世界觀框架。 |
| **`世界設定/組織`** | `false` | `true` | `50` | `before_char` | `<faction_lore>` | 組織、陣營和歷史設定，作為中景背景知識提供框架支撐。 |
| **`世界設定/概念`** | `false` | `true` | `60` | `after_char` | `<concept_lore>` | 抽象術語、技能體系、修仙階級等。位置靠後，僅在提及時提供底層邏輯解釋。 |

### 3.2 `mergeAndExport` 目錄遞迴掃描代碼實現設計

```typescript
const worldLoreDir = path.join(targetDraftsDir, '世界設定');
if (fs.existsSync(worldLoreDir)) {
  // 定義維度設定
  const folderConfigs: Record<string, { order: number, pos: string, tag: string }> = {
    '人物': { order: 30, pos: 'after_char', tag: 'character_lore' },
    '地理': { order: 40, pos: 'before_char', tag: 'location_lore' },
    '組織': { order: 50, pos: 'before_char', tag: 'faction_lore' },
    '概念': { order: 60, pos: 'after_char', tag: 'concept_lore' }
  };

  const scanAndPack = (dirPath: string, subCategory?: string) => {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isDirectory()) {
        // 進入人物/地理等子目錄
        scanAndPack(path.join(dirPath, item.name), item.name);
      } else if (item.isFile() && item.name.endsWith('.yaml')) {
        const raw = fs.readFileSync(path.join(dirPath, item.name), 'utf8');
        const parsed = YAML.parse(raw);
        
        const config = parsed['條目設定'] || {};
        const keys = parsed['關鍵字'] || {};
        const content = parsed['設定內容'] || "";
        
        const catConfig = subCategory ? folderConfigs[subCategory] : null;
        const tagName = catConfig?.tag || item.name.replace('.yaml', '');
        const wrappedContent = `<${tagName}>\n${content.trim()}\n</${tagName}>`;
        
        card.character_book.entries.push({
          id: currentId++,
          keys: keys.primary || [item.name.replace('.yaml', '')],
          secondary_keys: keys.secondary || [],
          comment: config.comment || `${subCategory || '世界設定'}_${item.name.replace('.yaml', '')}`,
          content: wrappedContent,
          constant: config.constant ?? false,
          selective: config.selective ?? true,
          insertion_order: config.insertion_order ?? (catConfig?.order || 50),
          enabled: config.enabled ?? true,
          position: config.position || (catConfig?.pos || 'after_char'),
          use_regex: false,
          selectiveLogic: config.selectiveLogic || "AND ANY",
          extensions: {
            "prevent_recursion": true,
            "exclude_recursion": true
          }
        });
      }
    }
  };

  scanAndPack(worldLoreDir);
}
```

---

## 四、 實作部署步驟 (Implementation Execution Flow)

當前本設計規格書已成功記錄在卡片工作區。當您授權啟動代碼變更後，我們將按以下順序實施：

1.  **代碼注入**：
    -   將 `auditCompiledCard` 及對應的 MCP Tool 宣告寫入 `assembly.ts` 中，並在 `index.ts` 中進行註冊。
    -   將 `scanAndPack` 的多維度目錄遞迴編譯掃描邏輯寫入 `assembly.ts` 中，取代原有單一層的 `世界設定` 拼裝。
2.  **本地編譯**：
    -   在 `mcp-servers/st-forge` 目錄下執行 `npm run build` 生成最新編譯。
3.  **測試驗證**：
    -   呼叫新工具對既有的卡片（如 `exports/雪乃.png`）執行 `audit_compiled_card` 評估，驗證是否能順利輸出精緻的 Markdown 智慧評估診斷書。
