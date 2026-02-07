import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { listDeckDueSummaries, type DeckDueSummary } from '../db';

export default function ReviewHomePage() {
  const [summaries, setSummaries] = useState<DeckDueSummary[]>([]);

  useEffect(() => {
    void (async () => {
      const rows = await listDeckDueSummaries();
      setSummaries(rows);
    })();
  }, []);

  const totalDue = useMemo(
    () => summaries.reduce((sum, item) => sum + item.dueCount, 0),
    [summaries]
  );

  const recommendedDeck = useMemo(
    () => summaries.find((item) => item.dueCount > 0) ?? summaries[0] ?? null,
    [summaries]
  );

  return (
    <section className="section-grid">
      <div className="card">
        <h2>今日のReview</h2>
        <p className="badge">残りカード: {totalDue} 枚</p>
        {recommendedDeck && (
          <div className="scan-inline-actions">
            <Link className="pill" to={`/review/${recommendedDeck.deckId}`}>
              つづける: {recommendedDeck.title}
            </Link>
          </div>
        )}
        {!recommendedDeck && (
          <p>
            まだノートがありません。<Link className="pill" to="/scan">Scanから作成</Link>
          </p>
        )}
      </div>

      <div className="card">
        <h2>デッキ別の残り</h2>
        {summaries.length === 0 && <p>まだデッキがありません。</p>}
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
