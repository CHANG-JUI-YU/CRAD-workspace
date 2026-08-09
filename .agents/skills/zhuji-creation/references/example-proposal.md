# 現行 Proposal 範例

先確認 Task 的 `output_kind`。以下是單一 `appearance` 模組的現行外殼；實際提交必須使用最新 revision、指定角色與完整內容。

```yaml
schema_version: 1
id: proposal-character-1-appearance-1
owner: zhuji-creator
base_workflow_revision: 12
base_artifact_revision: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
value:
  kind: zhuji
  character_id: character-1
  module:
    schema_version: 1
    mode: zhuji
    module: appearance
    title: 外顯
    data:
      外顯核心:
        姓名: 範例角色
        整體性概括: 她總以微抬下巴與穩定視線掌握談話節奏。
      面貌: { 基礎內容: {}, 表情刻畫: {} }
      身體基礎數據: {}
      性器官特徵: {}
      其他器官特徵: {}
      聲音: {}
      服裝風格與著裝習慣: {}
      交互模式: {}
      整體感官體驗: {}
    provenance:
      - { kind: creator, note: 依已批准 Blueprint 補全, extensions: {} }
    extensions: {}
extensions: {}
```

角色基礎文件使用 `value.kind: character`，內容符合 `character@1`，只保存身份摘要、別名、角色關係與必要基礎 sections。它不是第八個珠璣模組。
