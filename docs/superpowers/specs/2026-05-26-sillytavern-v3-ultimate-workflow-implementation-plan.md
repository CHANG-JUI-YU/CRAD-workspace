# SillyTavern V3 終極生成工作流實作執行指南 (Implementation Guide)

本文件是在規劃模式 (Plan Mode) 下產出的實作路線圖，為後續代碼編寫、技能解耦重構以及工作流對接提供精確的程式碼結構與目錄指引。

---

## 一、 階段 1：Forge MCP 伺服器 (`st-forge`) 工具鏈升級

### 1.1 `src/tools/assembly.ts` 核心編譯邏輯升級 (`mergeAndExport`)

編譯器需要新增對選填目錄 `世界設定/` 以及獨立開場白 `greetings.yaml` 的支援，並在編譯時自動補全規格。

#### A. 非角色世界設定掃描與補全
```typescript
// 1. 偵測世界設定目錄
const worldLoreDir = path.join(targetDraftsDir, '世界設定');
if (fs.existsSync(worldLoreDir)) {
  const loreFiles = fs.readdirSync(worldLoreDir).filter(f => f.endsWith('.yaml'));
  
  for (const f of loreFiles) {
    const raw = fs.readFileSync(path.join(worldLoreDir, f), 'utf8');
    const parsed = YAML.parse(raw);
    
    // 提取條目設定與關鍵字
    const config = parsed['條目設定'] || {};
    const keys = parsed['關鍵字'] || {};
    const content = parsed['設定內容'] || "";
    
    // 自動包裹 XML
    const tagName = f.replace('.yaml', '');
    const wrappedContent = `<${tagName}>\n${content.trim()}\n</${tagName}>`;
    
    // 強制注入雙遞迴常態防禦
    card.character_book.entries.push({
      id: currentId++,
      keys: keys.primary || [],
      secondary_keys: keys.secondary || [],
      comment: config.comment || `世界設定_${tagName}`,
      content: wrappedContent,
      constant: config.constant ?? false,
      selective: config.selective ?? true,
      insertion_order: config.insertion_order ?? 50,
      enabled: config.enabled ?? true,
      position: config.position || "after_char",
      use_regex: false,
      selectiveLogic: config.selectiveLogic || "AND ANY",
      // 強制雙遞迴隔離
      extensions: {
        "prevent_recursion": true,
        "exclude_recursion": true
      }
    });
  }
}
```

#### B. 獨立開場白載入 (`greetings.yaml`)
```typescript
// 讀取獨立開場白
const greetingsPath = path.join(targetDraftsDir, charName, 'greetings.yaml');
if (fs.existsSync(greetingsPath)) {
  const raw = fs.readFileSync(greetingsPath, 'utf8');
  const parsed = YAML.parse(raw);
  
  if (parsed.first_mes) {
    card.first_mes = parsed.first_mes.trim();
  }
  if (parsed.alternate_greetings && Array.isArray(parsed.alternate_greetings)) {
    card.alternate_greetings = parsed.alternate_greetings.map((g: string) => g.trim());
  }
}
```

### 1.2 反向智能解包工具 (`decompile_chara_card`)
- **功能**：智能解析 V3 卡片並還原為 YAML 格式。
- **邏輯**：
  ```typescript
  export function decompileCharaCard(filePath: string, characterId?: string) {
    // 1. 讀取卡片
    const cardData = readCharaData(filePath); 
    const targetDir = getDraftsDir(characterId);
    
    // 2. 判斷模式：掃描世界書條目內容
    let mode: "珠璣" | "調色盤" = "珠璣";
    const entries = cardData.character_book?.entries || [];
    const hasPalette = entries.some((e: any) => e.content.includes('<personality_palette>'));
    if (hasPalette) {
      mode = "調色盤";
    }
    
    // 3. 雙軌還原
    // A. 模組化還原：反向剝離 XML 並輸出對應 YAML。
    // B. 普通卡還原（主卡欄位不為空）：
    //    * first_mes 寫入 greetings.yaml
    //    * personality 與 description 寫入 imported-base.yaml
  }
  ```

### 1.3 雙向模式轉換工具 (`convert_chara_draft_mode`)
- **轉換策略**：並行分身專案 (Side-by-Side Clone)。
- **代碼實現設計**：
  ```typescript
  export function convertCharaDraftMode(characterId: string, targetMode: "珠璣" | "調色盤") {
    const sourceDir = getDraftsDir(characterId);
    const targetId = `${characterId}-${targetMode === "珠璣" ? '珠璣' : '調色盤'}`;
    const targetDir = getDraftsDir(targetId);
    
    // 1. 複製基礎專案與概覽
    // 2. 呼叫特定 AI 模型對 YAML 內容進行「重組、重寫或蒸餾」
    // 3. 將重寫後的 YAML 儲存至新目錄，並修改模組0_概覽.yaml的模式。
  }
  ```

