# SillyTavern V3 終極工作流：卡片智慧診斷與多維世界書實作藍圖 (Implementation Blueprint)

本文件是在規劃模式 (Plan Mode) 下產出的 100% 精準實作藍圖，包含待修改原始碼的精確替換區間與完整 TypeScript 代碼設計。當系統切換至實作模式時，可直接進行手術式替換。

---

## 一、 `st-forge` 原始碼修改：`src/tools/assembly.ts`

### 1.1 導入與工具擴展

在 `assembly.ts` 頂部或適當位置，確保已引入需要的 fs 與 path 模組。

### 1.2 智慧診斷工具 `auditCompiledCard` 完整實作

將以下完整代碼寫入 `assembly.ts` 的末尾（或在 `resolveBlueprintData` 之前）：

```typescript
import { embedCharaDataIntoPng } from "../utils/png-utils.js"; // 確保 PNG 讀寫依賴

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

/**
 * 輔助函數：從 PNG 檔案的 tEXt chunk 中提取 chara 欄位數據並解析成 JSON
 */
function extractJsonFromPng(pngPath: string): any {
  const buffer = fs.readFileSync(pngPath);
  // 尋找 'chara' 標記
  const charaMarker = Buffer.from('chara\0');
  const index = buffer.indexOf(charaMarker);
  if (index === -1) {
    throw new Error("無法在 PNG 圖片中找到 character card metadata chunk (chara)。");
  }

  // 讀取 chunk 長度 (charaMarker 前面 4 個 bytes 是 length，但為了健壯性我們直接讀取後續字串)
  const dataStart = index + charaMarker.length;
  // 尋找 JSON 結尾
  const slice = buffer.slice(dataStart);
  // 尋找 PNG IEND 或下一個 chunk 以確保安全截斷，最簡單是尋找對應的 JSON 括號閉合或使用 Base64
  let rawStr = slice.toString('utf8');
  
  // 由於 tEXt chunk 是純文字，我們可以直接尋找字串形式的 Base64 數據並解碼
  try {
    // 嘗試進行 Base64 解碼
    const decoded = Buffer.from(rawStr, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {
    // 如果不是 Base64 而是明文 JSON 
    try {
      // 尋找第一個 '{' 與最後一個 '}'
      const firstBrace = rawStr.indexOf('{');
      const lastBrace = rawStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        return JSON.parse(rawStr.slice(firstBrace, lastBrace + 1));
      }
    } catch (e2) {}
    throw new Error("解析 PNG character card metadata 失敗。");
  }
}

/**
 * 對已導出的實體角色卡（PNG/JSON）執行 5 大指標診斷
 */
export function auditCompiledCard(filePath: string): AuditReport {
  let cardJson: any = null;
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`找不到指定的角色卡檔案：${absPath}`);
  }

  if (absPath.endsWith('.png')) {
    cardJson = extractJsonFromPng(absPath);
  } else if (absPath.endsWith('.json')) {
    cardJson = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } else {
    throw new Error("不支援的檔案格式，僅支援 .png 與 .json 角色卡。");
  }

  const report: AuditReport = {
    cardName: cardJson.name || "未命名角色",
    totalScore: 100,
    checks: [],
    suggestions: []
  };

  // 1. 空白 Description 鐵律 (20分)
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

  // 2. 敘事禁詞掃描 (20分)
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
      : `發現 ${foundForbidden?.length} 處 AI 腔禁用詞：[${Array.from(new Set(foundForbidden)).join(', ')}]。這會破壞角色扮演的客觀沉浸感。`
  });

  // 3. 開場白 Puppeteering 檢測 (20分)
  const firstMes = cardJson.first_mes || "";
  const puppeteeringRegex = /({{user}}|你)(的內心|想道|看著|無奈|嘆氣|走過來)/;
  const pupPassed = !puppeteeringRegex.test(firstMes);
  report.checks.push({
    category: "開場白 Puppeteering 檢測 (No User Control)",
    passed: pupPassed,
    score: pupPassed ? 20 : 5,
    maxScore: 20,
    details: pupPassed
      ? "完美通過！首頁開場白未檢測到替玩家代白、預設言行或控制心理的行為。"
      : "警告：開場白中存在替玩家 {{user}} 代白、控制玩家肢體或心理活動的描述，這會嚴重損害使用者的主體扮演權。"
  });

  // 4. 雙遞迴常態預防 (20分)
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
      : `警告：發現有 ${unsafeCount} 個條目未正確啟用 prevent_recursion / exclude_recursion 標記！這會引發 Token 暴漲黑洞。`
  });

  // 5. 開場白篇幅與 Closed Endings (20分)
  const mesLength = firstMes.length;
  const isLengthOk = mesLength >= 400 && mesLength <= 1000;
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

  report.totalScore = report.checks.reduce((acc, curr) => acc + curr.score, 0);

  if (!descPassed) report.suggestions.push("一鍵清空主卡 Description，將背景設定封包至世界書對應條目。");
  if (!forbiddenPassed) report.suggestions.push("對草稿進行 Narrative Linter 脫敏，使用更具白描感的客觀描寫替換 AI 詞彙。");
  if (!pupPassed) report.suggestions.push("修改開場白，移除任何對 {{user}} 心理、動作的越權描寫。");
  if (unsafeCount > 0) report.suggestions.push("重新運行 merge_and_export 編譯器，使編譯器自動為存量條目熱修補防禦擴展。");

  return report;
}
```

