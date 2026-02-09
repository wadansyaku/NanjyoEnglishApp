# Nanjyo English App

教科書本文の一部を撮影 → OCR → 未知語抽出 → ミニ単語帳 → SRS を1セッションで回すPWAです。

## 重要ポリシー（必読）

- デフォルトは **local-only**（端末内OCR）です。
- クラウドOCR / AI意味提案は **Settingsで明示的にON + 同意** した時だけ動きます。
- 画像はサーバに保存しません（D1/R2/KV/Feedback/ログに保存しない）。
- OCR全文/本文全文は保存しません。
- クラウドOCRのAPIレスポンスは **全文ではなく単語中心**（`words/headwords`）です。
- クラウドへ送る辞書データは `headword` と短い `meaning/example/note` のみです。
- `meaning/example/note` は短文制約（改行禁止・文字数制限）を維持します。
- SRS回答ログは端末内（IndexedDB）にのみ保存します。

## 開発手順

### 1) 依存関係

```bash
npm install
```

### 2) D1作成・マイグレーション

```bash
npx wrangler d1 create nanjyo_lexicon
```

作成後に表示された `database_id` を `wrangler.toml` の `[[d1_databases]]` に設定してください。

```bash
npx wrangler d1 migrations apply nanjyo_lexicon --local
```

### 3) Core Wordbank投入（アプリ内単語データベース）

`core_words / core_decks / core_deck_words` に公式CSVを投入します。

```bash
npm run wordbank:seed
```

- デフォルトCSV: `docs/wordbank_pos_audit/20260208_225334/ORIGINAL_WORDBANK_JHS_HS_FINAL_CONFIRMED.csv`
- 反映先: ローカルD1（`.wrangler/state/v3/d1`）
- 生成デッキ: 速習6 / 標準6 / 全範囲1
- `headword_norm` 衝突は正規化規則で自動解決（`--out-dir` 指定時に `headword_norm_collisions.csv` を出力）

リモートD1へ反映する場合:

```bash
npm run wordbank:seed:remote
```

カスタムCSVを使う場合:

```bash
node scripts/seed-core-wordbank.mjs --csv /absolute/path/to/wordbank.csv
```

### 4) 起動

```bash
npm run dev
```

- フロント: `http://localhost:5173`
- API (Worker): `http://127.0.0.1:8787`

### 5) チェック

```bash
npm run lint
npm run typecheck
npm run build
```

### 6) デプロイ

```bash
npm run deploy
```

## クラウドOCR / AI意味提案のセットアップ

### `wrangler.toml` の公開変数（非シークレット）

```toml
[vars]
AI_PROVIDER = "openai" # or "workers_ai"
CLOUD_OCR_DAILY_LIMIT = "20"
AI_MEANING_DAILY_LIMIT = "20"
```

### Secret（本番キー）

OpenAI経由（推奨）:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Cloud Vision:

```bash
npx wrangler secret put GOOGLE_VISION_API_KEY
```

管理者機能（生徒監視・テスト作成）:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Workers AIを使う場合:

```bash
npx wrangler secret put WORKERS_AI_API_TOKEN
```

必要に応じて設定:

- `GOOGLE_VISION_API_ENDPOINT`（通常は不要）
- `OPENAI_MODEL`（既定: `gpt-4o-mini`）
- `CF_AIG_ACCOUNT_ID` / `CF_AIG_GATEWAY_ID` / `CF_AIG_BASE_URL`（AI Gateway経由用）
- `WORKERS_AI_ACCOUNT_ID`
- `WORKERS_AI_MODEL`

## アーキテクチャ

- Cloudflare Workers + D1 + 静的アセット（Vite build）
- フロント: React + TypeScript + Vite
- ローカルDB: IndexedDB（Dexie）
- OCR:
  - ローカル: Tesseract（WebWorker）
  - 任意: Cloud Vision（Settingsで有効化時のみ）

## 画面導線（モバイル）

- AppShell:
  - ヘッダー: アプリ名 / レベルXP / 設定 / フィードバック
  - 下部固定ナビ: `Scan` / `Review` / `Character`
