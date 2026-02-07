# Screen Spec (Mobile First)

## Target Persona

- 中学生女子
- スマホ利用が中心
- 学習アプリに慣れていないユーザーも含む

## Copy Principles

1. 1文を短くする
2. 専門語を避ける
3. 「次の行動」をボタン文言で明示する
4. 否定より、次の行動を案内する

## Route: `/scan`

### Goal

写真から単語を見つけ、意味を入れて「単語ノート」を作る。

### Block 1: 写真を読み取る

- Title: `1. 写真を読み取る`
- Main action:
  - file input: `写真をえらぶ（カメラ/ファイル）`
  - button: `単語をひろう`
- Status labels:
  - `まだ写真を読み取っていません`
  - `読み取り中です`
  - `読み取りできました`
  - `読み取りに失敗しました`
- Privacy message:
  - `写真と読み取り結果は、この端末の中だけで処理されます。`

### Block 2: 単語と意味をえらぶ

- Title: `2. 単語と意味をえらぶ`
- State text:
  - `意味検索: まだ検索していません`
  - `意味検索: 意味を検索中です`
  - `意味検索: 検索が終わりました`
  - `意味検索: 検索に失敗しました`
- Per candidate:
  - checkbox label: `追加する`
  - meta: `出現 n回`
  - meaning placeholder:
    - found: `辞書の意味（必要なら直せる）`
    - missing: `意味を入力`
  - mastered default:
    - `学習済みを○語かくす`（初期ON）
    - toggleで再表示可能

### Block 3: 単語ノートを作る

- Title: `3. 単語ノートを作る`
- Input label: `ノート名`
- Button: `ノートを作って復習する`
- Success message: `単語ノートを作りました。復習ページへ移動します。`

### Block 4: 作ったノート

- Title: `作ったノート`
- Empty text: `まだノートがありません。`
- Row button: `復習する`

## Route: `/review/:deckId`

### Goal

単語の意味を思い出し、4段階で回答して復習を進める。

### Main copy

- Screen title: `復習ノート: {deckTitle}`
- Missing deck: `ノートが見つかりません`
- No due card: `いま復習するカードはありません。おつかれさま。`
- Hint:
  - `先に意味を思い出してから「意味を見る」を押そう。`

### Actions

- reveal button: `意味を見る`
- grade buttons:
  - `もう1回` (+0XP)
  - `むずかしい` (+1XP)
  - `できた` (+2XP)
  - `かんたん` (+3XP)

## Route: `/review`

### Goal

今日の復習量を確認し、どのノートから始めるか迷わない状態にする。

### Main copy

- Screen title: `今日のReview`
- Total due label: `残りカード`
- Deck rows: `今日: x / 全体: y`
- Additional section:
  - title: `学校単語帳`
  - action: `学習を始める`
  - behavior: サーバデッキをローカルSRSへ取り込み → `/review/:deckId`

## Route: `/character`

### Goal

今の学習進捗と、どれだけ取り組んだかを把握する。
加えて、`今日の冒険` から校正タスクを進め、報酬デッキを解放できる。

### Main copy

- Section title: `マイキャラ`
- Badge prefix: `称号:`
- Metrics:
  - `レベル`
  - `トータルXP`
  - `今日のXP`
  - `今日あともらえるXP`

### Level title mapping

- level >= 15: `ことばクイーン`
- level >= 10: `ぐんぐんチャレンジャー`
- level >= 5: `ことばトレーナー`
- else: `はじめの一歩`

### Event label mapping

- `scan_started` -> `写真読み取りを開始`
- `ocr_done` -> `読み取り完了`
- `deck_created` -> `単語ノートを作成`
- `review_done` -> `復習カードに回答`

### 冒険セクション

- title: `今日の冒険`
- summary: `進捗 x/y ・ 残りトークン n`
- task action: `進める`
- clear feedback:
  - `タスクを完了しました`
  - `報酬デッキが解放されました`

## Global Header

- App title: `えいたんメイト`
- Subtitle:
  - `写真から単語を見つけて、自分だけの単語ノートで復習しよう。`
- Nav labels:
  - `/scan` -> `写真で単語`
  - `/review` -> `Review`
  - `/character` -> `がんばり記録`
  - feedback -> `アプリに意見`
  - settings -> `設定`

## Feedback Form

- Display: ヘッダーの `アプリに意見` ボタンでモーダル表示
- Title: `アプリへの意見`
- Category label: `どの内容？`
- Message label: `メッセージ（200文字まで）`
- Submit button: `意見を送る`
- Counter: `{現在文字数}/200`
- Safety message:
  - `名前・連絡先・本文の全文は書かないで、短く教えてください。`
- Close interaction:
  - 背景タップ
  - `Esc` キー
  - `×` ボタン

## Route: `/settings`

### Goal

OCRのデバッグ可視化や既定値をユーザー側で調整できる状態にする。

### Main controls

- OCRデバッグトグル
- 既定PSM（6/11/7）
- 前処理既定値（grayscale/threshold/invert/contrast/brightness/maxSide）

## Accessibility Baseline

1. 主要ボタン高さ: 44px以上
2. フォント最小サイズ: 12px未満を避ける
3. モバイル時レイアウト: 1カラム
4. 色だけに依存しない状態表示（テキスト併用）

## Update Rule

文言またはUIを変更したら、以下を同時更新すること。

1. この `docs/screen-spec.md`
2. `docs/antigravity-visual-review.md` の App Snapshot
3. 必要に応じて `src/styles.css` の調整方針
