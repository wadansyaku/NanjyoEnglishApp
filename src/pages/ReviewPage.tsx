import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import {
  createOrUpdateSystemDeck,
  getDeck,
  getDueCard,
  getDueCount,
  incrementEvent,
  reviewCard,
  type Deck,
  type DueCard
} from '../db';
import { getCurriculumProgress, setCurriculumProgress } from '../lib/curriculumProgress';
import { fetchWordbankCurriculum, fetchWordbankStepWords, type WordbankCurriculumStep } from '../lib/wordbank';

const gradeLabels = [
  { key: 'again', label: 'もう一回', xp: 0, emoji: '🔄' },
  { key: 'hard', label: '難しい', xp: 1, emoji: '😓' },
  { key: 'good', label: 'できた！', xp: 2, emoji: '😊' },
  { key: 'easy', label: 'かんたん', xp: 3, emoji: '🌟' }
] as const;

type ReviewPageProps = {
  deckId: string;
  showToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
};

const parseStepIdFromSource = (sourceId?: string) => {
  if (!sourceId) return '';
  if (!sourceId.startsWith('curriculum:')) return '';
  return sourceId.replace('curriculum:', '');
};

const findStepById = (stepId: string, steps: WordbankCurriculumStep[]) =>
  steps.find((step) => step.stepId === stepId) ?? null;

