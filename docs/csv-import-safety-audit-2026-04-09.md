# CSV一括登録 安全性監査（2026-04-09）

対象:
- routes/admin.js
- lib/csv-import.js
- models/Person.js
- models/Book.js
- models/Influence.js
- scripts/seed.js
- samples/csv/*.csv

## 結論サマリ
- CSVインポート本体（`/admin/import/csv` → `lib/csv-import.js`）に、既存データ全削除・replace系の危険処理は存在しない。
- ただし、`seed.js` は3コレクション全削除 (`deleteMany({})`) を行うため、本番で誤実行された場合は全データ消失リスクがある。
- インポートは基本 `create` のみで上書き更新をしないため「意図しない上書き」は起きにくい一方、整合性担保はアプリ層チェックに依存しており、DBユニーク制約不足（特に `Influence`）による重複混入余地がある。
