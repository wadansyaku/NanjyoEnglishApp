import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, usePath } from '../lib/router';
import {
  createOrUpdateSystemDeck,
  getDeck,
  getDeckMasterySummary,
  getDeckWords,
  getDueCard,
  getDueCount,
  incrementEvent,
  removeLexemeFromDeck,
  reviewCard,
  type Deck,
  type DeckWord,
  type DueCard
} from '../db';
import {
  getActiveCurriculumStepId,
  getCurriculumProgress,
  markCurriculumStepCompleted,
  setActiveCurriculumStepId,
  setCurriculumProgress
} from '../lib/curriculumProgress';
import { fetchWordbankCurriculum, fetchWordbankStepWords, type WordbankCurriculumStep } from '../lib/wordbank';
import type { AppSettings } from '../lib/settings';
import { speak, stopSpeaking } from '../lib/tts';

const gradeLabels = [
  { key: 'again', label: 'もう一回', xp: 0, emoji: '🔄' },
  { key: 'hard', label: '難しい', xp: 1, emoji: '😓' },
  { key: 'good', label: 'できた！', xp: 2, emoji: '😊' },
  { key: 'easy', label: 'かんたん', xp: 3, emoji: '🌟' }
] as const;

type ReviewPageProps = {
  deckId: string;
  settings: AppSettings;
  showToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
};

const parseStepIdFromSource = (sourceId?: string) => {
  if (!sourceId) return '';
  if (!sourceId.startsWith('curriculum:')) return '';
  return sourceId.replace('curriculum:', '');
};

const findStepById = (stepId: string, steps: WordbankCurriculumStep[]) =>
  steps.find((step) => step.stepId === stepId) ?? null;

