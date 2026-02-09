# UI/UX + OCR Notes

## PR Summary (for description)

1. プライバシー制約を維持したままOCR体験を改善
   - Scanを5ステップ化（撮影→クロップ→OCR→候補→作成）
   - ローカルOCR前処理（grayscale/contrast/threshold/invert/PSM切替）
   - クラウドOCRはSettingsで明示ON+同意時のみ（デフォルトOFF）
2. 未知語抽出のUX強化
   - lookup連携後に missing へAI意味提案（短文のみ）
   - 「カット」候補を別枠管理し、追加対象を明確化
   - 学習済み語（Mastered）を候補からデフォルト非表示
3. 学習導線の拡張
   - `/review` から Core Wordbank デッキを取り込み可能
   - `/character` に「今日のお庭」導線を追加
   - お世話タスク完了で収穫ノートをローカルSRSに解放
4. バックエンド基盤の拡張
   - `core_*` / `ugc_*` / `game_*` / `user_roles` / `user_profiles` を追加
   - `lexemes/lookup` の優先順を `community -> core -> legacy` へ統合
   - usage日次上限+お世話回数（minutesToday連動）を実装
5. 本番向け調整
   - auth/syncスキーマとWorker実装の不一致を解消
   - emailユニーク制約とmagic-link token schemaを統一
   - lint/typecheck/build通過を維持

## Safety / Privacy Notes

- デフォルトはlocal-only。
- クラウド機能はユーザー同意後のみ利用可能。
- 画像・OCR全文・本文全文はサーバ保存しない。
- フィードバック送信には本文/OCR全文を含めない。
- Community機能でも本文やOCR全文を扱わず、`headword_norm` と短文フィールドのみ扱う。

## Future TODO

- クロップ台形補正（四隅編集）
- OCR後トークンの辞書補正（候補ランクと誤認識救済）
- AI提案品質の自動評価（reject理由を学習に反映）
- Community画面の本格UI（提案一覧・差分比較・レビュー履歴）
- 校正タスクの個人割当モデル（複数ユーザー同時利用時の競合解消）
- FSRS移行の検証
