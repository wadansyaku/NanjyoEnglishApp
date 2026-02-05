import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { getDeck, getDueCard, reviewCard, type DueCard } from '../db';

const gradeLabels = [
  { key: 'again', label: 'Again', xp: 0 },
  { key: 'hard', label: 'Hard', xp: 1 },
  { key: 'good', label: 'Good', xp: 2 },
  { key: 'easy', label: 'Easy', xp: 3 }
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
    setShowAnswer(false);
    setStatus('レビューを記録しました。');
    await load();
  };

  const reviewTitle = useMemo(() => {
    if (!deckTitle) return 'デッキが見つかりません';
    return `レビュー: ${deckTitle}`;
  }, [deckTitle]);

  return (
    <section className="section-grid">
      <div className="card">
        <h2>{reviewTitle}</h2>
        {!deckTitle && (
          <p>
            <Link className="pill" to="/scan">
              /scan に戻る
            </Link>
          </p>
        )}
        {deckTitle && !dueCard && <p>いま復習対象のカードがありません。</p>}
        {deckTitle && dueCard && (
          <div>
            <div className="badge">Headword: {dueCard.lexeme.headword}</div>
            {showAnswer ? (
              <p style={{ marginTop: 12 }}>意味: {dueCard.lexeme.meaningJa}</p>
            ) : (
              <button className="secondary" onClick={() => setShowAnswer(true)}>
                答えを見る
              </button>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {gradeLabels.map((item) => (
                <button key={item.key} onClick={() => handleReview(item.key)}>
                  {item.label} (+{item.xp}XP)
                </button>
              ))}
            </div>
          </div>
        )}
        {status && <p className="counter">{status}</p>}
      </div>
    </section>
  );
}
