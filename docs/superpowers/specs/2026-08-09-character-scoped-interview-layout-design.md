# 角色級訪談與語意資料夾佈局設計

## 狀態

設計草案，等待使用者審閱。這份變更分成兩個互相配合、但可分別測試的部分：

1. 多角色卡的 Blueprint 方向改為逐角色保存。
2. 專案內的檔案按內容用途落在語意資料夾，`exports/` 只保留最終角色卡輸出。

## 背景與問題

目前 interview engine 只有一個全專案 `blueprint_direction`。單角色尚可使用，
但多人卡會把不同角色的外在定位、內在驅動與創作取捨混成同一個方向，後續
Creator 也無法從 Blueprint 判斷每名角色應該走哪一條核心路線。

目前 materializer 雖然已把珠璣、調色盤與 wardrobe 放到角色資料夾，Blueprint、
world、relationships、greetings 仍在專案根目錄，且發布交易會把 canonical JSON、
具名 JSON、PNG 與 manifest 混在 `exports/`。這使工作區的「可編輯內容」與「最終
輸出」邊界不清楚。現有專案也可能有舊的公開 `proposals/` 與 `exports/` 子資料夾，
需要在不遺失內容的前提下轉入新佈局。多人卡的角色檔案則容易被錯誤地視為同一份內容。

## 目標

- 單角色維持目前自然語言訪談體驗，不增加底層參數。
- 多角色先建立暫時角色名單，再由 Director 逐名提出 3 個角色設定方向選項。
- 每名角色的方向、選擇歷史、Blueprint provenance 與 precheck subject 都獨立保存。
- 舊的單一 `blueprint_direction` interview state 與 Blueprint 仍可讀取。
- 移除 `proposals/` 概念；proposal 只存在 artifact revision／workflow state，最新可讀內容
 直接落在對應的語意資料夾。
- `characters/<character-folder>/` 永遠是一名角色的邊界，多角色不得共用角色內容檔。
- `exports/` 只寫最後角色卡輸出，不寫 workflow manifest、plugin trace 或中間 canonical 副本。
- 不改變既有 schema、review、publish gate、CCv3／PNG compiler 的內容語意。
- 舊專案的 `proposals/` 與 exports 子資料夾可安全遷移；遷移失敗時保留可讀備份，不直接刪除使用者內容。

## 非目標

- 不在本次變更中把所有背景、性格問題都重新設計成逐角色長訪談；本次最小必要變更是
  角色名單與角色級 Blueprint direction。
- 不要求使用者輸入 character id、project revision、path、task id 或其他底層參數。
- 不把 proposal 另存成公開的 `proposals/` 檔案樹。
- 不把歷史 artifact revision 直接輸出成可發布卡片；歷史仍由 state／artifact ledger 保留。

## 設計一：角色級訪談方向

### 1. 角色名單

當 `card_shape` 為多人卡時，`InterviewState` 增加一個角色名單步驟。問題以自然語言
要求使用者列出每名角色的暫稱或一句定位，例如：

> 請列出卡片中的每名角色，可以使用暫稱或一句定位，不需要提供內部 ID；一行一名即可。

引擎接受換行、頓號、逗號或分號分隔的自然語言，產生順序穩定的內部 subject：

```text
character-1、character-2、...
```

內部 subject 由引擎產生，不顯示為使用者需要填寫的參數。顯示給使用者的是暫稱／定位；
正式角色名稱仍可在後續角色設定流程確認。

單人卡也會建立一個 `character-1` subject，但問題文字與目前單角色體驗一致。

### 2. 逐角色方向問題

角色名單建立後，訪談依順序產生：

```text
blueprint_direction:character-1
blueprint_direction:character-2
...
```

問題文字包含目前角色的暫稱與定位，要求 Director 提供 3 個以角色設定為主的方向。
每個方向仍可被選擇、重新產生、混合或用短句修正；`{{user}}` 關係只作為方向中的一項
可能影響，不得取代角色設定主軸。

