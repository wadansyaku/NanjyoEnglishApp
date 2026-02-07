# UI/UX + OCR Polish Notes

## PR Summary (for description)

- AppShellを導入し、ヘッダー（Lv/XP、設定、フィードバック）と下部固定ナビ（Scan/Review/Character）を追加。
- `/review` ホームを追加し、今日の残りカードとデッキ別の復習導線を整理。
- `/scan` を5ステップのウィザードに再構成。
  - 画像選択
  - 矩形クロップ
  - OCR実行（前処理、PSM切替、キャンセル）
  - 未知語候補の選択（Select all/Clear/ソート）
  - 単語ノート作成
- OCR改善（エンジン変更なし）:
  - Canvas前処理（grayscale, contrast/brightness, threshold, invert, maxSide）
  - PSM切替（6/11/7）
  - worker再利用 + cancel対応
  - 前処理時間/OCR時間/confidence の取得
- `/settings` を追加し、OCRデバッグ表示と既定前処理をローカル保存。
- OCRデバッグON時、`/scan` に前処理前後画像と処理メトリクスを表示。
- 未知語抽出を改善:
  - ゴミトークン除外（記号過多/数字過多/短すぎ）
  - 低品質候補に「要確認」を付与
  - found候補のmeaning自動補完
- フィードバックの `contextJson` を拡張（画面名、端末要約、最新OCR処理時間）しつつ、OCR全文は送らない。
- Reviewを改善:
  - 回答ボタンを下部固定
  - 残りカード表示
  - 回答時トースト表示
- READMEにScanフロー/OCR改善/デバッグモード/送信制約を追記。

## Phase A Findings (before fix)

- モバイル導線:
  - 上部導線のみで、`Scan -> Review -> Character` の往復が分かりづらい
  - Reviewの入口がデッキID依存で、今日の着手点が見えにくい
- Scan体験:
  - OCR前処理がなく、撮影条件が悪いと誤認識が増える
  - クロップ手段がなく、不要領域を巻き込みやすい
  - PSM切替やキャンセルがなく、失敗時のリカバリが弱い
- OCR実装:
  - Worker再利用はあるが、認識設定が固定で環境差に弱い
  - 処理時間/品質の可視化がなく、改善ループが回しづらい
- 候補抽出:
  - ノイズ語・低品質語の区別が弱く、手動確認コストが高い

## Verification

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm run build` ✅

## Future TODO

- クロップの台形補正（四隅操作）を追加
- OCR前処理の自動最適化（簡易スコアでパラメータ試行）
- ReviewアルゴリズムのFSRS化検討
- 共有語彙コード（front/worker）を整理して重複を削減
- PWAオフライン時のUIガイド（同期不可表示、再送キュー）強化
