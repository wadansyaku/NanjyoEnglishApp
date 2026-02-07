import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { getDeck, getDueCard, incrementEvent, reviewCard, type DueCard } from '../db';

const gradeLabels = [
  { key: 'again', label: 'もう1回', xp: 0 },
  { key: 'hard', label: 'むずかしい', xp: 1 },
  { key: 'good', label: 'できた', xp: 2 },
  { key: 'easy', label: 'かんたん', xp: 3 }
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
    setStatus('復習を記録しました。');
    await load();
  };

  const reviewTitle = useMemo(() => {
    if (!deckTitle) return 'ノートが見つかりません';
    return `復習ノート: ${deckTitle}`;
  }, [deckTitle]);

  return (
    <section className="section-grid">
      <div className="card">
        <h2>{reviewTitle}</h2>
        {!deckTitle && (
          <p>
            <Link className="pill" to="/scan">
              写真で単語にもどる
            </Link>
          </p>
        )}
        {deckTitle && !dueCard && <p>いま復習するカードはありません。おつかれさま。</p>}
        {deckTitle && dueCard && (
          <div>
            <p className="notice">先に意味を思い出してから「意味を見る」を押そう。</p>
            <div className="badge">単語: {dueCard.lexeme.headword}</div>
            {showAnswer ? (
              <p style={{ marginTop: 12 }}>意味: {dueCard.lexeme.meaningJa}</p>
            ) : (
              <button className="secondary" onClick={() => setShowAnswer(true)}>
                意味を見る
              </button>
            )}
            <div className="grade-grid">
              {gradeLabels.map((item) => (
                <button className="grade-button" key={item.key} onClick={() => handleReview(item.key)}>
                  {item.label}
                  <span>+{item.xp}XP</span>
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
