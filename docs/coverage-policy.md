# Coverage Policy

`pnpm test:coverage` 是全 repo 的正式 coverage 門檻，由 `vitest.config.ts` 強制執行，CI（`.github/workflows/ci.yml`）執行同一命令。

## 目前基準

| 指標 | 門檻 | 實測基準 |
| --- | --- | --- |
| Statements | 90% | 91.07% |
| Branches | 82% | 82.21% |
| Functions | 90% | 91.21% |
| Lines | 90% | 91.07% |

## Branches 82% 的 ratchet 原則

- Branches 的 82% 是暫時且可執行的最低門檻，以實測基準 82.21% 為基礎，保留約 0.21% 的跨環境與取整空間。
- Threshold 原則上只能提高，不得因新增未測程式碼而降低。
- 後續新增或修改高風險模組時，應同時補 focused tests（優先補 branch coverage）。
- 提高任何門檻前，應以 CI／乾淨環境的穩定結果為準。
- 不得以擴大 exclude、ignore 標記、弱化測試或改變統計口徑來通過門檻。
