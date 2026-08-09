# Agent / Skill / Personality 遷移對照表

## 資產狀態

- 舊 registry：22 個 Agent entry。
- 舊 prompt：20 份；Reviewer-1/2/3 共用 fact-reviewer prompt。
- personality：22 份 YAML；runtime-instructions.md 已同步至 `.agents/personalities/runtime-instructions.md`，目前由 Director active prompt 載入；`docs/migration/legacy-runtime-instructions.md` 保留為稽核參考。
- Skill：20 個，完整原始內容已複製；舊 active SKILL.md 另存於 docs/migration/legacy-skills。

## Agent 對照

| 舊 Agent ID | 新 active prompt | Personality | Skill | 遷移策略 |
|---|---|---|---|---|
| director | agents/director.md | director | director-orchestration | 高階 Director；由 Runtime 自動路由與提問 |
| source-researcher | agents/source-researcher.md | source-researcher | source-research | 隱藏來源批次、候選與 revision |
| fact-curator | agents/fact-curator.md | fact-curator | fact-curation | 保留證據與可追溯規則 |
| fact-reviewer-1 | agents/fact-reviewer.md | fact-reviewer | fact-review | 共享執行器，獨立審查 |
| fact-reviewer-2 | agents/fact-reviewer.md | fact-reviewer | fact-review | 共享執行器，獨立審查 |
| fact-reviewer-3 | agents/fact-reviewer.md | fact-reviewer | fact-review | 共享執行器，獨立審查 |
| zhuji-creator | agents/zhuji-creator.md | zhuji-creator | zhuji-creation | 保留七模組創作規則 |
| palette-creator | agents/palette-creator.md | palette-creator | palette-creation | 保留調色盤模式規則 |
| character-critic | agents/character-critic.md | character-critic | character-critique | 唯讀審查 |
| relationship-creator | agents/relationship-creator.md | relationship-creator | relationship-creation | 專案級關係產物 |
| greetings-creator | agents/greetings-creator.md | greetings-creator | greetings-creation | 開場白產出 |
| greetings-critic | agents/greetings-critic.md | greetings-critic | greetings-critique | 唯讀開場白審查 |
| mode-conversion | agents/mode-conversion.md | mode-conversion | mode-conversion | 珠璣/調色盤轉換 |
| card-import-analyst | agents/card-import-analyst.md | card-import-analyst | card-import-analysis | 匯入檢查與 Blueprint 建議 |
| world-lore-creator | agents/world-lore-creator.md | world-lore-creator | world-lore-creation | 分類世界設定 |
| world-lore-critic | agents/world-lore-critic.md | world-lore-critic | world-lore-critique | 唯讀世界設定審查 |
| mvu-creator | agents/mvu-creator.md | mvu-creator | mvu-creation | typed MVU proposal |
| mvu-critic | agents/mvu-creator-critic.md | mvu-creator-critic | mvu-critique | typed MVU 唯讀審查 |
| ejs-creator | agents/ejs-creator.md | ejs-creator | ejs-creation | typed EJS proposal |
| ejs-critic | agents/ejs-creator-critic.md | ejs-creator-critic | ejs-critique | typed EJS 唯讀審查 |
| html-creator | agents/html-creator.md | html-creator | html-creation | typed HTML proposal |
| html-critic | agents/html-creator-critic.md | html-creator-critic | html-critique | typed HTML 唯讀審查 |

## 高階 Intent 路由

- source：來源研究、來源候選、來源保存、來源驗證。
- knowledge：事實整理、證據摘要、知識刷新。
- authoring：角色、關係、世界設定、珠璣、調色盤、開場白、插件 proposal。
- review：角色、世界設定、開場白、事實與插件審查。
- import：舊卡檢查、匯入與轉換。
- build：預覽、建置與發布。
- status：讀取目前進度。

## 低階欄位移除原則

以下名稱可以在 docs/migration/legacy-* 參考檔出現，但不得成為 active Agent/Skill 的輸入要求：

task、lease、batch、candidate、revision、capability、approval audit、file_path、bytes_base64、受控工具路由名稱。

## 不可移除的安全規則

- 不捏造來源或未完成狀態。
- 未驗證內容只能標為未驗證草稿。
- Critic 唯讀且不能批准自己的產物。
- 來源受控擷取與權限限制不得繞過。
- Personality prohibited_behaviors 優先於便利性。
