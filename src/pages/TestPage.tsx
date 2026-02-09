import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { getDeck, getDeckWords, type DeckWord } from '../db';
import {
  buildPrintableTestHtml,
  buildQuestions,
  isTypingCorrect,
  type TestMode,
  type TestQuestion
} from '../lib/practiceTest';

type TestPageProps = {
  deckId: string;
};

type AnswerState = {
  questionId: string;
  answer: string;
  correct: boolean;
};

const modeLabels: Record<TestMode, string> = {
  choice: '4択（英語→日本語）',
  typing: '入力（日本語→英語）',
  reverse: '逆4択（日本語→英語）',
  mixed: 'ミックス'
};

export default function TestPage({ deckId }: TestPageProps) {
  const [loading, setLoading] = useState(true);
  const [deckTitle, setDeckTitle] = useState('');
  const [words, setWords] = useState<DeckWord[]>([]);
  const [status, setStatus] = useState('');

  const [mode, setMode] = useState<TestMode>('mixed');
  const [count, setCount] = useState(10);
  const [started, setStarted] = useState(false);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState('');
  const [answers, setAnswers] = useState<AnswerState[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setStatus('');
      const deck = await getDeck(deckId);
      if (!deck) {
        if (!cancelled) {
          setDeckTitle('');
          setWords([]);
          setStatus('テスト対象のノートが見つかりません。');
        }
        return;
      }
      const rows = await getDeckWords(deckId);
      if (!cancelled) {
        setDeckTitle(deck.title);
        setWords(rows);
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const current = questions[index] ?? null;
  const finished = started && index >= questions.length && questions.length > 0;
  const score = useMemo(() => answers.filter((answer) => answer.correct).length, [answers]);

  const handleStart = () => {
    const built = buildQuestions(
      words.map((word) => ({
        headwordNorm: word.headwordNorm,
        headword: word.headword,
        meaningJa: word.meaningJa
      })),
      { count, mode }
    );
    if (built.length === 0) {
      setStatus('テスト問題を作れませんでした。');
      return;
    }
    setQuestions(built);
    setAnswers([]);
    setIndex(0);
    setTyping('');
    setStarted(true);
    setStatus('');
  };

  const handleChoice = (answer: string) => {
    if (!current) return;
    const correct = answer === current.answer;
    setAnswers((prev) => [...prev, { questionId: current.id, answer, correct }]);
    setIndex((prev) => prev + 1);
  };

  const handleTyping = () => {
    if (!current) return;
    const answer = typing.trim();
    const correct = isTypingCorrect(answer, current.answer);
    setAnswers((prev) => [...prev, { questionId: current.id, answer, correct }]);
    setTyping('');
    setIndex((prev) => prev + 1);
  };

  const handlePrint = () => {
    if (questions.length === 0) return;
    const html = buildPrintableTestHtml(`単語テスト: ${deckTitle}`, questions, {
      subtitle: `ノート: ${deckTitle}`,
      modeLabel: modeLabels[mode]
    });
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      setStatus('ポップアップがブロックされました。');
      return;
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  };

  const reset = () => {
    setStarted(false);
    setQuestions([]);
    setIndex(0);
    setAnswers([]);
    setTyping('');
    setStatus('');
  };

  if (loading) {
    return (
      <section className="section-grid">
        <div className="card">
          <h2>📝 単語テスト</h2>
          <p>読み込み中…</p>
        </div>
      </section>
    );
  }

  if (!deckTitle) {
    return (
      <section className="section-grid">
        <div className="card">
          <h2>📝 単語テスト</h2>
          <p>{status || 'ノートが見つかりません。'}</p>
          <Link className="pill" to="/review">復習にもどる</Link>
        </div>
      </section>
    );
  }

  if (finished) {
    return (
      <section className="section-grid">
        <div className="card">
          <h2>✅ テスト完了</h2>
          <p className="badge">
            正解 {score} / {questions.length}
          </p>
          <p className="counter">もう一度同じ条件で解き直すこともできます。</p>
          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={reset}>別条件で作り直す</button>
            <button type="button" className="secondary" onClick={handlePrint}>印刷シートを開く</button>
            <Link className="pill" to={`/review/${deckId}`}>復習にもどる</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section-grid">
      {!started && (
        <div className="card">
          <h2>📝 単語テスト</h2>
          <p className="notice">普段の復習とは違う形式で、理解をチェックできます。</p>
          <p><strong>{deckTitle}</strong>（{words.length}語）</p>

          <label>テスト方式</label>
          <select value={mode} onChange={(event) => setMode(event.target.value as TestMode)}>
            <option value="mixed">ミックス</option>
            <option value="choice">4択（英語→日本語）</option>
            <option value="reverse">逆4択（日本語→英語）</option>
            <option value="typing">入力（日本語→英語）</option>
          </select>

          <label style={{ marginTop: 12 }}>問題数</label>
          <div className="scan-inline-actions">
            {[5, 10, 20].map((size) => (
              <button
                type="button"
                key={size}
                className={count === size ? '' : 'secondary'}
                onClick={() => setCount(Math.min(size, words.length))}
              >
                {size}問
              </button>
            ))}
          </div>

          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={handleStart}>テスト開始</button>
            <Link className="pill" to={`/review/${deckId}`}>復習にもどる</Link>
          </div>
          {status && <p className="counter">{status}</p>}
        </div>
      )}

      {started && current && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>🧠 テスト中</h2>
            <span className="badge">{index + 1}/{questions.length}</span>
          </div>

          <div className="review-card" style={{ marginTop: 12 }}>
            <p className="counter">問題</p>
            <p style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 8 }}>{current.prompt}</p>

            {(current.type === 'choice' || current.type === 'reverse') && (
              <div className="word-grid">
                {current.choices.map((choice) => (
                  <button key={choice} type="button" className="secondary" onClick={() => handleChoice(choice)}>
                    {choice}
                  </button>
                ))}
              </div>
            )}

            {current.type === 'typing' && (
              <>
                <input
                  type="text"
                  value={typing}
                  onChange={(event) => setTyping(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleTyping();
                    }
                  }}
                  placeholder="英単語を入力"
                />
                <button style={{ marginTop: 10 }} type="button" onClick={handleTyping} disabled={!typing.trim()}>
                  回答する
                </button>
              </>
            )}
          </div>

          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <button type="button" className="secondary" onClick={reset}>中止</button>
            <button type="button" className="secondary" onClick={handlePrint}>印刷シート</button>
          </div>
        </div>
      )}
    </section>
  );
}
