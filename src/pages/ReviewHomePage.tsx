import { useEffect, useMemo, useState } from 'react';
import { Link, usePath } from '../lib/router';
import {
  createOrUpdateSystemDeck,
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
  const [wordbankDecks, setWordbankDecks] = useState<Array<{
    deckId: string;
    title: string;
    description: string;
    wordCount: number;
  }>>([]);
  const [wordbankLoading, setWordbankLoading] = useState(false);
  const [wordbankImportingId, setWordbankImportingId] = useState('');
  const [wordbankStatus, setWordbankStatus] = useState('');

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

  const loadWordbankDecks = async () => {
    setWordbankLoading(true);
    try {
      const response = await fetch('/api/v1/wordbank/decks');
      if (!response.ok) {
        setWordbankDecks([]);
        return;
      }
      const data = (await response.json()) as {
        ok: boolean;
        decks?: Array<{
          deckId: string;
          title: string;
          description?: string;
          wordCount?: number;
        }>;
      };
      setWordbankDecks(
        (data.decks ?? []).map((deck) => ({
          deckId: deck.deckId,
          title: deck.title,
          description: deck.description ?? '',
          wordCount: Number(deck.wordCount ?? 0)
        }))
      );
    } catch {
      setWordbankDecks([]);
    } finally {
      setWordbankLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadWordbankDecks();
  }, []);

  const handleStartWordbankDeck = async (deckId: string) => {
    if (!deckId) return;
    setWordbankImportingId(deckId);
    setWordbankStatus('');
    try {
      const response = await fetch(`/api/v1/wordbank/decks/${encodeURIComponent(deckId)}/words`);
      if (!response.ok) {
        throw new Error('単語帳データを取得できませんでした。');
      }
      const data = (await response.json()) as {
        ok: boolean;
        deck: { deckId: string; title: string };
        words: Array<{
          headwordNorm: string;
          headword: string;
          meaningJaShort: string;
        }>;
      };
      const localDeckId = await createOrUpdateSystemDeck({
        sourceId: data.deck.deckId,
        title: data.deck.title,
        origin: 'core',
        words: data.words
      });
      setWordbankStatus(`「${data.deck.title}」を復習ノートに追加しました。`);
      await loadData();
      navigate(`/review/${localDeckId}`);
    } catch (error) {
      setWordbankStatus((error as Error).message || '単語帳の取り込みに失敗しました。');
    } finally {
      setWordbankImportingId('');
    }
  };

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
      {/* 今日の3分 - コンパクト版 */}
      <div className="card card-compact" style={{ background: 'linear-gradient(135deg, var(--primary-light), var(--secondary-light))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>⚡ きょうの3分</h2>
          {quickCount > 0 ? (
            <button
              onClick={handleStartQuickReview}
              style={{ width: 'auto', padding: '8px 16px', fontSize: '0.9rem' }}
            >
              さっそく始める！
            </button>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>クリア済み ✨</span>
          )}
        </div>
      </div>

      {/* 主 CTA: 単語帳がない場合はfold内に大きなボタン */}
      {!recommendedDeck && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 12 }}>まず1つ作ってみよう 📷</p>
          <Link className="pill" to="/scan">写真から単語を追加</Link>
        </div>
      )}

      {recommendedDeck && (
        <div className="card card-compact">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>📚 今日の復習</h2>
              <small className="badge badge-sm">残り: {totalDue} 枚</small>
            </div>
            <Link className="pill" to={`/review/${recommendedDeck.deckId}`}>
              つづける
            </Link>
          </div>
        </div>
      )}

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

      <div className="card">
        <h2>学校単語帳</h2>
        <p className="notice">先生向けに作られた単語セットを、そのまま復習に追加できます。</p>
        {wordbankLoading && <p className="counter">読み込み中…</p>}
        {!wordbankLoading && wordbankDecks.length === 0 && (
          <p className="counter">公開されている単語帳はまだありません。</p>
        )}
        <div className="word-grid">
          {wordbankDecks.map((deck) => (
            <div key={deck.deckId} className="word-item">
              <div>
                <strong>{deck.title}</strong>
                <small className="candidate-meta">
                  {deck.wordCount}語 {deck.description ? `・${deck.description}` : ''}
                </small>
              </div>
              <button
                className="pill"
                type="button"
                onClick={() => handleStartWordbankDeck(deck.deckId)}
                disabled={wordbankImportingId === deck.deckId}
              >
                {wordbankImportingId === deck.deckId ? '追加中…' : '学習を始める'}
              </button>
            </div>
          ))}
        </div>
        {wordbankStatus && <p className="counter">{wordbankStatus}</p>}
      </div>
    </section>
  );
}
