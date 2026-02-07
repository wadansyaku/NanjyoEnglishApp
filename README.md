# Nanjyo English App

教科書本文の一部を撮影 → 端末内OCR → 未知語抽出 → ミニ単語帳 → SRS → リスニング → 英作 → スピーキングまでを1セッションで回すローカルファーストPWAです。

## 制約（本文はクラウド保存しない）

- 画像・OCR全文・長文本文はサーバへ送信/保存しません（端末内のみ）。
- クラウドへ送るのは **headword（見出し語）と短い meaning / example / note** のみです。
- meaning/example/note は **改行禁止・短文のみ**。APIで長文や改行は拒否します。
- SRSの回答ログは **端末内（IndexedDB）** にのみ保存します。
- PWAは local-first。オフラインでもSRSが動作します。
- （再掲）本文画像やOCR全文はクラウドに送信しません。

## 開発手順

### 1) 依存関係のインストール

```bash
pnpm install
```

### 2) D1 ローカル適用（初回のみ）

```bash
pnpm wrangler d1 create nanjyo_lexicon
```

作成された `database_id` を `wrangler.toml` に設定してください。

```bash
pnpm wrangler d1 migrations apply nanjyo_lexicon --local
```

ローカルでD1を使う場合は、`pnpm dev` で `wrangler dev --local` が起動します。

### 3) 開発サーバー

```bash
pnpm dev
```

- フロント: `http://localhost:5173`
- API (Worker): `http://127.0.0.1:8787`

### 4) Lint / Typecheck / Build

```bash
pnpm lint
pnpm typecheck
pnpm build
```

### 5) Deploy

```bash
pnpm deploy
```

## アーキテクチャ

- Cloudflare Workers + D1 + 静的アセット（Vite build）で1オリジン構成
- フロント: React + TypeScript + Vite
- ローカルDB: IndexedDB（Dexie）
- OCR: ブラウザ内（WebWorker）で英語OCR

## 画面導線（モバイル）

- AppShell:
  - ヘッダー: アプリ名 / レベルXP / 設定 / フィードバック
  - 下部固定ナビ: `Scan` / `Review` / `Character`
- ルート:
  - `/scan` OCR〜単語ノート作成のウィザード
  - `/review` 今日の復習ホーム
  - `/review/:deckId` デッキごとの復習
  - `/character` 進捗表示
  - `/settings` OCR設定（デバッグ・前処理・PSM）

## Scanフロー（5ステップ）

1. 画像選択（カメラ/ファイル）
2. 本文領域を矩形クロップ
3. OCR実行（前処理 + PSM選択 + キャンセル可）
4. 未知語候補を選択（Select all / Clear / ソート）
5. 単語ノート作成 → Review開始

## OCR改善点（エンジン変更なし）

- 前処理（Canvas）
  - grayscale
  - contrast / brightness
  - threshold（二値化）
  - invert（白黒反転）
  - 最大辺上限でメモリ保護
- Tesseract最適化
  - PSM切替（6 / 11 / 7）
  - worker再利用（毎回newしない）
  - OCRキャンセル（terminate→再初期化）
- 抽出精度の体感改善
  - ゴミトークン除外（短すぎ・記号過多・数字過多）
  - 低品質候補に「要確認」表示
  - 辞書既知語は meaning 自動補完（found）

## OCRデバッグモード

- `/settings` の `OCRデバッグ` をONにすると `/scan` で表示:
  - 前処理前画像
  - 前処理後画像
  - 前処理時間 / OCR時間 / confidence / PSM
- これらは端末内表示のみで、サーバ送信しません。

## 認証（疑似アカウント）

- 初回に `POST /api/v1/bootstrap` を呼び出し、`userId` と `apiKey` を受け取ります。
- 以後の辞書API（`/api/v1/lexemes/*`）は `Authorization: Bearer <apiKey>` を付与して呼び出します。
- `apiKey` は端末内に保存し、サーバ側には SHA-256 ハッシュのみ保存します。

## API 例（辞書）

### Lookup

リクエスト:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/lexemes/lookup \\
  -H "Authorization: Bearer <apiKey>" \\
  -H "Content-Type: application/json" \\
  -d '{ "headwords": ["take", "run", "don\\u0027t"] }'
```

レスポンス:

```json
{
  "found": [
    {
      "lexemeId": 1,
      "headword": "take",
      "headwordNorm": "take",
      "entries": [
        {
          "meaning_ja": "取る",
          "example_en": "I take a seat.",
          "note": "基礎用法"
        }
      ]
    }
  ],
  "missing": ["run", "don't"]
}
```

### Commit

リクエスト:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/lexemes/commit \\
  -H "Authorization: Bearer <apiKey>" \\
  -H "Content-Type: application/json" \\
  -d '{ "entries": [ { "headword": "run", "meaningJa": "走る", "exampleEn": "I run fast." } ] }'
```

レスポンス:

```json
{
  "ok": true,
  "inserted": 1
}
```

制約:

- `meaningJa` は 80 文字以内、`exampleEn` と `note` は 160 文字以内
- 改行を含む入力は 400 で拒否

## 送信制約（再掲）

- 画像・本文画像・OCR全文・長文本文はサーバ送信しない。
- `/api/v1/lexemes/lookup` には headword 配列のみ送信。
- `/api/v1/lexemes/commit` には short meaning（必要なら short example/note）のみ送信。
- Review回答ログは IndexedDB 内のみで管理し、クラウド保存しない。

## API 例（フィードバック）

```bash
curl -X POST http://127.0.0.1:8787/api/v1/feedback \\
  -H "Authorization: Bearer <apiKey>" \\
  -H "Content-Type: application/json" \\
  -d '{ "type": "ocr", "message": "OCRの改行が崩れる", "contextJson": { "screen": "/scan" } }'
```

制約:

- `message` は短文のみ（200文字以内、改行禁止）
- `contextJson` は短く（2000文字以内）、本文やOCR全文は禁止

## TODO

- OCRの精度チューニング（辞書/補正）
- 音声UIの改善（TTS速度や音声選択）
- PWAアイコン最適化
- 同期のバッチ/日次スケジューリング
- 認証や共有範囲の設計

## UI/UX ドキュメント

- Antigravity視覚レビュー手順: `docs/antigravity-visual-review.md`
- 画面仕様（文言・状態・導線）: `docs/screen-spec.md`
- UI調整ガイド: `docs/ui-ux-adjustment-guide.md`
- PRサマリ・TODOメモ: `docs/uiux_ocr_notes.md`