### 1.4 編譯期 Regex Linter 禁詞掃描與決策暫存 Fallback
- **禁詞 Regex 設計**：`/(一絲|一抹|一縷|弧度|彎起嘴角|喉結|指節發白)/g`
- **Fallback 注入**：
  ```typescript
  // 檢查 pending decisions
  const pendingPath = path.join(targetDraftsDir, 'pending_decisions.json');
  if (fs.existsSync(pendingPath)) {
    const decisions = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    const hasPending = decisions.some((d: any) => d.status === 'pending');
    
    if (hasPending) {
      if (strictReview) {
        throw new Error("編譯被阻斷：專案中仍有 pending 的設計決策！");
      } else {
        // 非嚴格審查：自動填入預設備用值，並注入 [DEBUG] 標籤
        applyFallbackAndInjectDebugTags(card, decisions);
      }
    }
  }
  ```

---

## 二、 階段 2：Subagents 技能組解耦與重構

我們將在 `.agents/skills/` 下創建以下獨立的 Skill Markdown 檔案及配置：

### 2.1 `st-creator-palette-skill` (調色盤創作)
- **職責**：生成「基礎信息.yaml」、「性格調色盤.yaml」、「三面性.yaml」、「二次解釋.yaml」。
- **References**：
  - `references/basic-info.md` (基礎信息結構與欄位規格)
  - `references/personality-palette.md` (底色、主色、點綴與行為衍生規範)
  - `references/tri-faceted.md` (壓力面觸發、能量、語料、身體、功能及滲透規範)
  - `references/secondary-interpretation.md` (心理學底層 Why 剖析規範)

### 2.2 `st-critic-palette-skill` (調色盤審查)
- **審查重點**：
  - 性格調色盤與三面性概念是否有合理的印證與呼應。
  - 語料是否包含動作/心理（必須 100% 純對話）。
  - 各面孔的「功能」是否能完美對應「二次解釋」中的心理創傷或成長背景。

### 2.3 `st-greetings-skill` (開場白寫作)
- **寫作重點**：
  - 讀取前面鎖定的所有 YAML，俯瞰角色靈魂厚度。
  - 使用白描、畫面渲染與懸念留白，撰寫 `first_mes` 與 `alternate_greetings`，並寫入 `greetings.yaml`。
  - 嚴格禁止 Puppeteering（控制玩家言行、心理）與 Closed Endings（沒有留下互動空間）。

### 2.4 `st-critic-greetings-skill` (開場白審查)
- **品質 Checklist**：
  - 100% 繁體中文（zh-TW）且契合自稱習慣。
  - 檢測是否違反 Puppeteering 與 Closed Endings。
  - 執行 Regex 掃描 AI-isms 禁詞。

---

## 三、 階段 3：Director 狀態機 (`st-director.md`) 升級與對接

升級 `st-director.md` 中的狀態推進與 Subagent 加載策略：

### 3.1 狀態推進路由修改 (Stage 1 ~ Stage 6)

1. **Stage 1: 藍圖確立**：
   - 詢問並引導使用者選擇「珠璣（極致詳細之 7 模組）」或「調色盤（壓力策略與寫意）」模式。
   - 將所選模式寫入 `模組0_概覽.yaml` 中，鎖定此專案的骨幹模式。
2. **Stage 3: 線性展開 (Linear Expansion)**：
   - 讀取概覽中的模式：
     - 如果是 `珠璣`，加載 `st-creator-zhuji-skill`，引導生成 1-7 模組。
     - 如果是 `調色盤`，加載 `st-creator-palette-skill`，引導生成基礎信息、調色盤、三面性與二次解釋。
3. **Stage 4: 全局審查 (Critic Loop)**：
   - 如果是 `珠璣`，調度 `st-critic-zhuji-skill` 審查。
   - 如果是 `調色盤`，調度 `st-critic-palette-skill` 審查。
4. **Stage 5: 開場白與外掛 (Greetings Stage - 全新階段)**：
   - 所有的設定模組鎖定後，**調度 `st-greetings-skill` 生成 `greetings.yaml`**。
   - **調度 `st-critic-greetings-skill` 審查開場白**，確保完美後儲存。
   - 如果有高階腳本需求，加載 MVU / EJS / HTML 控制器（自動注入清除變量更新歷史的正則）。
5. **Stage 6: 打包編譯**：
   - 呼叫 `export_png_card` 工具，底層自動執行 Regex Linter 與 Pending Decisions fallback 安全閥門。
   - 生成完美契合 SillyTavern V3 Spec 的實體卡片 PNG（含 metadata）與 JSON。