### 1.3 `mergeAndExport` 的多維度世界書編譯代碼替換

在 `mergeAndExport` 函數中，尋找原先對 `世界設定` 平鋪掃描的區間（大約在 line 290 - 320 附近，具體視偏移而定），將其替換為支援多階子目錄遞迴編譯的 `scanAndPack` 邏輯：

**替換前代碼**：
```typescript
  const worldLoreDir = path.join(targetDraftsDir, '世界設定');
  if (fs.existsSync(worldLoreDir)) {
    const loreFiles = fs.readdirSync(worldLoreDir).filter(f => f.endsWith('.yaml'));
    // ... 原本的平鋪 push 邏輯
  }
```

**替換後代碼**：
```typescript
  const worldLoreDir = path.join(targetDraftsDir, '世界設定');
  if (fs.existsSync(worldLoreDir)) {
    // 定義四大預設維度設定
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
          // 遞迴進入人物/地理等子目錄
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

## 二、 `st-forge` 原始碼修改：`src/index.ts`

### 2.1 引入工具

修改 `src/index.ts` 頂部的導入段：

**修改前**：
```typescript
import { 
  importCharaCard, 
  mergeAndExport, 
  decompileCharaCard, 
  exportPngCard, 
  patchYamlDraft, 
  extractLoreFacts, 
  convertCharaDraftMode 
} from "./tools/assembly.js";
```

**修改後（加入 `auditCompiledCard`）**：
```typescript
import { 
  importCharaCard, 
  mergeAndExport, 
  decompileCharaCard, 
  exportPngCard, 
  patchYamlDraft, 
  extractLoreFacts, 
  convertCharaDraftMode,
  auditCompiledCard
} from "./tools/assembly.js";
```

### 2.2 註冊 MCP 工具宣告

在 `ListToolsRequestSchema` 處理器的工具清單數組末尾，新增 `audit_compiled_card` 宣示：

```typescript
      {
        name: "audit_compiled_card",
        description: "Directly audits a compiled V3 character card (.png or .json) against quality guidelines.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to the compiled .png or .json card." }
          },
          required: ["filePath"]
        }
      }
```

### 2.3 註冊工具路由回調

在 `CallToolRequestSchema` 處理器的 `switch (name)` 分流中，新增 `audit_compiled_card` 分支：

```typescript
      case "audit_compiled_card":
        return { content: [{ type: "text", text: JSON.stringify(auditCompiledCard(args?.filePath as string)) }] };
```
