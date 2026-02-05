# Nanjyo English App

教科書本文の一部を撮影 → 端末内OCR → 未知語抽出 → ミニ単語帳 → SRS → リスニング → 英作 → スピーキングまでを1セッションで回すローカルファーストPWAです。

## 制約（本文はクラウド保存しない）

- 画像・OCR全文・長文本文はサーバへ送信/保存しません（端末内のみ）。
- クラウドへ送るのは **headword（見出し語）と短い meaning / example / note** のみです。
- meaning/example/note は **改行禁止・短文のみ**。APIで長文や改行は拒否します。
- SRSの回答ログは **端末内（IndexedDB）** にのみ保存します。
- PWAは local-first。オフラインでもSRSが動作します。

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

## TODO

- OCRの精度チューニング（辞書/補正）
- 音声UIの改善（TTS速度や音声選択）
- PWAアイコン最適化
- 同期のバッチ/日次スケジューリング
- 認証や共有範囲の設計