export default function ReviewPage({ deckId, settings, showToast }: ReviewPageProps) {
  const { navigate } = usePath();
  const [deckInfo, setDeckInfo] = useState<Deck | null>(null);
  const [deckWords, setDeckWords] = useState<DeckWord[]>([]);
  const [dueCard, setDueCard] = useState<DueCard | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState('');
  const [showWordEditor, setShowWordEditor] = useState(false);
  const [removingWordNorm, setRemovingWordNorm] = useState('');

  const [addingChunk, setAddingChunk] = useState(false);
  const [chunkSize, setChunkSize] = useState<5 | 10 | 20>(10);
  const [curriculumMeta, setCurriculumMeta] = useState<{
    stepId: string;
    total: number;
    loaded: number;
    mastered: number;
    completed: boolean;
  } | null>(null);

  const deckIdValue = deckId ?? '';

  const load = useCallback(async () => {
    if (!deckIdValue) return;
    const deck = await getDeck(deckIdValue);
    if (!deck) {
      setDeckInfo(null);
      setDeckWords([]);
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
    const words = await getDeckWords(deckIdValue);
    setDeckWords(words);
    const mastery = await getDeckMasterySummary(deckIdValue);

    const stepId = parseStepIdFromSource(deck.sourceId);
    if (!stepId) {
      setCurriculumMeta(null);
      return;
    }
    const progress = getCurriculumProgress(stepId);
    if (progress) {
      const total = Math.max(progress.total, deck.headwordNorms.length);
      const loaded = Math.min(progress.offset, total);
      const mastered = Math.max(0, Math.min(total, mastery.mastered));
      const completed = total > 0 && loaded >= total && mastered >= total;
      const next = setCurriculumProgress(stepId, {
        offset: loaded,
        total,
        chunkSize: progress.chunkSize,
        mastered,
        isCompleted: completed || progress.isCompleted
      });
      if (next.isCompleted) {
        markCurriculumStepCompleted(stepId);
        if (getActiveCurriculumStepId() === stepId) {
          setActiveCurriculumStepId('');
        }
      } else if (!getActiveCurriculumStepId() && loaded > 0) {
        setActiveCurriculumStepId(stepId);
      }
      setChunkSize(next.chunkSize);
      setCurriculumMeta({
        stepId,
        total: next.total,
        loaded: Math.min(next.offset, next.total),
        mastered: Math.min(next.mastered, next.total),
        completed: next.isCompleted
      });
      return;
    }
    const total = deck.headwordNorms.length;
    const loaded = total;
    const mastered = Math.max(0, Math.min(total, mastery.mastered));
    const completed = total > 0 && mastered >= total;
    const next = setCurriculumProgress(stepId, {
      offset: loaded,
      total,
      chunkSize,
      mastered,
      isCompleted: completed
    });
    if (next.isCompleted) {
      markCurriculumStepCompleted(stepId);
      if (getActiveCurriculumStepId() === stepId) {
        setActiveCurriculumStepId('');
      }
    } else if (!getActiveCurriculumStepId() && loaded > 0) {
      setActiveCurriculumStepId(stepId);
    }
    setCurriculumMeta({
      stepId,
      total: next.total,
      loaded: Math.min(next.offset, next.total),
      mastered: Math.min(next.mastered, next.total),
      completed: next.isCompleted
    });
  }, [chunkSize, deckIdValue]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setShowWordEditor(false);
    setRemovingWordNorm('');
  }, [deckIdValue]);

  useEffect(() => {
    if (!settings.autoPronounce || !dueCard || showAnswer) return;
    const timer = window.setTimeout(() => {
      speak(dueCard.lexeme.headword);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      stopSpeaking();
    };
  }, [settings.autoPronounce, dueCard, showAnswer]);

  useEffect(() => () => stopSpeaking(), []);

  const handleReview = async (grade: 'again' | 'hard' | 'good' | 'easy') => {
    if (!dueCard || !deckIdValue) return;
    stopSpeaking();
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
        chunkSize: size,
        mastered: Math.min(prev?.mastered ?? 0, nextOffset),
        isCompleted: false
      });
      setActiveCurriculumStepId(stepId);
      setChunkSize(size);
      setCurriculumMeta({
        stepId,
        total: words.length,
        loaded: nextOffset,
        mastered: Math.min(prev?.mastered ?? 0, nextOffset),
        completed: false
      });
      setStatus(`+${nextOffset - currentOffset}語 追加しました。`);
      showToast?.(`+${nextOffset - currentOffset}語 追加`, 'success');
      if (localDeckId !== deckIdValue) {
        navigate(`/review/${localDeckId}`);
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
  const canManageWords = Boolean(deckInfo && (!deckInfo.origin || deckInfo.origin === 'custom'));

  const handleRemoveWord = async (word: DeckWord) => {
    if (!deckInfo) return;
    if (!confirm(`「${word.headword}」をノートから削除しますか？`)) return;

    setRemovingWordNorm(word.headwordNorm);
    try {
      await removeLexemeFromDeck(deckInfo.deckId, word.headwordNorm);
      setStatus(`「${word.headword}」を削除しました。`);
      showToast?.(`「${word.headword}」を削除しました。`, 'success');
      await load();
    } catch (error) {
      const message = (error as Error).message || '単語の削除に失敗しました。';
      setStatus(message);
      showToast?.(message, 'error');
    } finally {
      setRemovingWordNorm('');
    }
  };

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
                取り込み済み: {curriculumMeta.loaded} / {curriculumMeta.total}語 ・ マスター: {curriculumMeta.mastered}語
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
            <p className="notice">カードをタップして英語と意味をめくろう。</p>
            <p className="badge">今日の残り: {dueCount} 枚</p>

            {curriculumMeta && (
              <div className="cut-candidate-box" style={{ marginBottom: 12 }}>
                <small className="candidate-meta">
                  学習範囲: {curriculumMeta.loaded} / {curriculumMeta.total}語
                </small>
                <small className="candidate-meta">
                  マスター: {curriculumMeta.mastered} / {curriculumMeta.total}語 {curriculumMeta.completed ? '・完了 ✅' : ''}
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
                {!canAddChunk && !curriculumMeta.completed && curriculumMeta.total > 0 && (
                  <p className="counter" style={{ marginTop: 8 }}>
                    すべて取り込み済みです。復習してこのステップを完了させよう。
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              className={`review-flip-card ${showAnswer ? 'is-back' : ''}`}
              onClick={() => setShowAnswer((prev) => !prev)}
              aria-label={showAnswer ? '英単語面に戻す' : '意味面へめくる'}
            >
              <span className="review-flip-face review-flip-front">
                <strong>{dueCard.lexeme.headword}</strong>
                <small>タップで意味へ</small>
              </span>
              <span className="review-flip-face review-flip-back">
                <strong>{dueCard.lexeme.meaningJa}</strong>
                <small>タップで英語へ</small>
              </span>
            </button>

            <div className="scan-inline-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  stopSpeaking();
                  speak(dueCard.lexeme.headword);
                }}
              >
                🔊 発音
              </button>
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
        {deckInfo?.title && canManageWords && (
          <div className="cut-candidate-box" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong>単語ノートを編集</strong>
              <button
                type="button"
                className="secondary candidate-cut-button"
                onClick={() => setShowWordEditor((prev) => !prev)}
              >
                {showWordEditor ? '閉じる' : '単語を削除'}
              </button>
            </div>
            {showWordEditor && (
              <div className="word-grid" style={{ marginTop: 10 }}>
                {deckWords.length === 0 && <p className="counter">このノートに単語はありません。</p>}
                {deckWords.map((word) => (
                  <div key={word.headwordNorm} className="word-item">
                    <div>
                      <strong>{word.headword}</strong>
                      <small>{word.meaningJa}</small>
                    </div>
                    <button
                      type="button"
                      className="secondary candidate-cut-button"
                      onClick={() => void handleRemoveWord(word)}
                      disabled={removingWordNorm === word.headwordNorm}
                    >
                      {removingWordNorm === word.headwordNorm ? '削除中…' : '削除'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