export default function ReviewPage({ deckId, showToast }: ReviewPageProps) {
  const [deckInfo, setDeckInfo] = useState<Deck | null>(null);
  const [dueCard, setDueCard] = useState<DueCard | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState('');

  const [addingChunk, setAddingChunk] = useState(false);
  const [chunkSize, setChunkSize] = useState<5 | 10 | 20>(10);
  const [curriculumMeta, setCurriculumMeta] = useState<{
    stepId: string;
    total: number;
    loaded: number;
  } | null>(null);

  const deckIdValue = deckId ?? '';

  const load = useCallback(async () => {
    if (!deckIdValue) return;
    const deck = await getDeck(deckIdValue);
    if (!deck) {
      setDeckInfo(null);
      setDueCard(null);
      setDueCount(0);
      setCurriculumMeta(null);
      return;
    }
    setDeckInfo(deck);
    const card = await getDueCard(deckIdValue);
    setDueCard(card);
    const count = await getDueCount(deckIdValue);
    setDueCount(count);

    const stepId = parseStepIdFromSource(deck.sourceId);
    if (!stepId) {
      setCurriculumMeta(null);
      return;
    }
    const progress = getCurriculumProgress(stepId);
    if (progress) {
      setChunkSize(progress.chunkSize);
      setCurriculumMeta({
        stepId,
        total: progress.total,
        loaded: Math.min(progress.offset, progress.total)
      });
      return;
    }
    setCurriculumMeta({ stepId, total: deck.headwordNorms.length, loaded: deck.headwordNorms.length });
  }, [deckIdValue]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = async (grade: 'again' | 'hard' | 'good' | 'easy') => {
    if (!dueCard || !deckIdValue) return;
    await reviewCard(deckIdValue, dueCard.srs.cardId, grade);
    await incrementEvent('review_done');
    setShowAnswer(false);
    const gradeInfo = gradeLabels.find((item) => item.key === grade);
    setStatus(`${gradeInfo?.emoji ?? '✨'} ${gradeInfo?.label ?? ''} で進んだよ！`);
    const xp = gradeInfo?.xp ?? 0;
    if (xp > 0) {
      showToast?.(`+${xp}pt`, 'success');
    }
    await load();
  };

  const handleAddChunk = async (size: 5 | 10 | 20) => {
    if (!deckInfo) return;
    const stepId = parseStepIdFromSource(deckInfo.sourceId);
    if (!stepId) return;

    setAddingChunk(true);
    setStatus('');
    try {
      const curriculum = await fetchWordbankCurriculum();
      const steps = (curriculum.tracks ?? []).flatMap((track) => track.steps ?? []);
      const step = findStepById(stepId, steps);
      if (!step) {
        throw new Error('カリキュラム情報を取得できませんでした。');
      }

      const words = await fetchWordbankStepWords(step);
      if (words.length === 0) {
        throw new Error('追加できる単語がありません。');
      }

      const prev = getCurriculumProgress(stepId);
      const currentOffset = Math.max(0, Math.min(prev?.offset ?? deckInfo.headwordNorms.length, words.length));
      const nextOffset = Math.min(words.length, currentOffset + size);
      if (nextOffset <= currentOffset) {
        setStatus('このステップは全て取り込み済みです。');
        return;
      }

      const selected = words.slice(0, nextOffset);
      const localDeckId = await createOrUpdateSystemDeck({
        sourceId: `curriculum:${stepId}`,
        title: `${step.title} (${nextOffset}/${words.length})`,
        origin: 'core',
        words: selected
      });
      setCurriculumProgress(stepId, {
        offset: nextOffset,
        total: words.length,
        chunkSize: size
      });
      setChunkSize(size);
      setCurriculumMeta({ stepId, total: words.length, loaded: nextOffset });
      setStatus(`+${nextOffset - currentOffset}語 追加しました。`);
      showToast?.(`+${nextOffset - currentOffset}語 追加`, 'success');
      if (localDeckId !== deckIdValue) {
        window.history.pushState({}, '', `/review/${localDeckId}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      await load();
    } catch (error) {
      setStatus((error as Error).message || '単語追加に失敗しました。');
      showToast?.((error as Error).message || '単語追加に失敗しました。', 'error');
    } finally {
      setAddingChunk(false);
    }
  };

  const reviewTitle = useMemo(() => {
    if (!deckInfo?.title) return '📚 ノートが見つかりません';
    return `📖 復習ノート: ${deckInfo.title}`;
  }, [deckInfo?.title]);

  const canAddChunk = Boolean(curriculumMeta && curriculumMeta.loaded < curriculumMeta.total);

  return (
    <section className="section-grid">
      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {reviewTitle}
        </h2>
        {!deckInfo?.title && (
          <p style={{ textAlign: 'center', padding: '20px 0' }}>
            <Link className="pill" to="/scan">
              📷 写真で単語にもどる
            </Link>
          </p>
        )}
        {deckInfo?.title && !dueCard && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🎉</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
              いま復習するカードはありません。
            </p>
            <p style={{ color: 'var(--success)', fontWeight: 700, marginTop: 8 }}>
              おつかれさま！
            </p>
            {curriculumMeta && (
              <p className="counter" style={{ marginTop: 8 }}>
                取り込み済み: {curriculumMeta.loaded} / {curriculumMeta.total}語
              </p>
            )}
            <div style={{ marginTop: 20 }}>
              {canAddChunk ? (
                <div className="scan-inline-actions">
                  {[5, 10, 20].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={chunkSize === size ? '' : 'secondary'}
                      onClick={() => handleAddChunk(size as 5 | 10 | 20)}
                      disabled={addingChunk}
                    >
                      {addingChunk ? '追加中…' : `次の${size}語`}
                    </button>
                  ))}
                </div>
              ) : (
                <Link className="pill" to="/scan">📷 新しい単語をひろう</Link>
              )}
            </div>
          </div>
        )}
        {deckInfo?.title && dueCard && (
          <div>
            <p className="notice">先に意味を思い出してから「意味を見る」を押そう。</p>
            <p className="badge">今日の残り: {dueCount} 枚</p>

            {curriculumMeta && (
              <div className="cut-candidate-box" style={{ marginBottom: 12 }}>
                <small className="candidate-meta">
                  学習範囲: {curriculumMeta.loaded} / {curriculumMeta.total}語
                </small>
                {canAddChunk && (
                  <div className="scan-inline-actions" style={{ marginTop: 8 }}>
                    {[5, 10, 20].map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={chunkSize === size ? '' : 'secondary'}
                        onClick={() => handleAddChunk(size as 5 | 10 | 20)}
                        disabled={addingChunk}
                      >
                        {addingChunk ? '追加中…' : `次の${size}語`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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

      {deckInfo?.title && dueCard && (
        <div className="review-grade-dock">
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
      {deckInfo?.title && dueCard && <div className="review-page-spacer" />}
    </section>
  );
}
