import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { runOcr } from '../lib/ocr';
import { extractCandidates } from '../lib/words';
import { ensureAuth } from '../lib/auth';
import {
  addLexemeToDeck,
  createDeck,
  incrementEvent,
  listDecks,
  normalizeHeadword,
  type Deck
} from '../db';

type Candidate = {
  id: string;
  headword: string;
  headwordNorm: string;
  count: number;
  selected: boolean;
  meaning: string;
  source: 'found' | 'missing';
};

const MAX_CANDIDATES = 12;
const LIMITS = {
  meaning: 80
};

const ocrStatusLabel: Record<'idle' | 'running' | 'done' | 'error', string> = {
  idle: 'まだ写真を読み取っていません',
  running: '読み取り中です',
  done: '読み取りできました',
  error: '読み取りに失敗しました'
};

const lookupStatusLabel: Record<'idle' | 'loading' | 'done' | 'error', string> = {
  idle: 'まだ検索していません',
  loading: '意味を検索中です',
  done: '検索が終わりました',
  error: '検索に失敗しました'
};

const safeTrim = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

export default function ScanPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckTitle, setDeckTitle] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [ocrError, setOcrError] = useState('');
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [lookupError, setLookupError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState('');

  const loadDecks = useCallback(async () => {
    const items = await listDecks();
    setDecks(items);
  }, []);

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  const handleImage = async (file: File) => {
    await incrementEvent('scan_started');
    setOcrStatus('running');
    setOcrError('');
    setLookupStatus('idle');
    setLookupError('');
    setStatus('');
    try {
      const text = await runOcr(file);
      setOcrText(text);
      setOcrStatus('done');
      await incrementEvent('ocr_done');
    } catch (error) {
      setOcrStatus('error');
      setOcrError((error as Error).message);
    }
  };

  const extractFromText = useCallback(
    async (text: string) => {
      const extracted = extractCandidates(text).slice(0, MAX_CANDIDATES);
      const prevMap = new Map(candidates.map((item) => [item.headwordNorm, item]));
      const base: Candidate[] = extracted.map((item, index) => {
        const headword = item.word;
        const headwordNorm = normalizeHeadword(headword);
        const prev = prevMap.get(headwordNorm);
        return {
          id: prev?.id ?? `${headwordNorm}:${item.word}:${index}`,
          headword,
          headwordNorm,
          count: item.count,
          selected: prev?.selected ?? true,
          meaning: prev?.meaning ?? '',
          source: prev?.source ?? 'missing'
        };
      });
      setCandidates(base);

      if (base.length === 0) {
        setLookupStatus('idle');
        return;
      }

      setLookupStatus('loading');
      setLookupError('');
      try {
        const session = await ensureAuth();
        const response = await fetch('/api/v1/lexemes/lookup', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${session.apiKey}`
          },
          body: JSON.stringify({ headwords: base.map((item) => item.headword) })
        });
        if (!response.ok) {
          throw new Error('意味検索に失敗しました');
        }
        const data = (await response.json()) as {
          found: Array<{
            headwordNorm: string;
            entries: Array<{ meaning_ja: string }>;
          }>;
        };
        const foundMap = new Map(
          data.found.map((entry) => [
            entry.headwordNorm,
            entry.entries?.[0]?.meaning_ja ?? ''
          ])
        );
        setCandidates((prev) =>
          prev.map((item) => {
            const meaning = foundMap.get(item.headwordNorm);
            if (meaning) {
              return { ...item, meaning, source: 'found' };
            }
            return { ...item, source: 'missing' };
          })
        );
        setLookupStatus('done');
      } catch (error) {
        setLookupStatus('error');
        setLookupError((error as Error).message);
      }
    },
    [candidates]
  );

  const handleExtract = async () => {
    await extractFromText(ocrText);
  };

  const toggleCandidate = (candidateId: string) => {
    setCandidates((prev) =>
      prev.map((item) =>
        item.id === candidateId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const updateHeadword = (candidateId: string, headword: string) => {
    const nextHeadword = safeTrim(headword);
    setCandidates((prev) =>
      prev.map((item) => {
        if (item.id !== candidateId) return item;
        const nextHeadwordNorm = normalizeHeadword(nextHeadword);
        const source = nextHeadwordNorm !== item.headwordNorm ? 'missing' : item.source;
        return {
          ...item,
          headword: nextHeadword,
          headwordNorm: nextHeadwordNorm,
          source
        };
      })
    );
  };

  const updateMeaning = (candidateId: string, meaning: string) => {
    setCandidates((prev) =>
      prev.map((item) =>
        item.id === candidateId
          ? { ...item, meaning: safeTrim(meaning), source: 'missing' }
          : item
      )
    );
  };

  const selectedCandidates = useMemo(
    () => candidates.filter((item) => item.selected),
    [candidates]
  );
  const cutCandidates = useMemo(
    () => candidates.filter((item) => !item.selected),
    [candidates]
  );

  const canCreateDeck = useMemo(() => {
    if (!deckTitle.trim()) return false;
    if (selectedCandidates.length === 0) return false;
    return selectedCandidates.every(
      (item) => item.headwordNorm.length > 0 && item.meaning.trim().length > 0
    );
  }, [deckTitle, selectedCandidates]);

  const handleCreateDeck = async () => {
    if (!canCreateDeck) return;
    const title = deckTitle.trim();
    const deck = await createDeck(title);

    for (const item of selectedCandidates) {
      await addLexemeToDeck(deck.deckId, {
        headword: item.headword,
        meaningJa: item.meaning
      });
    }

    const commitEntriesMap = new Map<string, { headword: string; meaningJa: string }>();
    selectedCandidates
      .filter((item) => item.source === 'missing' && item.headwordNorm.length > 0)
      .forEach((item) => {
        if (!commitEntriesMap.has(item.headwordNorm)) {
          commitEntriesMap.set(item.headwordNorm, {
            headword: item.headword,
            meaningJa: item.meaning
          });
        }
      });
    const commitEntries = [...commitEntriesMap.values()];

    if (commitEntries.length > 0) {
      try {
        const session = await ensureAuth();
        await fetch('/api/v1/lexemes/commit', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${session.apiKey}`
          },
          body: JSON.stringify({ entries: commitEntries })
        });
      } catch {
        setStatus('クラウド保存に失敗しました（この端末には保存されています）');
      }
    }

    await incrementEvent('deck_created');
    setStatus('単語ノートを作りました。復習ページへ移動します。');
    window.history.pushState({}, '', `/review/${deck.deckId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <section className="section-grid">
      <div className="card">
        <h2>1. 写真を読み取る</h2>
        <p className="notice">写真と読み取り結果は、この端末の中だけで処理されます。</p>
        <label htmlFor="imageInput">写真をえらぶ（カメラ/ファイル）</label>
        <input
          id="imageInput"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImage(file);
          }}
        />
        <p className="badge">読み取り状態: {ocrStatusLabel[ocrStatus]}</p>
        {ocrError && <p className="counter">{ocrError}</p>}
        <label>読み取り結果（ここで直せます）</label>
        <textarea
          value={ocrText}
          onChange={(event) => setOcrText(event.target.value)}
          placeholder="文字がまちがっていたら、ここで直してください"
        />
        <button
          className="secondary"
          onClick={handleExtract}
          disabled={!ocrText.trim() || ocrStatus === 'running'}
        >
          単語をひろう
        </button>
      </div>

      <div className="card">
        <h2>2. 単語と意味をえらぶ</h2>
        <p className="notice">
          意味検索では単語だけ送信されます。本文ぜんぶは送信されません。
        </p>
        <p className="badge">意味検索: {lookupStatusLabel[lookupStatus]}</p>
        {lookupError && <p className="counter">{lookupError}</p>}
        <p className="counter">追加予定: {selectedCandidates.length}語</p>
        <div className="word-grid candidate-grid">
          {selectedCandidates.map((item) => (
            <div key={item.id} className="word-item candidate-item">
              <div className="candidate-row">
                <div>
                  <strong>単語</strong>
                  <small className="candidate-meta">出現 {item.count}回</small>
                </div>
                <button
                  className="secondary candidate-cut-button"
                  type="button"
                  onClick={() => toggleCandidate(item.id)}
                >
                  カット
                </button>
              </div>
              <input
                type="text"
                value={item.headword}
                placeholder="単語を修正"
                onChange={(event) => updateHeadword(item.id, event.target.value)}
              />
              {item.headwordNorm.length === 0 && (
                <div className="counter">単語を英字で入力してください</div>
              )}
              <input
                type="text"
                value={item.meaning}
                placeholder={item.source === 'found' ? '辞書の意味（必要なら直せる）' : '意味を入力'}
                maxLength={LIMITS.meaning}
                onChange={(event) => updateMeaning(item.id, event.target.value)}
              />
              {item.meaning.length === 0 && (
                <div className="counter">意味を入れてください</div>
              )}
            </div>
          ))}
          {selectedCandidates.length === 0 && (
            <p>追加予定の候補がありません。上で「単語をひろう」を押してね。</p>
          )}
          {cutCandidates.length > 0 && (
            <div className="cut-candidate-box">
              <p className="counter">カット中: {cutCandidates.length}語</p>
              <div className="word-grid">
                {cutCandidates.map((item) => (
                  <div key={item.id} className="word-item">
                    <div>
                      <strong>{item.headword}</strong>
                      <small className="candidate-meta">出現 {item.count}回</small>
                    </div>
                    <button
                      className="secondary candidate-cut-button"
                      type="button"
                      onClick={() => toggleCandidate(item.id)}
                    >
                      追加する
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>3. 単語ノートを作る</h2>
        <label>ノート名</label>
        <input
          type="text"
          value={deckTitle}
          onChange={(event) => setDeckTitle(event.target.value)}
          placeholder="例: テスト前の英単語"
        />
        <button onClick={handleCreateDeck} disabled={!canCreateDeck}>
          ノートを作って復習する
        </button>
        {status && <p className="counter">{status}</p>}
      </div>

      <div className="card">
        <h2>作ったノート</h2>
        {decks.length === 0 && <p>まだノートがありません。</p>}
        <div className="word-grid">
          {decks.map((deck) => (
            <div key={deck.deckId} className="word-item">
              <div>
                <strong>{deck.title}</strong>
                <br />
                <small>{deck.headwordNorms.length}語</small>
              </div>
              <Link className="pill" to={`/review/${deck.deckId}`}>
                復習する
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