每個角色的重新產生與短句修改只影響該角色的 direction history，不會重置其他角色。
若使用者提出沒有辦法安全對應到某名角色的方向修改，系統只提出一個簡短選擇問題，
不自行套用到全部角色。

### 3. InterviewState 相容擴充

保留既有欄位以讀取舊 state，新增可選欄位：

```ts
interface InterviewCharacterSubject {
  id: string;          // engine-generated, e.g. character-1
  label: string;       // temporary name or natural-language role label
  ordinal: number;
}

interface InterviewState {
  ...existing fields...
  characters?: InterviewCharacterSubject[];
  active_character_id?: string;
}
```

新流程的答案仍以原子 `InterviewAnswer` 保存；動態 question id 只作為引擎內部索引。
舊 state 沒有 `characters` 時，讀取時視為單一 `character-1`。舊的全域
`blueprint_direction` 仍可被 `buildBlueprintPrecheck` 讀取並映射至單一角色。

### 4. Blueprint 與 precheck

新 Blueprint candidate 使用角色陣列：

```json
{
  "characters": [
    {
      "id": "character-1",
      "label": "冷靜的姐姐",
      "direction": {
        "scope": "character_setting",
        "selected": "...",
        "source_question_id": "blueprint_direction:character-1",
        "history": []
      }
    }
  ]
}
```

單角色的新 Blueprint 也使用 `characters`；為相容既有 Creator 與舊 artifact，可以在只有
一名角色時同時保留等價的 `blueprint_direction` mirror。新產物以 `characters` 為權威。

`BlueprintPrecheckCheck.subject_id` 的規則改為：

- `character_core`、`background`、`personality`、`cross_module_impact`：每名角色各一份。
- `relationships_boundaries`、`world_dependencies`：使用 project subject，因為它們仍是專案級設定。

Creator context、角色 module task 與 blueprint provenance 必須保留對應角色 id，不能把
多名角色的 direction 合併成一個無 subject 的字串。

### 5. Agent／路由文字

Director orchestration skill、prompt 與 workflow routing 必須明確規定：

- 多角色先建立 roster，再逐名完成角色設定方向。
- 方向選項的標題、摘要與取捨必須針對目前角色。
- 不要求使用者輸入內部 id；Director／engine 自動管理 subject。
- Blueprint 完成確認仍是一次 project-level gate，但內容包含每名角色的方向。

## 設計二：語意資料夾與發布輸出

### 1. 目標資料樹

```text
projects/<project>/
├─ .workspace/
│  ├─ state.json
│  ├─ interview.json
│  ├─ blueprint-prechecks.json
│  ├─ workflow.json
│  └─ ...audit / policy / operation state...
├─ blueprint/
│  └─ blueprint.json
├─ characters/
│  ├─ <character-a>/
│  │  ├─ character.json
│  │  ├─ zhuji/<module>.json
│  │  ├─ palette/<module>.json
│  │  └─ wardrobe/wardrobe.md
│  └─ <character-b>/
├─ world/
│  └─ <world-artifact>.json
├─ relationships/
│  └─ relationships.json
├─ greetings/
│  └─ greetings.json
├─ sources/manifest.json
├─ knowledge/chunks.json
├─ facts/register.json
├─ plugins/<plugin-id>.json
└─ exports/
   ├─ <project>-角色卡.json
   └─ <project>-角色卡.png
```

`world/` 是世界設定資料夾（不是訪談或 proposal 的暫存區）。若同一 kind 有多個獨立
world artifact，使用經過 `safeSegment` 的 artifact name／entry id 分檔，避免互相覆寫。

### 2. Artifact materialization mapping

| artifact kind | materialized path |
|---|---|
| `character` | `characters/<character-folder>/character.json` |
| `zhuji` | `characters/<character-folder>/zhuji/<module>.json` |
| `palette` | `characters/<character-folder>/palette/<module>.json` |
| `wardrobe` | `characters/<character-folder>/wardrobe/wardrobe.md` |
| `blueprint` | `blueprint/blueprint.json` |
| `world_lore` | `world/<safe-artifact-name>.json` |
| `relationship` | `relationships/relationships.json` |
| `greeting` | `greetings/greetings.json` |
| `plugin` | `plugins/<plugin-id>.json` |