- ルート:
  - `/scan` OCR〜単語ノート作成のウィザード
  - `/review` 今日の復習ホーム
  - `/review/:deckId` デッキごとの復習
  - `/test/:deckId` ノート単位のオンラインテスト（4択/入力/ミックス）
  - `/character` 進捗表示
  - `/settings` OCR・クラウド機能設定
  - `/admin` 管理者向け（生徒進捗監視 / テスト作成 / 印刷）

## Scanフロー（5ステップ）

1. 画像選択（カメラ/ファイル）
2. 本文領域を矩形クロップ
3. OCR実行（ローカル/クラウド選択、PSM、前処理）
4. 未知語候補選択（Select all / Clear / ソート）
5. 単語ノート作成 → Review開始

追加仕様:

- 既存SRSで `Mastered` 判定された語（`interval>=21 && ease>=2.3 && reps>=6`）は候補からデフォルト非表示
- 「学習済みを表示」トグルで再表示可能
- 画像/OCR本文はサーバへ送信しない（送信するのは `headword` のみ）

## Core Wordbank / Community / 冒険

- Core Wordbank:
  - `core_words` / `core_decks` / `core_deck_words` で配信単語帳を管理
  - `/review` では「速習 / 標準」のステップ式カリキュラムを優先表示（`全範囲` は折りたたみ）
  - 中1〜中3を1ステップに束ねず、`中1 → 中2要点+中3導入 → 中3` の段階で進める
  - 中2語彙が少ない問題に対して、中3導入語を橋渡しとして追加し学習量を平準化
  - 5/10/20語区切りで段階的に取り込み可能（次回開始位置を保持）
- Community (Word Repo):
  - Changesetベースの提案→校正→マージ
  - 確定語彙は `ugc_lexeme_canonical`
  - lookup優先順は `community -> core -> legacy`
- 冒険（ダンジョン）:
  - `/character` から「今日の冒険」を実行
  - 校正タスク完了で報酬デッキを解放して学習できる
  - 校正トークンは `minutesToday` から日次計算

### OCR改善（エンジン変更なし）

- 前処理（Canvas）
  - grayscale
  - contrast / brightness
  - threshold（二値化）
  - invert（白黒反転）
  - 最大辺上限でメモリ保護
- Tesseract最適化
  - PSM切替（6 / 11 / 7）
  - worker再利用
  - OCRキャンセル
- クラウドOCR連携（任意）
  - クライアントで画像圧縮（長辺1600、JPEG 0.8、2MB上限）
  - APIレスポンスは単語中心（全文返却なし）
- 未知語補助
  - 辞書既知語の自動補完
  - missing語へのAI意味提案（短文のみ）

## OCRデバッグモード

`/settings` の `OCRデバッグ` をONにすると `/scan` で以下を表示します。

- 前処理前画像
- 前処理後画像
- 前処理時間 / OCR時間 / confidence / PSM / モード

これらは端末内表示のみで、サーバ送信しません。

## 認証

- 初回 `POST /api/v1/bootstrap` で `userId` / `apiKey` 発行
- 以後 `/api/v1/*` は `Authorization: Bearer <apiKey>`
- サーバ側は `apiKey` のSHA-256ハッシュのみ保持

## API

### 1) `POST /api/v1/lexemes/lookup`

- 入力: `{ headwords: string[] }`
- 出力: `{ found: [...], missing: [...] }`
- 内部優先順:
  1. `ugc_lexeme_canonical`
  2. `core_words`
  3. `lexemes` (legacy)

### 2) `POST /api/v1/lexemes/commit`

- 入力: `{ entries: [{ headword, meaningJa, exampleEn?, note? }] }`
- 出力: `{ ok: true, inserted: number }`

制約:

- `meaningJa` 80文字以内
- `exampleEn` / `note` 160文字以内
- 改行は拒否

### 3) `POST /api/v1/ocr/cloud`

- 入力:

