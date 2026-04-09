# CSV一括登録フォーマット

管理画面 `/admin/import/csv` で `Person / Book / Influence` をCSV投入できます。

## 共通
- 1行目はヘッダー。
- 2行目以降がデータ。
- 先に dry-run を実行し、`成功件数 / 失敗件数 / エラー理由` を確認してから本登録します。

## Person CSV
必須に近い項目（テンプレ準拠）:
- `displayNameJa`
- `occupationJa` または `occupation`
- `intro`
- `summary` または `bio`
- `career`
- `imageUrl`
- `category`
- `country`（`countryJa` / `countryEn` / `countryCode` のいずれか）

重複判定:
- `slug` 基準

対応列:
- `slug`
- `name`
- `displayNameJa`
- `occupation`
- `occupationJa`
- `occupationEn`
- `category`
- `countryCode`
- `countryJa`
- `countryEn`
- `popularity`
- `tags`（カンマ区切り）
- `keywords`（カンマ区切り）
- `intro`
- `summary`
- `career`
- `bio`
- `imageUrl`
- `featured`（`true/false`, `1/0`, `on/off`）
- `coreMessage`

## Book CSV
重複判定:
- `slug` または `isbn` 基準

対応列:
- `title`
- `slug`
- `author`
- `description`
- `coverUrl`
- `amazonUrl`
- `rakutenUrl`
- `googleBooksId`
- `isbn`
- `isbn10`
- `isbn13`

## Influence CSV
`personId` / `bookId` は使わず、`personSlug` / `bookSlug` で指定します。

重複判定:
- `person + book + kind` 組み合わせ

`kind`:
- `influence`
- `about`
- `authored`

対応列:
- `personSlug`
- `bookSlug`
- `kind`
- `impactSummary`
- `sourceTitle`
- `sourceUrl`
- `sourceType`
- `featuredOrder`

## Bill Gates 追加手順（サンプル）
1. `samples/csv/people.sample.csv` を `Person` で dry-run。
2. 問題なければ apply 実行。
3. `samples/csv/books.sample.csv` を `Book` で dry-run → apply。
4. 既存に `business-adventures` がある前提で `samples/csv/influences.sample.csv` を `Influence` で dry-run → apply。
5. `/admin/people` から `bill-gates` を開き、ジェフ・ベゾス基準で本文を追記。
