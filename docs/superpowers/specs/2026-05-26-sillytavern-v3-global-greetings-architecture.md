# SillyTavern V3 終極工作流：全域解耦開場白與多角色編譯架構升級規格書

本規格書落實了「先寫好世界書設定，再根據全域設定設計開場白」的重大架構升级。將開場白（Greetings）從單一角色目錄抽離，提升至專案級全域高度，徹底解決多角色卡編譯覆寫衝突。

---

## 一、 新物理目錄結構對齊

不論是單角色卡還是多角色卡，`greetings.yaml` 都將直接存放在專案根目錄：

```text
drafts/oregairu-adult/                <-- 專案根目錄
├── 模組0_概覽.yaml
├── imported-base.yaml
├── greetings.yaml                    <-- 全域解耦開場白 (新位置！)
├── 世界設定/
│   └── 奉仕部.yaml
├── yukino/                           <-- 角色子目錄 (僅存放純淨設定，無開場白)
│   ├── 模組1_外顯.yaml
│   └── ...
└── haruno/
    ├── 模組1_外顯.yaml
    └── ...
```

---

## 二、 Forge MCP 伺服器 (`st-forge`) 原始碼改造設計

### 2.1 升級 `mergeAndExport` 編譯引擎 (in `assembly.ts`)
編譯器將從專案根目錄直接讀取 `greetings.yaml`，不再從角色子目錄中檢索。

```typescript
// 1. 在 mergeAndExport 開始時，定義全域開場白
let globalFirstMes = "";
let globalAlternateGreetings: string[] = [];

const globalGreetingsPath = path.join(targetDraftsDir, 'greetings.yaml');
if (fs.existsSync(globalGreetingsPath)) {
  try {
    const parsed = YAML.parse(fs.readFileSync(globalGreetingsPath, 'utf8'));
    if (parsed.first_mes) globalFirstMes = parsed.first_mes.trim();
    if (parsed.alternate_greetings && Array.isArray(parsed.alternate_greetings)) {
      globalAlternateGreetings = parsed.alternate_greetings.map((g: string) => g.trim());
    }
  } catch (e) {
    console.error(`Error reading global greetings.yaml:`, e);
  }
}

// 2. 在組裝最終 card 物件時，寫入全域開場白
const card: any = {
  name: resolvedCharName || "Multi-Character Card",
  description: "", 
  personality: "", 
  scenario: "", 
  first_mes: globalFirstMes, 
  alternate_greetings: globalAlternateGreetings,
  extensions: {}
};
```

### 2.2 升級 `decompileCharaCard` 反向解包工具
解包現有卡片時，直接將開場白寫入專案根目錄。

```typescript
// 寫入專案全域開場白
const greetings: any = {};
if (data.first_mes) greetings.first_mes = data.first_mes;
if (data.alternate_greetings?.length) greetings.alternate_greetings = data.alternate_greetings;
if (Object.keys(greetings).length > 0) {
  fs.writeFileSync(path.join(targetDraftsDir, 'greetings.yaml'), YAML.stringify(greetings), 'utf8');
}
```

---

## 三、 狀態機與技能組更新

1.  **狀態機 (`st-director.md`) 升級**：
    *   在 `Stage 5` 時，明確指引 Director 讀取全域專案目錄（通讀所有角色子資料夾及 `世界設定/`），然後召喚 `st-greetings-skill` 將全域開場白寫入 `drafts/<projectId>/greetings.yaml`。
2.  **`st-greetings-skill` 提示詞優化**：
    *   明確告知 AI 其為「整部世界書的序幕策劃者」，必須參考專案下的**所有角色設定**與**世界背景**，設計全景式開場白。
