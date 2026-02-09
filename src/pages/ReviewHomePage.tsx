import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, usePath } from '../lib/router';
import {
  createOrUpdateSystemDeck,
  deleteDeck,
  getQuickReviewCards,
  getQuickReviewCount,
  listDeckDueSummaries,
  reviewCard,
  type DeckDueSummary,
  type DueCard
} from '../db';
import {
  getCurriculumProgress,
  loadCurriculumProgressMap,
  setCurriculumProgress
} from '../lib/curriculumProgress';
import {
  fetchWordbankCurriculum,
  fetchWordbankStepWords,
  type WordbankCurriculumResponse,
  type WordbankCurriculumStep,
  type WordbankCurriculumTrack
} from '../lib/wordbank';
import type { AppSettings } from '../lib/settings';
import { speak, stopSpeaking } from '../lib/tts';

type QuickReviewState = 'idle' | 'reviewing' | 'complete';

type WordbankDeck = {
  deckId: string;
  title: string;
  description: string;
  wordCount: number;
};

const resolveChunkSize = (step: WordbankCurriculumStep) => {
  if (step.recommendedChunk === 5 || step.recommendedChunk === 20) return step.recommendedChunk;
  return 10;
};

type ReviewHomePageProps = {
  settings: AppSettings;
};

export default function ReviewHomePage({ settings }: ReviewHomePageProps) {
  const { navigate } = usePath();

  const [summaries, setSummaries] = useState<DeckDueSummary[]>([]);
  const [quickCount, setQuickCount] = useState(0);

  const [wordbankDecks, setWordbankDecks] = useState<WordbankDeck[]>([]);
  const [wordbankLoading, setWordbankLoading] = useState(false);
  const [wordbankImportingId, setWordbankImportingId] = useState('');
  const [wordbankStatus, setWordbankStatus] = useState('');
  const [showRawDecks, setShowRawDecks] = useState(false);
  const [deletingDeckId, setDeletingDeckId] = useState('');

  const [tracks, setTracks] = useState<WordbankCurriculumTrack[]>([]);
  const [allRange, setAllRange] = useState<WordbankCurriculumResponse['allRange']>(null);
  const [selectedTrackId, setSelectedTrackId] = useState('accelerated');
  const [stepProgress, setStepProgress] = useState(() => loadCurriculumProgressMap());

  const [quickState, setQuickState] = useState<QuickReviewState>('idle');
  const [quickCards, setQuickCards] = useState<DueCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const loadData = useCallback(async () => {
    const rows = await listDeckDueSummaries();
    const qCount = await getQuickReviewCount();
    setSummaries(rows);
    setQuickCount(qCount);
  }, []);

  const loadWordbankDecks = useCallback(async () => {
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
  }, []);

  const loadCurriculum = useCallback(async () => {
    try {
      const data = await fetchWordbankCurriculum();
      const nextTracks = data.tracks ?? [];
      setTracks(nextTracks);
      setAllRange(data.allRange ?? null);
      setSelectedTrackId((prev) => {
        if (nextTracks.length === 0) return prev;
        if (nextTracks.some((track) => track.trackId === prev)) return prev;
        return nextTracks[0].trackId;
      });
    } catch {
      setTracks([]);
      setAllRange(null);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void loadWordbankDecks();
    void loadCurriculum();
  }, [loadCurriculum, loadData, loadWordbankDecks]);

  useEffect(() => {
    if (quickState !== 'reviewing' || !settings.autoPronounce || showAnswer) return;
    const card = quickCards[currentIndex];
    if (!card) return;
    if (!speak(card.lexeme.headword)) return;
    return () => {
      stopSpeaking();
    };
  }, [quickState, settings.autoPronounce, quickCards, currentIndex, showAnswer]);

  useEffect(() => () => stopSpeaking(), []);

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

  const handleStartCurriculumStep = async (step: WordbankCurriculumStep) => {
    setWordbankImportingId(step.stepId);
    setWordbankStatus('');
    try {
      const words = await fetchWordbankStepWords(step);
      if (words.length === 0) {
        throw new Error('このステップに単語がありません。');
      }

      const progress = getCurriculumProgress(step.stepId);
      const chunkSize = progress?.chunkSize ?? resolveChunkSize(step);
      const targetCount = Math.max(
        1,
        Math.min(words.length, progress?.offset && progress.offset > 0 ? progress.offset : chunkSize)
      );
      const selected = words.slice(0, targetCount);

      const localDeckId = await createOrUpdateSystemDeck({
        sourceId: `curriculum:${step.stepId}`,
        title: `${step.title} (${targetCount}/${words.length})`,
        origin: 'core',
        words: selected
      });

      setCurriculumProgress(step.stepId, {
        offset: targetCount,
        total: words.length,
        chunkSize
      });
      setStepProgress(loadCurriculumProgressMap());

      setWordbankStatus(
        `「${step.title}」を開始しました。復習画面で 5/10/20語ずつ続きを追加できます。`
      );
      await loadData();
      navigate(`/review/${localDeckId}`);
    } catch (error) {
      setWordbankStatus((error as Error).message || '取り込みに失敗しました。');
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

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.trackId === selectedTrackId) ?? tracks[0] ?? null,
    [tracks, selectedTrackId]
  );

  const handleStartQuickReview = async () => {
    const cards = await getQuickReviewCards(5);
    if (cards.length === 0) {
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

  const handleDeleteCustomDeck = async (deckId: string, title: string) => {
    if (!deckId) return;
    if (!confirm(`「${title}」を削除しますか？この操作は取り消せません。`)) return;
    setDeletingDeckId(deckId);
    try {
      await deleteDeck(deckId);
      setWordbankStatus(`「${title}」を削除しました。`);
      await loadData();
    } catch (error) {
      setWordbankStatus((error as Error).message || '単語ノートの削除に失敗しました。');
    } finally {
      setDeletingDeckId('');
    }
  };

  const handleGrade = async (grade: 'again' | 'hard' | 'good' | 'easy') => {
    const card = quickCards[currentIndex];
    stopSpeaking();
    await reviewCard(card.srs.deckId, card.srs.cardId, grade);

    if (currentIndex + 1 < quickCards.length) {
      setCurrentIndex(currentIndex + 1);
      setShowAnswer(false);
    } else {
      setQuickState('complete');
      await loadData();
    }
  };

  const handleFinishQuickReview = () => {
    stopSpeaking();
    setQuickState('idle');
    setQuickCards([]);
    setCurrentIndex(0);
    setShowAnswer(false);
  };

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
            <button
              type="button"
              className={`review-flip-card ${showAnswer ? 'is-back' : ''}`}
              onClick={() => setShowAnswer((prev) => !prev)}
              aria-label={showAnswer ? '英単語面に戻す' : '意味面へめくる'}
            >
              <span className="review-flip-face review-flip-front">
                <strong>{card.lexeme.headword}</strong>
                <small>タップで意味へ</small>
              </span>
              <span className="review-flip-face review-flip-back">
                <strong>{card.lexeme.meaningJa}</strong>
                <small>タップで英語へ</small>
              </span>
            </button>

            <div className="scan-inline-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  stopSpeaking();
                  speak(card.lexeme.headword);
                }}
              >
                🔊 発音
              </button>
            </div>

            {showAnswer && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 14 }}>
                <button className="secondary" onClick={() => handleGrade('again')}>🔄 もう一回</button>
                <button className="secondary" onClick={() => handleGrade('hard')}>😓 難しい</button>
                <button onClick={() => handleGrade('good')}>😊 できた</button>
                <button onClick={() => handleGrade('easy')}>🌟 かんたん</button>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (quickState === 'complete') {
    return (
      <section className="section-grid">
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</p>
          <h2>今日もお疲れさま！</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{quickCards.length}問クリアしたよ</p>
          <button onClick={handleFinishQuickReview} style={{ marginTop: 24 }}>ホームに戻る</button>
        </div>
      </section>
    );
  }

  return (
    <section className="section-grid">
      <div className="card card-compact" style={{ background: 'linear-gradient(135deg, var(--primary-light), var(--secondary-light))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>⚡ きょうの3分</h2>
          {quickCount > 0 ? (
            <button onClick={handleStartQuickReview} style={{ width: 'auto', padding: '8px 16px', fontSize: '0.9rem' }}>
              さっそく始める！
            </button>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>クリア済み ✨</span>
          )}
        </div>
      </div>

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
            <Link className="pill" to={`/review/${recommendedDeck.deckId}`}>つづける</Link>
          </div>
        </div>
      )}

      <div className="card">
        <h2>単語ノート</h2>
        {summaries.length === 0 && <p>まだ単語ノートがありません。</p>}
        <div className="word-grid">
          {summaries.map((item) => (
            <div key={item.deckId} className="word-item">
              <div>
                <strong>{item.title}</strong>
                <small className="candidate-meta">今日: {item.dueCount} / 全体: {item.totalCards}</small>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link className="pill" to={`/review/${item.deckId}`}>開く</Link>
                <Link className="pill" to={`/test/${item.deckId}`}>テスト</Link>
                {(item.origin !== 'core' && item.origin !== 'dungeon') && (
                  <button
                    type="button"
                    className="pill secondary"
                    onClick={() => void handleDeleteCustomDeck(item.deckId, item.title)}
                    disabled={deletingDeckId === item.deckId}
                  >
                    {deletingDeckId === item.deckId ? '削除中…' : '削除'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>学校単語帳</h2>

        {tracks.length > 0 && (
          <>
            <div className="pill-group">
              {tracks.map((track) => (
                <button
                  type="button"
                  key={track.trackId}
                  className={track.trackId === (selectedTrack?.trackId ?? '') ? '' : 'secondary'}
                  onClick={() => setSelectedTrackId(track.trackId)}
                >
                  {track.title}
                </button>
              ))}
            </div>

            {selectedTrack && (
              <div className="word-grid" style={{ marginTop: 12 }}>
                <p className="counter">{selectedTrack.description}</p>
                {selectedTrack.steps.map((step) => {
                  const progress = stepProgress[step.stepId];
                  const learned = progress?.offset ?? 0;
                  const importing = wordbankImportingId === step.stepId;
                  return (
                    <div key={step.stepId} className="word-item" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <strong>{step.title}</strong>
                        <small className="candidate-meta">{step.wordCount}語 ・ 取り込み済み {Math.min(learned, step.wordCount)}語</small>
                        <small className="candidate-meta">{step.description}</small>
                        {step.note && <small className="candidate-meta">{step.note}</small>}
                      </div>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => handleStartCurriculumStep(step)}
                        disabled={importing}
                      >
                        {importing ? '準備中…' : learned > 0 ? 'つづきを開く' : '学習を始める'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {allRange && (
          <details style={{ marginTop: 12 }}>
            <summary>全範囲（上級者向け）</summary>
            <div className="word-item" style={{ marginTop: 10 }}>
              <div>
                <strong>{allRange.title}</strong>
                <small className="candidate-meta">{allRange.wordCount}語 ・ {allRange.description}</small>
              </div>
              <button
                type="button"
                className="pill"
                onClick={() => handleStartWordbankDeck(allRange.deckId)}
                disabled={wordbankImportingId === allRange.deckId}
              >
                {wordbankImportingId === allRange.deckId ? '追加中…' : '学習を始める'}
              </button>
            </div>
          </details>
        )}

        <button
          type="button"
          className="secondary"
          style={{ marginTop: 12 }}
          onClick={() => setShowRawDecks((prev) => !prev)}
        >
          {showRawDecks ? '詳細デッキを閉じる' : '詳細デッキを表示'}
        </button>

        {showRawDecks && (
          <div className="word-grid" style={{ marginTop: 12 }}>
            {wordbankLoading && <p className="counter">読み込み中…</p>}
            {!wordbankLoading && wordbankDecks.length === 0 && (
              <p className="counter">公開されている単語帳はまだありません。</p>
            )}
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
        )}

        {wordbankStatus && <p className="counter">{wordbankStatus}</p>}
      </div>
    </section>
  );
}
