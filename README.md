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
