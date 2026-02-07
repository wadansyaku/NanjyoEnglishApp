import { useEffect, useMemo, useState } from 'react';
import { Link, usePath } from '../lib/router';
import {
  listDeckDueSummaries,
  getQuickReviewCount,
  getQuickReviewCards,
  reviewCard,
  type DeckDueSummary,
  type DueCard
} from '../db';

type QuickReviewState = 'idle' | 'reviewing' | 'complete';

export default function ReviewHomePage() {
  const { navigate } = usePath();
  const [summaries, setSummaries] = useState<DeckDueSummary[]>([]);
  const [quickCount, setQuickCount] = useState(0);

  // Quick Review状態
  const [quickState, setQuickState] = useState<QuickReviewState>('idle');
  const [quickCards, setQuickCards] = useState<DueCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const loadData = async () => {
    const rows = await listDeckDueSummaries();
    const qCount = await getQuickReviewCount();
    setSummaries(rows);
    setQuickCount(qCount);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const totalDue = useMemo(
    () => summaries.reduce((sum, item) => sum + item.dueCount, 0),
    [summaries]
  );

  const recommendedDeck = useMemo(
    () => summaries.find((item) => item.dueCount > 0) ?? summaries[0] ?? null,
    [summaries]
  );

  // 「今日の3分」開始
  const handleStartQuickReview = async () => {
    const cards = await getQuickReviewCards(5);
    if (cards.length === 0) {
      // カードがない場合は通常のReviewへ
      if (recommendedDeck) {
        navigate(`/review/${recommendedDeck.deckId}`);
      }
      return;
    }
    setQuickCards(cards);
    setCurrentIndex(0);
    setShowAnswer(false);
    setQuickState('reviewing');
  };

  // 回答を表示
  const handleShowAnswer = () => {
    setShowAnswer(true);
  };

  // 評価して次へ
  const handleGrade = async (grade: 'again' | 'hard' | 'good' | 'easy') => {
    const card = quickCards[currentIndex];
    await reviewCard(card.srs.deckId, card.srs.cardId, grade);

    if (currentIndex + 1 < quickCards.length) {
      setCurrentIndex(currentIndex + 1);
      setShowAnswer(false);
    } else {
      setQuickState('complete');
      await loadData(); // カウンター更新
    }
  };

  // Quick Review完了後
  const handleFinishQuickReview = () => {
    setQuickState('idle');
    setQuickCards([]);
    setCurrentIndex(0);
    setShowAnswer(false);
  };

  // Quick Review画面
  if (quickState === 'reviewing' && quickCards.length > 0) {
    const card = quickCards[currentIndex];
    return (
      <section className="section-grid">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2>⚡ 今日の3分</h2>
            <span className="badge">{currentIndex + 1} / {quickCards.length}</span>
          </div>

          <div className="review-card" style={{ textAlign: 'center', padding: 24 }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: 16 }}>
              {card.lexeme.headword}
            </p>

            {!showAnswer && (
              <button
                onClick={handleShowAnswer}
                style={{ width: '100%', marginTop: 16 }}
              >
                答えを見る
              </button>
            )}

            {showAnswer && (
              <>
                <p style={{
                  fontSize: '1.2rem',
                  color: 'var(--primary)',
                  marginBottom: 24,
                  padding: 16,
                  background: 'rgba(255, 126, 179, 0.1)',
                  borderRadius: 12
                }}>
                  {card.lexeme.meaningJa}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <button className="secondary" onClick={() => handleGrade('again')}>
                    🔄 もう一回
                  </button>
                  <button className="secondary" onClick={() => handleGrade('hard')}>
                    😓 難しい
                  </button>
                  <button onClick={() => handleGrade('good')}>
                    😊 できた
                  </button>
                  <button onClick={() => handleGrade('easy')}>
                    🌟 かんたん
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Quick Review完了画面
  if (quickState === 'complete') {
    return (
      <section className="section-grid">
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</p>
          <h2>今日もお疲れさま！</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            {quickCards.length}問クリアしたよ
          </p>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            少しずつでも続けてるあなたはえらい！
          </p>
          <button onClick={handleFinishQuickReview} style={{ marginTop: 24 }}>
            ホームに戻る
          </button>
        </div>
      </section>
    );
  }

  // 通常のホーム画面
  return (
    <section className="section-grid">
      {/* 今日の3分ボタン - 最も目立つ位置 */}
      <div className="card" style={{ background: 'linear-gradient(135deg, var(--primary-light), var(--secondary-light))' }}>
        <h2>⚡ 今日の3分</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
          苦手な単語を{Math.min(quickCount, 5)}問だけ復習
        </p>
        {quickCount > 0 ? (
          <button
            onClick={handleStartQuickReview}
            style={{ width: '100%', fontSize: '1.1rem' }}
          >
            さっそく始める！
          </button>
        ) : (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
            今日の復習はクリア済み ✨
          </p>
        )}
      </div>

      <div className="card">
        <h2>今日の復習</h2>
        <p className="badge">残り: {totalDue} 枚</p>
        {recommendedDeck && (
          <div className="scan-inline-actions">
            <Link className="pill" to={`/review/${recommendedDeck.deckId}`}>
              つづける: {recommendedDeck.title}
            </Link>
          </div>
        )}
        {!recommendedDeck && (
          <p>
            まだ単語帳がない！<Link className="pill" to="/scan">写真から作る</Link>
          </p>
        )}
      </div>

      <div className="card">
        <h2>単語帳</h2>
        {summaries.length === 0 && <p>まだ単語帳がありません。</p>}
        <div className="word-grid">
          {summaries.map((item) => (
            <div key={item.deckId} className="word-item">
              <div>
                <strong>{item.title}</strong>
                <small className="candidate-meta">
                  今日: {item.dueCount} / 全体: {item.totalCards}
                </small>
              </div>
              <Link className="pill" to={`/review/${item.deckId}`}>
                開く
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