review、source research、fact curation/review、conversion、import analysis 與
director routing 等流程型 artifact 不另建公開 proposal 檔；它們由 state、audit、
source manifest、facts register 或正式目標 artifact 保存。未知 kind 若需要保留，
只能落在 `.workspace/artifacts/`，不得重新建立根目錄 `proposals/`。

### 2.1 舊佈局遷移

新專案不建立 `proposals/`。讀取既有專案時，若發現公開 `proposals/` 或 exports 子資料夾，
Repository 以可重跑的遷移流程處理：

1. 先依檔案內容與 artifact metadata 對應到上述語意路徑，寫入 staging。
2. 逐檔驗證內容 hash 與目標路徑，確認完整後才切換新路徑。
3. 舊 proposal／中間 export 不再留在公開內容樹；移到 `.workspace/legacy-layout/<migration-id>/`
   作為唯讀備份，直到使用者明確清理。
4. 任一檔案無法安全辨識角色、kind 或格式時，不猜測、不覆寫；保留在
   `.workspace/legacy-layout/unresolved/` 並回傳一個可恢復的簡短問題。
5. 遷移完成後再次執行必須是 no-op；任一失敗不得刪除舊檔或留下半套新檔。

### 3. 多角色隔離

角色資料夾只由穩定角色 subject／document id 決定，顯示名稱只作可讀 suffix。Materializer
必須對每個角色分別建立：

- `character.json`
- 該角色的 zhuji／palette modules
- 該角色的 wardrobe

兩名角色即使有相同顯示名稱、相同模式或相同 module 名稱，也不能寫入同一個檔案。

### 4. exports 邊界

Publish transaction 只寫最後可直接使用的角色卡 JSON 與 PNG。移除：

- `exports/ccv3.json` 中間副本
- `exports/card.json` 重複副本
- `exports/manifest.json`
- `.workspace` 以外的 plugin build trace

最終輸出檔名以目前 project name 與角色卡 suffix 產生；同一次 publish 的 JSON 與 PNG
使用同一個 content hash 與 publish transaction。舊 publish 的檔案在新 publish 成功前不
刪除；新 publish 成功後只保留最新輸出，舊歷史由 `publishes` ledger 保存。

## 失敗與恢復

- 多角色 roster 無法安全拆成至少兩名角色時，提出簡短補充問題，不產生全域 direction；單角色允許一名 subject。
- 某一名角色方向缺失時，只暫停該角色的 direction，不宣稱整個 Blueprint 完成。
- 角色檔案路徑衝突時回傳可恢復錯誤並保留上一 revision，不覆寫其他角色。
- 語意檔案寫入失敗時維持 transaction atomicity；`exports/` 不留下半套輸出。
- publish 失敗不改變 `project_status: published`，舊 exports 保持可讀。

## 驗收與測試

### Interview／Blueprint

1. 單角色訪談仍只產生一名 subject，舊測試與舊 state 可讀取。
2. 多角色訪談建立兩個以上 subject，方向問題逐名出現，答案 question id 與 history 各自獨立。
3. 重新產生／短句修改角色 A 不會改變角色 B 的 direction。
4. Candidate Blueprint 包含每名角色的 direction；precheck character dimensions 以角色 subject 分列。
5. 舊單一 `blueprint_direction` 能映射到 `character-1`，不破壞既有 Blueprint revision。

### Filesystem／Publish

1. 多角色 character artifacts 分別寫入不同 `characters/<folder>/`，無互相覆寫。
2. Blueprint、world、relationships、greetings 都落在對應語意資料夾。
3. 不會建立 `proposals/`；流程型 artifact 不會落到公開 artifacts/proposals 根目錄。
4. publish 後 `exports/` 只包含最終 JSON 與 PNG，沒有 manifest、ccv3 duplicate 或 trace。
5. 發布失敗或檔案寫入失敗時，舊 exports 與 project status 維持不變。
6. 完整 typecheck、targeted tests、full regression 與 agent lint 通過。
