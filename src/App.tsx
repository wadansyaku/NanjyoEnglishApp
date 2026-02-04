import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMITS } from '../shared/limits';
import { validateLexemeInput } from '../shared/validation';
import type { LexemeInput } from '../shared/types';
import { runOcr } from './lib/ocr';
import { extractCandidates } from './lib/words';
import { speak, stopSpeaking } from './lib/tts';
import {
  addXp,
  getNextDue,
  getProfile,
  listLexemes,
  recordReview,
  saveComposition,
  saveLexemes,
  saveRecording,
  syncLexemes
} from './db';
import type { Lexeme } from './db';

const sanitizeShort = (value: string) => value.replace(/[\r\n]+/g, ' ');

const normalizeForCompare = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z']/g, '')
    .trim();

const getWordDraft = (word: string, existing?: Lexeme): LexemeInput => ({
  headword: word,
  meaning: existing?.meaning || '',
  example: existing?.example || '',
  note: existing?.note || ''
});

export default function App() {
  const [ocrText, setOcrText] = useState('');
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ word: string; count: number }[]>([]);
  const [searchWord, setSearchWord] = useState('');
  const [selectedHeadwords, setSelectedHeadwords] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<LexemeInput[]>([]);
  const [lexemeList, setLexemeList] = useState<Lexeme[]>([]);
  const [syncState, setSyncState] = useState<string>('');
  const [profile, setProfile] = useState<{ xp: number; level: number; progress: number; next: number }>({
    xp: 0,
    level: 1,
    progress: 0,
    next: 120
  });
  const [due, setDue] = useState<{ lexeme: Lexeme; srs: { dueAt: number } } | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [practiceWord, setPracticeWord] = useState('');
  const [dictationInput, setDictationInput] = useState('');
  const [dictationResult, setDictationResult] = useState('');
  const [composition, setComposition] = useState('');
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);

  const filteredCandidates = useMemo(() => {
    if (!searchWord.trim()) return candidates;
    return candidates.filter((item) => item.word.includes(searchWord.toLowerCase()));
  }, [candidates, searchWord]);

  const loadState = useCallback(async () => {
    const [lexemes, nextDue, profileData] = await Promise.all([
      listLexemes(),
      getNextDue(),
      getProfile()
    ]);
    setLexemeList(lexemes);
    setDue(nextDue);
    setProfile({
      xp: profileData.xp,
      level: profileData.level,
      progress: profileData.xp % 120,
      next: 120
    });
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);


  useEffect(() => {
    if (!practiceWord && lexemeList.length > 0) {
      setPracticeWord(lexemeList[0].headword);
    }
  }, [practiceWord, lexemeList]);

  const handleImage = async (file: File) => {
    setOcrStatus('running');
    setOcrError(null);
    setOcrText('');
    setCandidates([]);
    try {
      const text = await runOcr(file);
      setOcrText(text);
      setCandidates(extractCandidates(text));
      setOcrStatus('done');
    } catch (error) {
      setOcrError((error as Error).message);
      setOcrStatus('error');
    }
  };

  const toggleHeadword = (word: string) => {
    setSelectedHeadwords((prev) => {
      const next = new Set(prev);
      if (next.has(word)) {
        next.delete(word);
      } else {
        next.add(word);
      }
      return next;
    });
  };

  const prepareDrafts = () => {
    const map = new Map(lexemeList.map((lexeme) => [lexeme.headword, lexeme]));
    const selected = [...selectedHeadwords];
    const newDrafts = selected.map((word) => getWordDraft(word, map.get(word)));
    setDrafts(newDrafts);
  };

  const updateDraft = (index: number, field: 'headword' | 'meaning' | 'example' | 'note', value: string) => {
    setDrafts((prev) => {
      const next = [...prev];
      const current = { ...next[index] };
      if (field === 'headword') {
        current.headword = value;
      } else {
        current[field] = sanitizeShort(value);
      }
      next[index] = current;
      return next;
    });
  };

  const draftsValid = useMemo(() => {
    if (drafts.length === 0) return false;
    return drafts.every((draft) => validateLexemeInput(draft).ok);
  }, [drafts]);

  const handleSaveDrafts = async () => {
    if (!draftsValid) return;
    await saveLexemes(drafts);
    setDrafts([]);
    setSelectedHeadwords(new Set());
    await loadState();
  };

  const handleSync = async () => {
    setSyncState('同期中...');
    try {
      const result = await syncLexemes();
      setSyncState(`同期完了: ${result.synced} 件 (残り ${result.remaining} 件)`);
      await loadState();
    } catch (error) {
      setSyncState(`同期エラー: ${(error as Error).message}`);
    }
  };

  const handleReview = async (result: 'again' | 'good' | 'easy') => {
    if (!due) return;
    await recordReview(due.lexeme.headword, result);
    setShowAnswer(false);
    await loadState();
  };

  const handleSpeak = () => {
    const lexeme = lexemeList.find((item) => item.headword === practiceWord);
    if (!lexeme) return;
    const target = lexeme.example || lexeme.meaning || lexeme.headword;
    const ok = speak(target);
    if (!ok) {
      setDictationResult('TTSが利用できません。');
    }
  };

  const checkDictation = () => {
    const lexeme = lexemeList.find((item) => item.headword === practiceWord);
    if (!lexeme) return;
    const target = lexeme.example || lexeme.headword;
    const normalizedTarget = normalizeForCompare(target);
    const normalizedInput = normalizeForCompare(dictationInput);
    if (!normalizedInput) {
      setDictationResult('入力が空です。');
      return;
    }
    setDictationResult(
      normalizedInput === normalizedTarget ? '一致しました！' : `違いました。正解: ${target}`
    );
  };

  const handleSaveComposition = async () => {
    if (!practiceWord || !composition.trim()) return;
    await saveComposition(practiceWord, composition.trim());
    setComposition('');
    await loadState();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setDictationResult('録音が利用できません。');
      return;
    }
    if (recording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      setRecordingBlob(blob);
      setRecordingUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start();
    setRecording(recorder);
  };

  const stopRecording = () => {
    if (!recording) return;
    recording.stop();
    setRecording(null);
  };

  const handleSaveRecording = async () => {
    if (!recordingBlob || !practiceWord) return;
    await saveRecording(practiceWord, recordingBlob);
    setRecordingBlob(null);
    await loadState();
  };

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
      }
    };
  }, [recordingUrl]);

  const handleQuickXp = async () => {
    await addXp(4);
    await loadState();
  };

  return (
    <main>
      <header>
        <h1>1セッション英語学習フロー</h1>
        <p>
          画像→OCR→未知語→ミニ単語帳→SRS→リスニング→英作→スピーキングまで。
          画像や本文は端末内のみで処理します。
        </p>
        <div className="pill-group">
          <span className="pill">Level {profile.level}</span>
          <span className="pill">
            XP {profile.progress}/{profile.next}
          </span>
          <span className="pill">語彙数 {lexemeList.length}</span>
        </div>
      </header>

      <section className="section-grid">
        <div className="card">
          <h2>1. 撮影 & OCR</h2>
          <p className="notice">
            OCR全文や画像はクラウドに送信されません。端末内で処理します。
          </p>
          <label htmlFor="imageInput">教科書の写真を選択</label>
          <input
            id="imageInput"
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImage(file);
            }}
          />
          <p>
            状態: {ocrStatus}
            {ocrError ? ` (${ocrError})` : ''}
          </p>
          <label>OCR結果（ローカル）</label>
          <textarea value={ocrText} readOnly placeholder="OCR結果がここに表示されます" />
        </div>

        <div className="card">
          <h2>2. 未知語の選定</h2>
          <label>フィルタ</label>
          <input
            type="search"
            placeholder="単語を検索"
            value={searchWord}
            onChange={(event) => setSearchWord(event.target.value)}
          />
          <div className="word-grid" style={{ maxHeight: 280, overflow: 'auto', marginTop: 12 }}>
            {filteredCandidates.map((item) => (
              <label key={item.word} className="word-item">
                <span>
                  {item.word} <small>x{item.count}</small>
                </span>
                <input
                  type="checkbox"
                  checked={selectedHeadwords.has(item.word)}
                  onChange={() => toggleHeadword(item.word)}
                />
              </label>
            ))}
          </div>
          <button className="secondary" onClick={prepareDrafts} disabled={selectedHeadwords.size === 0}>
            ミニ単語帳へ
          </button>
        </div>

        <div className="card">
          <h2>3. ミニ単語帳</h2>
          <p className="notice">
            meaning/example/noteは短文のみ。改行は禁止。長文は送信不可です。
          </p>
          {drafts.length === 0 && <p>未知語を選択するとここに表示されます。</p>}
          {drafts.map((draft, index) => {
            const result = validateLexemeInput(draft);
            return (
              <div key={draft.headword + index} style={{ marginBottom: 16 }}>
                <label>Headword</label>
                <input
                  type="text"
                  value={draft.headword}
                  maxLength={LIMITS.headword}
                  onChange={(event) => updateDraft(index, 'headword', event.target.value)}
                />
                <label>Meaning ({LIMITS.meaning}文字以内)</label>
                <input
                  type="text"
                  value={draft.meaning ?? ''}
                  maxLength={LIMITS.meaning}
                  onChange={(event) => updateDraft(index, 'meaning', event.target.value)}
                />
                <label>Example ({LIMITS.example}文字以内)</label>
                <textarea
                  value={draft.example ?? ''}
                  maxLength={LIMITS.example}
                  onChange={(event) => updateDraft(index, 'example', event.target.value)}
                />
                <label>Note ({LIMITS.note}文字以内)</label>
                <input
                  type="text"
                  value={draft.note ?? ''}
                  maxLength={LIMITS.note}
                  onChange={(event) => updateDraft(index, 'note', event.target.value)}
                />
                {!result.ok && (
                  <p className="counter">
                    {result.errors.map((error) => `${error.field}: ${error.message}`).join(' / ')}
                  </p>
                )}
                <hr />
              </div>
            );
          })}
          <button onClick={handleSaveDrafts} disabled={!draftsValid}>
            ローカルに保存 & 同期キュー
          </button>
          <button className="secondary" onClick={handleSync} style={{ marginLeft: 8 }}>
            クラウドへバッチ同期
          </button>
          {syncState && <p>{syncState}</p>}
        </div>

        <div className="card">
          <h2>4. SRS 想起</h2>
          <p className="notice">SRSログは端末内（IndexedDB）に保存されます。</p>
          {due ? (
            <div>
              <div className="badge">次の単語: {due.lexeme.headword}</div>
              {showAnswer ? (
                <div>
                  <p>Meaning: {due.lexeme.meaning || '—'}</p>
                  <p>Example: {due.lexeme.example || '—'}</p>
                </div>
              ) : (
                <button className="secondary" onClick={() => setShowAnswer(true)}>
                  答えを見る
                </button>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => handleReview('again')}>Again</button>
                <button onClick={() => handleReview('good')}>Good</button>
                <button onClick={() => handleReview('easy')}>Easy</button>
              </div>
            </div>
          ) : (
            <p>未復習の単語がありません。</p>
          )}
        </div>

        <div className="card">
          <h2>5. リスニング (TTS / ディクテ)</h2>
          <label>単語を選択</label>
          <select value={practiceWord} onChange={(event) => setPracticeWord(event.target.value)}>
            {lexemeList.map((lexeme) => (
              <option key={lexeme.headword} value={lexeme.headword}>
                {lexeme.headword}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleSpeak} disabled={!practiceWord}>
              TTSで再生
            </button>
            <button className="secondary" onClick={() => stopSpeaking()}>
              停止
            </button>
          </div>
          <label style={{ marginTop: 12 }}>聞き取った内容</label>
          <input
            type="text"
            value={dictationInput}
            onChange={(event) => setDictationInput(event.target.value)}
          />
          <button className="secondary" onClick={checkDictation} style={{ marginTop: 8 }}>
            判定
          </button>
          {dictationResult && <p>{dictationResult}</p>}
        </div>

        <div className="card">
          <h2>6. 英作</h2>
          <label>英作を入力</label>
          <textarea value={composition} onChange={(event) => setComposition(event.target.value)} />
          <button onClick={handleSaveComposition} disabled={!practiceWord || !composition.trim()}>
            保存してXP獲得
          </button>
        </div>

        <div className="card">
          <h2>7. スピーキング (録音)</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={startRecording} disabled={!!recording}>
              録音開始
            </button>
            <button className="secondary" onClick={stopRecording} disabled={!recording}>
              停止
            </button>
            <button
              className="secondary"
              onClick={handleSaveRecording}
              disabled={!recordingBlob || !practiceWord}
            >
              保存
            </button>
          </div>
          {recordingUrl && (
            <audio style={{ marginTop: 12, width: '100%' }} controls src={recordingUrl} />
          )}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <div className="card">
          <h2>キャラクター育成</h2>
          <p>
            SRSやアウトプットでXPが加算されます。作業量ではなく学習行動に連動する設計です。
          </p>
          <button className="secondary" onClick={handleQuickXp}>
            デモ用: 小さな報酬
          </button>
        </div>
      </section>
    </main>
  );
}
