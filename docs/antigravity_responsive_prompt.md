# Antigravity Input Prompt (Web / Mobile / Tablet)

```text
あなたはシニアUI/UXエンジニアです。
対象プロジェクトは React + TypeScript + CSS の学習アプリ「AIYuMe English」です。
目的は、Web（Desktop）・スマホ（Mobile）・タブレット（Tablet）の全てで、表示崩れなく、迷わず学習できるUIに整えることです。

【前提】
- 大きなUIライブラリは追加しない（既存CSS中心）
- 既存機能（scan/review/character/settings/admin/auth）を壊さない
- 画像/OCR本文をサーバ保存しない方針を変えない

【必須タスク】
1) 画面検証幅
- 360, 390, 430, 768, 834, 1024, 1280 の各幅で主要画面を確認
- はみ出し、重なり、固定要素衝突、文字切れを検出して修正

2) 復習画面の最適化（最優先）
- フリップカードの高さ/文字/余白をデバイス別に最適化
- 評価ボタン（Again/Hard/Good/Easy）はモバイルで押しやすく、Desktopで不自然な固定表示にしない
- 発音ボタンと評価ボタンの距離を確保し誤タップを防ぐ

3) ナビゲーションと余白
- 下部ナビと本文が重ならないように Safe Area を考慮
- Desktopでは読みやすい最大幅と余白を確保
- Tabletでは1〜2カラムをコンテンツに応じて切替

4) 一貫性
- ボタン高さ44px以上
- 入力欄/カード/ラベルの余白ルールを統一
- エラー文・注意文の可読性を確保

【受け入れ条件】
- Desktop/Mobile/Tablet の3カテゴリで主要フローに崩れなし
- lint/typecheck/build が通る
- 変更理由が短く説明できる状態であること

【出力】
- 変更ファイル一覧
- デバイス別の改善点（Desktop/Mobile/Tablet）
- 残課題（あれば）
```
