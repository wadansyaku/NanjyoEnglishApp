# UI/UX Adjustment Guide

## Design Direction

- Theme: 明るく、やさしく、学習の心理的ハードルを下げる
- Audience: 中学生女子（スマホ優先）
- Voice: フレンドリーだが幼すぎない

## Tone Rules

1. 技術語を避ける
- NG: `OCR状態: running`
- OK: `読み取り中です`

2. 命令より案内
- NG: `入力必須`
- OK: `意味を入れてください`

3. 英語ラベルを避ける
- NG: `Again`
- OK: `もう1回`

4. 否定だけで終わらせない
- NG: `候補がありません`
- OK: `まだ候補がありません。上で「単語をひろう」を押してね。`

## Mobile Layout Rules

1. 単一カラムを基本
2. 主要ボタンは幅100%、高さ44px以上
3. カード間の余白は狭すぎない（10px以上）
4. フォーム入力は上下に十分な間隔を持たせる

## Component Rules

### Header

- 一言で価値が伝わるタイトル + サブタイトル
- タブは短い日本語

### Card

- タイトルは 1.05rem 前後
- 1カード1目的を徹底

### Candidate Item (`/scan`)

- 選択操作（checkbox）と意味入力を近くに配置
- 出現回数を補助情報として明示
- 意味未入力の警告は短文で表示

### Grade Buttons (`/review`)

- 4段階評価を2列で表示
- ラベル + XPを縦積み表示して誤読を防止

## Color & Typography Baseline

- Base font:
  - `'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif`
- Base text color:
  - `#3a2c33`
- Primary button gradient:
  - `#f49d70 -> #f27f79`
- Card background:
  - high-contrast white near `#ffffff`

## Antigravity Review Workflow

1. `docs/antigravity-visual-review.md` のフローでスクリーンショット取得
2. 指摘をP1/P2/P3に分類
3. `src/styles.css` と該当ページを修正
4. `npm run build` と `npm run typecheck` 実行
5. `docs/screen-spec.md` に差分反映

## Definition of Done (UI/UX)

1. スマホ幅（375px）で横スクロールが出ない
2. 主要フロー（scan -> review -> character）が迷わず完了できる
3. 文言が対象ユーザーに対して自然である
4. Build と typecheck が通る

## Non-goals

- 完全なデザインシステム化
- PC専用の高度な表現最適化
- 本プロジェクト外への汎用化
