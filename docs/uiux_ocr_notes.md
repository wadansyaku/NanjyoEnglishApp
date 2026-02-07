# UI/UX + OCR Notes

## PR Summary (for description)

- Settingsに任意機能を追加（デフォルトOFF）
  - クラウドOCRトグル
  - AI意味提案トグル
  - 初回ON時の同意モーダル（2チェック必須）
- `/scan` にOCRモード選択を追加
  - ローカルOCR（既定）
  - クラウドOCR（Settingsで有効化済みの時のみ）
- クラウドOCR実行時のクライアント前処理
  - クロップ後画像を長辺1600px / JPEG 0.8 / 2MB上限で圧縮
  - サーバには圧縮画像のみ送信
- Worker APIを追加
  - `POST /api/v1/ocr/cloud`
    - Google Cloud Vision連携
    - 画像保存なし
    - 返却は全文ではなく `words/headwords` 中心
  - `POST /api/v1/ai/meaning-suggest`
    - missing語に短い日本語意味を提案
    - 80文字以内 / 改行禁止をサーバ側でサニタイズ
- Scanフロー統合
  - OCR→候補抽出→lookup→missing の既存流れにAI提案を差し込み
  - AI提案は入力欄に「提案」として入るだけで、ユーザー編集・確認後にcommit
- コスト/乱用対策
  - D1 `usage_daily` を追加
  - `cloud_ocr_calls_today` / `ai_meaning_calls_today`
  - 日次上限超過時は429
- README更新
  - 任意クラウド機能の説明
  - 保存しない制約の維持
  - env/secrets設定手順
  - 新APIの仕様追記

## Safety / Privacy Notes

- デフォルトはlocal-only。
- クラウド機能はユーザー同意後のみ利用可能。
- 画像・OCR全文・本文全文はサーバ保存しない。
- フィードバック送信には本文/OCR全文を含めない。

## Future TODO

- クロップ台形補正（四隅編集）
- OCR後トークンの辞書補正（Levenshtein候補など）
- AI提案の品質評価（誤訳フィードバックループ）
- OCR/AIプロバイダ差替えの抽象化レイヤー
- FSRS移行の検証