```json
{
  "imageBase64": "...",
  "mime": "image/jpeg",
  "mode": "document"
}
```

- 出力（全文ではなく単語中心）:

```json
{
  "words": [{ "text": "example", "confidence": 0.93, "bbox": { "x": 0, "y": 0, "w": 10, "h": 10 } }],
  "headwords": ["example", "word"]
}
```

### 4) `POST /api/v1/ai/meaning-suggest`

- 入力: `{ "headwords": ["example", "word"] }`
- 出力: `{ "suggestions": [{ "headword": "example", "meaningJa": "例" }] }`

制約:

- `meaningJa` は80文字以内・改行禁止
- 長文生成/本文翻訳は行わない

### 5) `POST /api/v1/feedback`

- 入力: `{ type, message, contextJson? }`
- `contextJson` は短く（2000文字以内）、本文/OCR全文は禁止

### 6) `GET /api/v1/wordbank/decks`

- 出力: `deck` 一覧（タイトル、語数、source）

### 7) `GET /api/v1/wordbank/curriculum`

- 出力: 速習/標準トラックとステップ情報（学習順・語数・推奨区切り）

### 8) `GET /api/v1/wordbank/decks/:deckId/words`

- 出力: 指定デッキの語彙一覧（`headword_norm`, `meaning_ja_short`）

### 9) `POST /api/v1/wordbank/decks/words-batch`

- 入力: `{ deckIds: string[] }`
- 出力: 複数デッキを順序維持で結合し、重複除去した語彙一覧
- 備考: カリキュラム内部では `slice:<deckId>:<start>:<end>` 形式で範囲分割デッキを扱える

### 10) `POST /api/v1/wordbank/admin/upsert-words` (Admin)

- ヘッダ: `x-admin-token` または `Authorization: Bearer <ADMIN_TOKEN>`
- 入力: words/decks のupsert

### 11) `GET /api/v1/admin/students` (Admin)

- 生徒ごとの進捗サマリ（Lv/XP/履修語数/最終同期）を返す

### 12) `GET /api/v1/admin/students/:userId/words` (Admin)

- 指定生徒の履修語（テスト作成元）を返す

### 13) `POST /api/v1/community/changesets`

- 提案（changeset）を作成

### 14) `POST /api/v1/community/changesets/:id/items`

- 提案に単語差分を追加

### 15) `POST /api/v1/community/changesets/:id/submit`

- `draft -> proposed`

### 16) `POST /api/v1/community/changesets/:id/review`

- `approve / request_changes / comment`

### 17) `POST /api/v1/community/changesets/:id/merge`

- editor以上が実行
- canonical更新 + history追記

### 18) `GET /api/v1/community/tasks`

- 今日の冒険タスクと利用可能トークンを取得

### 19) `POST /api/v1/community/tasks/:taskId/complete`

- タスク完了処理。条件達成で報酬デッキ（headword集合）を返却

### 20) `POST /api/v1/usage/report`

- 入力: `{ minutesToday }`
- サーバで `proofread_tokens_today` を再計算

## 日次上限（コスト/乱用対策）

D1 `usage_daily` で `userId + 日付` ごとにカウントします。

- `cloud_ocr_calls_today`
- `ai_meaning_calls_today`
- `minutes_today`
- `proofread_tokens_today`
- `proofread_used_today`

上限超過時は `429` を返します。上限値は env var で調整できます。

## UI/UX ドキュメント

- `docs/antigravity-visual-review.md`
- `docs/screen-spec.md`
- `docs/ui-ux-adjustment-guide.md`
- `docs/uiux_ocr_notes.md`

## テスト機能（オンライン + 紙配布）

- 生徒向け: `/test/:deckId` で 5/10/20問のオンラインテスト
- 管理者向け: `/admin` で生徒の履修語からテスト作成
- 紙配布: 「印刷シート（PDF）」ボタンで印刷画面を開き、ブラウザの「PDFとして保存」で配布可能
- 生徒データを管理画面で見るには、`/settings` の「☁️ 学習データを同期」を実行してクラウドへ送信
