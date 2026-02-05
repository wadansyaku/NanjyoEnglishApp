import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { runOcr } from '../lib/ocr';
import { extractCandidates } from '../lib/words';
import { ensureAuth } from '../lib/auth';
import {
  addLexemeToDeck,
  createDeck,
  listDecks,
  normalizeHeadword,
  type Deck
} from '../db';

type Candidate = {
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
    setOcrStatus('running');
    setOcrError('');
    setLookupStatus('idle');
    setLookupError('');
    try {
      const text = await runOcr(file);
      setOcrText(text);
      setOcrStatus('done');
    } catch (error) {
      setOcrStatus('error');
      setOcrError((error as Error).message);
    }
  };

  const extractFromText = useCallback(
    async (text: string) => {
      const extracted = extractCandidates(text).slice(0, MAX_CANDIDATES);
      const prevMap = new Map(candidates.map((item) => [item.headwordNorm, item]));
      const base: Candidate[] = extracted.map((item) => {
        const headword = item.word;
        const headwordNorm = normalizeHeadword(headword);
        const prev = prevMap.get(headwordNorm);
        return {
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
          throw new Error('辞書検索に失敗しました');
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

  const toggleCandidate = (headwordNorm: string) => {
    setCandidates((prev) =>
      prev.map((item) =>
        item.headwordNorm === headwordNorm ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const updateMeaning = (headwordNorm: string, meaning: string) => {
    setCandidates((prev) =>
      prev.map((item) =>
        item.headwordNorm === headwordNorm
          ? { ...item, meaning: safeTrim(meaning), source: 'missing' }
          : item
      )
    );
  };

  const selectedCandidates = useMemo(
    () => candidates.filter((item) => item.selected),
    [candidates]
  );

  const canCreateDeck = useMemo(() => {
    if (!deckTitle.trim()) return false;
    if (selectedCandidates.length === 0) return false;
    return selectedCandidates.every((item) => item.meaning.trim().length > 0);
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

    const commitEntries = selectedCandidates
      .filter((item) => item.source === 'missing')
      .map((item) => ({ headword: item.headword, meaningJa: item.meaning }));

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
        setStatus('コミットに失敗しました（ローカル保存は完了）');
      }
    }

    setStatus('デッキを作成しました。レビューに移動します。');
    window.history.pushState({}, '', `/review/${deck.deckId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <section className="section-grid">
      <div className="card">
        <h2>1. 写真 & OCR</h2>
        <p className="notice">画像とOCR全文は端末内のみで処理します。</p>
        <label htmlFor="imageInput">画像を選択（カメラ/ファイル）</label>
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
        <p>
          OCR状態: {ocrStatus} {ocrError ? `(${ocrError})` : ''}
        </p>
        {ocrStatus === 'running' && <p>OCR実行中...</p>}
        <label>OCR結果（編集可）</label>
        <textarea
          value={ocrText}
          onChange={(event) => setOcrText(event.target.value)}
          placeholder="OCR結果を確認・修正してください"
        />
        <button
          className="secondary"
          onClick={handleExtract}
          disabled={!ocrText.trim() || ocrStatus === 'running'}
        >
          未知語抽出
        </button>
      </div>

      <div className="card">
        <h2>2. 未知語候補</h2>
        <p className="notice">
          辞書検索は単語のみ送信します。本文やOCR全文は送信しません。
        </p>
        {lookupStatus === 'loading' && <p>辞書検索中...</p>}
        {lookupError && <p className="counter">{lookupError}</p>}
        <div className="word-grid" style={{ maxHeight: 320, overflow: 'auto' }}>
          {candidates.map((item) => (
            <div key={item.headwordNorm} className="word-item">
              <div style={{ flex: 1 }}>
                <strong>{item.headword}</strong>
                <small> x{item.count}</small>
                <div style={{ marginTop: 6 }}>
                  <input
                    type="text"
                    value={item.meaning}
                    placeholder={item.source === 'found' ? '辞書候補' : '意味を入力'}
                    maxLength={LIMITS.meaning}
                    onChange={(event) => updateMeaning(item.headwordNorm, event.target.value)}
                    disabled={item.source === 'found'}
                  />
                  {item.source === 'missing' && item.meaning.length === 0 && (
                    <div className="counter">意味を入力してください</div>
                  )}
                </div>
              </div>
              <input
                type="checkbox"
                checked={item.selected}
                onChange={() => toggleCandidate(item.headwordNorm)}
              />
            </div>
          ))}
          {candidates.length === 0 && <p>候補がありません。</p>}
        </div>
      </div>

      <div className="card">
        <h2>3. デッキ作成 & レビュー開始</h2>
        <label>デッキ名</label>
        <input
          type="text"
          value={deckTitle}
          onChange={(event) => setDeckTitle(event.target.value)}
          placeholder="例: Textbook Unit 1"
        />
        <button onClick={handleCreateDeck} disabled={!canCreateDeck}>
          デッキ作成 → レビューへ
        </button>
        {status && <p className="counter">{status}</p>}
      </div>

      <div className="card">
        <h2>デッキ一覧</h2>
        {decks.length === 0 && <p>まだデッキがありません。</p>}
        <div className="word-grid">
          {decks.map((deck) => (
            <div key={deck.deckId} className="word-item">
              <div>
                <strong>{deck.title}</strong>
                <br />
                <small>{deck.headwordNorms.length} 語</small>
              </div>
              <Link className="pill" to={`/review/${deck.deckId}`}>
                レビュー
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
