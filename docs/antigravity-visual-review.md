# Antigravity Visual Review Guide

## Purpose

このドキュメントは、Antigravityで本アプリの視覚レビューを進めるための手順と観点をまとめたものです。  
対象ユーザーは「中学生女子（スマホ中心）」です。

## App Snapshot (2026-02-07)

- Product name: AIYuMe English
- Header subtitle: 写真から単語を見つけて、自分だけの単語ノートで復習しよう。
- Main routes:
  - `/scan`: 写真読み取り、単語抽出、単語ノート作成
  - `/review`: 今日の復習ホーム
  - `/review/:deckId`: 復習カード回答
  - `/character`: がんばり記録
  - `/settings`: OCR設定
- Feedback UI: ヘッダーの `💬 アプリに意見` からモーダル表示
- Frontend stack: React + TypeScript + Vite
- Style source: `src/styles.css`

## Local Launch For Review

1. Install

```bash
npm install
```

2. Run app + worker in parallel

```bash
npm run dev
```

3. Access
- App: `http://localhost:5173`
- Worker API: `http://127.0.0.1:8787`

## Mobile Review Matrix

最低でも以下の3サイズで視覚チェックすること。

1. 390 x 844 (iPhone 13/14系)
2. 375 x 667 (iPhone SE系)
3. 412 x 915 (Pixel系)

## Critical User Flows To Review

1. `/scan`
- 写真選択
- OCR実行
- 「単語をひろう」
- 候補の意味入力
- 「ノートを作って復習する」

2. `/review/:deckId`
- 単語表示
- 「意味を見る」
- 4つの評価ボタンを押す

3. `/character`
- レベル・XP表示
- 学習ログ表示

4. `/settings`
- OCRデバッグON/OFF
- 既定PSM
- 前処理デフォルト

5. Feedback modal
- ヘッダーボタンで表示
- 背景タップ / `Esc` / `×` で閉じる
- カテゴリ選択、メッセージ入力、意見送信

## Visual Checklist

1. Readability
- 本文サイズが小さすぎない（目安: 14px以上）
- 見出しと本文の階層が判別できる

2. Tap usability
- 主要ボタンの高さが44px以上
- 誤タップを起こす隣接配置になっていない

3. Layout stability
- カードの横はみ出しがない
- 横スクロールが発生していない
- 長い文言で崩れない

4. Input UX
- テキスト入力時に要素が隠れない
- 文字数カウンタが機能している
- エラーメッセージが視認できる

5. Tone consistency
- 技術用語がユーザー向け表現になっている
- 「次に何を押すか」が1画面で分かる

## Functional States To Capture

各画面で以下の状態をスクリーンショット化して比較する。

1. Initial state
2. Loading state
3. Success state
4. Error state
5. Empty state

## Review Output Format (Recommended)

各指摘を次の形式で記録する。

```text
[P1|P2|P3] Route: /scan
Issue: 候補カードの意味入力欄が狭く、スマホで編集しにくい
Evidence: iPhone SE width 375 で入力欄が詰まり、視線移動が多い
Proposal: 候補カードを縦積み構成に固定し、入力欄の高さを拡張
```

## Notes

- 文言やトーンの基準は `docs/screen-spec.md` と `docs/ui-ux-adjustment-guide.md` を参照。
- 仕様変更時は、このファイルの「App Snapshot」日付を更新する。
