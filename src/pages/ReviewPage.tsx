import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { getDeck, getDueCard, incrementEvent, reviewCard, type DueCard } from '../db';

const gradeLabels = [
  { key: 'again', label: 'もう1回', xp: 0, emoji: '🔄' },
  { key: 'hard', label: 'むずかしい', xp: 1, emoji: '😓' },
  { key: 'good', label: 'できた', xp: 2, emoji: '😊' },
  { key: 'easy', label: 'かんたん', xp: 3, emoji: '🌟' }
] as const;

type ReviewPageProps = {
  deckId: string;
};

export default function ReviewPage({ deckId }: ReviewPageProps) {
  const [deckTitle, setDeckTitle] = useState('');
  const [dueCard, setDueCard] = useState<DueCard | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState('');

  const deckIdValue = deckId ?? '';

  const load = useCallback(async () => {
    if (!deckIdValue) return;
    const deck = await getDeck(deckIdValue);
    if (!deck) {
      setDeckTitle('');
      setDueCard(null);
      return;
    }
    setDeckTitle(deck.title);
    const card = await getDueCard(deckIdValue);
    setDueCard(card);
  }, [deckIdValue]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = async (grade: 'again' | 'hard' | 'good' | 'easy') => {
    if (!dueCard || !deckIdValue) return;
    await reviewCard(deckIdValue, dueCard.srs.cardId, grade);
    await incrementEvent('review_done');
    setShowAnswer(false);
    setStatus('✨ 復習を記録しました！');
    await load();
  };

  const reviewTitle = useMemo(() => {
    if (!deckTitle) return '📚 ノートが見つかりません';
    return `📖 復習ノート: ${deckTitle}`;
  }, [deckTitle]);

  return (
    <section className="section-grid">
      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {reviewTitle}
        </h2>
        {!deckTitle && (
          <p style={{ textAlign: 'center', padding: '20px 0' }}>
            <Link className="pill" to="/scan">
              📷 写真で単語にもどる
            </Link>
          </p>
        )}
        {deckTitle && !dueCard && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🎉</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
              いま復習するカードはありません。
            </p>
            <p style={{ color: 'var(--success)', fontWeight: 700, marginTop: 8 }}>
              おつかれさま！
            </p>
            <div style={{ marginTop: 20 }}>
              <Link className="pill" to="/scan">
                📷 新しい単語をひろう
              </Link>
            </div>
          </div>
        )}
        {deckTitle && dueCard && (
          <div>
            <p className="notice">先に意味を思い出してから「意味を見る」を押そう。</p>

            {/* Word Display Card */}
            <div style={{
              textAlign: 'center',
              padding: '24px 16px',
              background: 'linear-gradient(135deg, #FFF8FA, #FFF)',
              borderRadius: 16,
              border: '2px solid var(--primary-light)',
              marginBottom: 16
            }}>
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                marginBottom: 8
              }}>
                この単語の意味は？
              </div>
              <div style={{
                fontSize: '1.8rem',
                fontWeight: 700,
                color: 'var(--primary-dark)'
              }}>
                {dueCard.lexeme.headword}
              </div>
            </div>

            {showAnswer ? (
              <div style={{
                textAlign: 'center',
                padding: '20px 16px',
                background: 'linear-gradient(135deg, var(--success-light), #FFF)',
                borderRadius: 16,
                border: '2px solid var(--success)',
                marginBottom: 16
              }}>
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  marginBottom: 8
                }}>
                  意味
                </div>
                <div style={{
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)'
                }}>
                  {dueCard.lexeme.meaningJa}
                </div>
              </div>
            ) : (
              <button className="secondary" onClick={() => setShowAnswer(true)}>
                👀 意味を見る
              </button>
            )}

            <div className="grade-grid">
              {gradeLabels.map((item) => (
                <button
                  className="grade-button"
                  key={item.key}
                  onClick={() => handleReview(item.key)}
                >
                  <span style={{ fontSize: '1.2rem' }}>{item.emoji}</span>
                  {item.label}
                  <span>+{item.xp}XP</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {status && (
          <p className="counter" style={{
            textAlign: 'center',
            color: 'var(--success)',
            fontWeight: 600
          }}>
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
