import { useCallback, useEffect, useState } from 'react';
import { Link } from '../lib/router';
import {
  addLexemeToDeck,
  createDeck,
  listDecks,
  type Deck
} from '../db';

export default function ScanPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>('');
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [headword, setHeadword] = useState('');
  const [meaningJa, setMeaningJa] = useState('');
  const [status, setStatus] = useState('');

  const loadDecks = useCallback(
    async (selectFirst = false) => {
      const items = await listDecks();
      setDecks(items);
      if (selectFirst && items.length > 0) {
        setSelectedDeckId(items[0].deckId);
      }
    },
    [setDecks, setSelectedDeckId]
  );

  useEffect(() => {
    void loadDecks(true);
  }, [loadDecks]);

  const handleCreateDeck = async () => {
    const title = newDeckTitle.trim();
    if (!title) return;
    const deck = await createDeck(title);
    setNewDeckTitle('');
    await loadDecks();
    setSelectedDeckId(deck.deckId);
    setStatus('デッキを作成しました。');
  };

  const handleAddLexeme = async () => {
    const deckId = selectedDeckId;
    const word = headword.trim();
    const meaning = meaningJa.trim();
    if (!deckId || !word || !meaning) return;
    await addLexemeToDeck(deckId, { headword: word, meaningJa: meaning });
    setHeadword('');
    setMeaningJa('');
    setStatus('単語を追加しました。');
    await loadDecks();
  };

  return (
    <section className="section-grid">
      <div className="card">
        <h2>デッキを作る</h2>
        <label>新規デッキ名</label>
        <input
          type="text"
          value={newDeckTitle}
          onChange={(event) => setNewDeckTitle(event.target.value)}
        />
        <button onClick={handleCreateDeck} disabled={!newDeckTitle.trim()}>
          デッキ作成
        </button>
      </div>

      <div className="card">
        <h2>単語を追加</h2>
        <label>デッキ選択</label>
        <select
          value={selectedDeckId}
          onChange={(event) => setSelectedDeckId(event.target.value)}
        >
          <option value="">-- 選択 --</option>
          {decks.map((deck) => (
            <option key={deck.deckId} value={deck.deckId}>
              {deck.title} ({deck.headwordNorms.length})
            </option>
          ))}
        </select>
        <label style={{ marginTop: 12 }}>Headword</label>
        <input
          type="text"
          value={headword}
          onChange={(event) => setHeadword(event.target.value)}
        />
        <label>意味（日本語）</label>
        <input
          type="text"
          value={meaningJa}
          onChange={(event) => setMeaningJa(event.target.value)}
        />
        <button
          onClick={handleAddLexeme}
          disabled={!selectedDeckId || !headword.trim() || !meaningJa.trim()}
        >
          デッキに追加
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
