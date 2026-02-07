import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from '../lib/router';
import { ensureAuth } from '../lib/auth';
import { saveLastOcrMetrics } from '../lib/feedbackMeta';
import { cancelOcr, fileToDataUrl, runOcr, sanitizeShortText, type OcrPsm } from '../lib/ocr';
import {
  prepareOcrImage,
  type CropRect,
  type OcrPreprocessOptions
} from '../lib/ocrImage';
import { extractCandidates } from '../lib/words';
import {
  addLexemeToDeck,
  createDeck,
  incrementEvent,
  listDecks,
  normalizeHeadword,
  type Deck
} from '../db';
import type { AppSettings } from '../lib/settings';

type ToastType = 'info' | 'success' | 'error';

type ScanPageProps = {
  settings: AppSettings;
  showToast: (message: string, type?: ToastType) => void;
  navigate: (to: string) => void;
};

type Candidate = {
  id: string;
  headword: string;
  headwordNorm: string;
  count: number;
  selected: boolean;
  meaning: string;
  source: 'found' | 'missing';
  quality: 'ok' | 'review';
};

type ScanStep = 1 | 2 | 3 | 4 | 5;

type LookupState = 'idle' | 'loading' | 'done' | 'error';

const MAX_CANDIDATES = 12;
const LIMITS = {
  meaning: 80
};

const STEP_LABELS: Array<{ id: ScanStep; title: string; hint: string }> = [
  { id: 1, title: '画像を選ぶ', hint: 'カメラかファイルを選択' },
  { id: 2, title: '範囲を切り取る', hint: '本文だけを四角で指定' },
  { id: 3, title: 'OCRを実行', hint: '前処理・PSMを調整可能' },
  { id: 4, title: '単語を選ぶ', hint: '意味入力と取捨選択' },
  { id: 5, title: 'ノート作成', hint: '作成して復習開始' }
];

const LOOKUP_STATUS_LABEL: Record<LookupState, string> = {
  idle: 'まだ検索していません',
  loading: '辞書検索中…',
  done: '検索が終わりました',
  error: '検索に失敗しました'
};

const getPointFromEvent = (
  event: PointerEvent<HTMLDivElement>,
  container: HTMLDivElement
) => {
  const rect = container.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  };
};

const normalizeCropRect = (cropRect: CropRect): CropRect => {
  const x = Math.min(1, Math.max(0, cropRect.x));
  const y = Math.min(1, Math.max(0, cropRect.y));
  const width = Math.min(1 - x, Math.max(0.02, cropRect.width));
  const height = Math.min(1 - y, Math.max(0.02, cropRect.height));
  return { x, y, width, height };
};

const inferQuality = (word: string): 'ok' | 'review' => {
  if (/[^a-z']/i.test(word)) return 'review';
  if (word.length > 16) return 'review';
  return 'ok';
};

const sortCandidates = (items: Candidate[], mode: 'freq' | 'alpha') => {
  return [...items].sort((a, b) => {
    if (mode === 'alpha') {
      return a.headword.localeCompare(b.headword);
    }
    return b.count - a.count || a.headword.localeCompare(b.headword);
  });
};

export default function ScanPage({ settings, showToast, navigate }: ScanPageProps) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [currentStep, setCurrentStep] = useState<ScanStep>(1);
  const [deckTitle, setDeckTitle] = useState('');
  const [status, setStatus] = useState('');

  const [imageDataUrl, setImageDataUrl] = useState('');
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropAreaRef = useRef<HTMLDivElement | null>(null);

  const [ocrPsm, setOcrPsm] = useState<OcrPsm>(settings.defaultPsm);
  const [preprocessOptions, setPreprocessOptions] =
    useState<OcrPreprocessOptions>(settings.defaultPreprocess);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrDurationMs, setOcrDurationMs] = useState(0);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [beforeDataUrl, setBeforeDataUrl] = useState('');
  const [afterDataUrl, setAfterDataUrl] = useState('');
  const [preprocessMs, setPreprocessMs] = useState(0);

  const [lookupStatus, setLookupStatus] = useState<LookupState>('idle');
  const [lookupError, setLookupError] = useState('');
  const [sortMode, setSortMode] = useState<'freq' | 'alpha'>('freq');
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const loadDecks = useCallback(async () => {
    const items = await listDecks();
    setDecks(items);
  }, []);

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  useEffect(() => {
    setOcrPsm(settings.defaultPsm);
    setPreprocessOptions(settings.defaultPreprocess);
  }, [settings.defaultPsm, settings.defaultPreprocess]);

  const selectedCandidates = useMemo(
    () => sortCandidates(candidates.filter((item) => item.selected), sortMode),
    [candidates, sortMode]
  );

  const cutCandidates = useMemo(
    () => sortCandidates(candidates.filter((item) => !item.selected), sortMode),
    [candidates, sortMode]
  );

  const canCreateDeck = useMemo(() => {
    if (!deckTitle.trim()) return false;
    if (selectedCandidates.length === 0) return false;
    return selectedCandidates.every(
      (item) => item.headwordNorm.length > 0 && item.meaning.trim().length > 0
    );
  }, [deckTitle, selectedCandidates]);

  const handleImageSelect = async (file: File) => {
    await incrementEvent('scan_started');
    const dataUrl = await fileToDataUrl(file);
    setImageDataUrl(dataUrl);
    setCropRect({ x: 0, y: 0, width: 1, height: 1 });
    setCurrentStep(2);
    setOcrText('');
    setCandidates([]);
    setLookupStatus('idle');
    setLookupError('');
    setOcrError('');
    setStatus('');
    setBeforeDataUrl('');
    setAfterDataUrl('');
    showToast('画像を読み込みました。本文の範囲を選んでください。', 'success');
  };

  const handleCropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageDataUrl || !cropAreaRef.current) return;
    const point = getPointFromEvent(event, cropAreaRef.current);
    dragStartRef.current = point;
    setIsDraggingCrop(true);
    setCropRect({ x: point.x, y: point.y, width: 0.001, height: 0.001 });
  };

  const handleCropPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCrop || !dragStartRef.current || !cropAreaRef.current) return;
    const current = getPointFromEvent(event, cropAreaRef.current);
    const start = dragStartRef.current;

    const nextCrop = normalizeCropRect({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y)
    });

    setCropRect(nextCrop);
  };

  const handleCropPointerUp = () => {
    if (!isDraggingCrop) return;
    setIsDraggingCrop(false);
    dragStartRef.current = null;
    setCropRect((prev) => normalizeCropRect(prev));
  };

  const buildCandidatesFromText = useCallback(
    async (text: string) => {
      const extracted = extractCandidates(text).slice(0, MAX_CANDIDATES);
      if (extracted.length === 0) {
        setCandidates([]);
        setLookupStatus('idle');
        return;
      }

      const base: Candidate[] = extracted.map((item, index) => {
        const headword = sanitizeShortText(item.word, 40);
        const headwordNorm = normalizeHeadword(headword);
        return {
          id: `${headwordNorm}:${index}`,
          headword,
          headwordNorm,
          count: item.count,
          selected: true,
          meaning: '',
          source: 'missing',
          quality: item.quality
        };
      });
      setCandidates(base);

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
          // Never send OCR全文: headword 配列のみ送信
          body: JSON.stringify({ headwords: base.map((item) => item.headword) })
        });

        if (!response.ok) {
          throw new Error('辞書検索に失敗しました。');
        }

        const data = (await response.json()) as {
          found: Array<{ headwordNorm: string; entries: Array<{ meaning_ja: string }> }>;
        };

        const foundMap = new Map(
          data.found.map((entry) => [entry.headwordNorm, entry.entries?.[0]?.meaning_ja ?? ''])
        );

        setCandidates((prev) =>
          prev.map((item) => {
            const foundMeaning = foundMap.get(item.headwordNorm);
            if (foundMeaning) {
              return {
                ...item,
                source: 'found',
                meaning: sanitizeShortText(foundMeaning, LIMITS.meaning)
              };
            }
            return item;
          })
        );
        setLookupStatus('done');
      } catch (error) {
        setLookupStatus('error');
        setLookupError((error as Error).message);
      }
    },
    []
  );

  const handleRunOcr = async () => {
    if (!imageDataUrl) {
      showToast('先に画像を選んでください。', 'error');
      return;
    }

    setOcrRunning(true);
    setOcrError('');

    try {
      const prepared = await prepareOcrImage(imageDataUrl, cropRect, preprocessOptions);
      setBeforeDataUrl(prepared.beforeDataUrl);
      setAfterDataUrl(prepared.afterDataUrl);
      setPreprocessMs(prepared.timings.cropMs + prepared.timings.preprocessMs);

      const result = await runOcr(prepared.afterDataUrl, { psm: ocrPsm });
      const text = result.text.trim();

      setOcrText(text);
      setOcrDurationMs(result.durationMs);
      setOcrConfidence(result.confidence);
      setCurrentStep(4);

      saveLastOcrMetrics({
        preprocessMs: prepared.timings.cropMs + prepared.timings.preprocessMs,
        ocrMs: result.durationMs,
        confidence: result.confidence,
        psm: ocrPsm,
        timestamp: new Date().toISOString()
      });

      await incrementEvent('ocr_done');
      await buildCandidatesFromText(text);
      showToast('OCRが完了しました。単語を確認してください。', 'success');
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes('canceled')) {
        showToast('OCRをキャンセルしました。', 'info');
      } else {
        setOcrError(message);
        showToast(message, 'error');
      }
    } finally {
      setOcrRunning(false);
    }
  };

  const handleCancelOcr = () => {
    cancelOcr();
    setOcrRunning(false);
  };

  const handleRebuildCandidates = async () => {
    await buildCandidatesFromText(ocrText);
    setCurrentStep(4);
  };

  const toggleCandidate = (candidateId: string) => {
    setCandidates((prev) =>
      prev.map((item) =>
        item.id === candidateId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const updateHeadword = (candidateId: string, nextHeadword: string) => {
    setCandidates((prev) =>
      prev.map((item) => {
        if (item.id !== candidateId) return item;
        const headword = sanitizeShortText(nextHeadword, 40);
        const headwordNorm = normalizeHeadword(headword);
        return {
          ...item,
          headword,
          headwordNorm,
          source: 'missing',
          quality: inferQuality(headword)
        };
      })
    );
  };

  const updateMeaning = (candidateId: string, nextMeaning: string) => {
    setCandidates((prev) =>
      prev.map((item) =>
        item.id === candidateId
          ? {
              ...item,
              meaning: sanitizeShortText(nextMeaning, LIMITS.meaning),
              source: 'missing'
            }
          : item
      )
    );
  };

  const selectAllCandidates = () => {
    setCandidates((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const clearAllCandidates = () => {
    setCandidates((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

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
        showToast('クラウド保存に失敗しました（端末保存は完了）', 'error');
      }
    }

    await incrementEvent('deck_created');
    await loadDecks();
    setStatus('単語ノートを作りました。レビューへ移動します。');
    showToast('ノートを作成しました。', 'success');
    navigate(`/review/${deck.deckId}`);
  };

  return (
    <section className="section-grid">
      <div className="card">
        <h2>Scanウィザード</h2>
        <div className="scan-stepper">
          {STEP_LABELS.map((step) => (
            <button
              key={step.id}
              type="button"
              className={`scan-step-pill ${step.id === currentStep ? 'active' : ''}`}
              onClick={() => {
                if (step.id <= currentStep) {
                  setCurrentStep(step.id);
                }
              }}
              disabled={step.id > currentStep}
            >
              <span>{step.id}</span>
              <small>{step.title}</small>
            </button>
          ))}
        </div>

        {currentStep === 1 && (
          <div className="scan-step-content">
            <p className="notice">文字がはっきり写るように、明るい場所で本文に近づいて撮影してください。</p>
            <label htmlFor="imageInput">画像を選択（カメラ/ファイル）</label>
            <input
              id="imageInput"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImageSelect(file);
              }}
            />
          </div>
        )}

        {currentStep === 2 && (
          <div className="scan-step-content">
            {!imageDataUrl && <p>先に画像を選択してください。</p>}
            {imageDataUrl && (
              <>
                <p className="counter">本文だけをドラッグで囲ってください。</p>
                <div
                  ref={cropAreaRef}
                  className="crop-area"
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerUp}
                  onPointerLeave={handleCropPointerUp}
                >
                  <img src={imageDataUrl} alt="OCR対象画像" className="crop-image" />
                  <div
                    className="crop-rect"
                    style={{
                      left: `${cropRect.x * 100}%`,
                      top: `${cropRect.y * 100}%`,
                      width: `${cropRect.width * 100}%`,
                      height: `${cropRect.height * 100}%`
                    }}
                  />
                </div>
                <div className="scan-inline-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setCropRect({ x: 0, y: 0, width: 1, height: 1 })}
                  >
                    全体を選択
                  </button>
                  <button type="button" onClick={() => setCurrentStep(3)}>
                    この範囲で次へ
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {currentStep === 3 && (
          <div className="scan-step-content">
            <p className="notice">OCR結果は端末内で処理され、サーバには送信されません。</p>
            <label>PSM（文字分割モード）</label>
            <select value={ocrPsm} onChange={(event) => setOcrPsm(event.target.value as OcrPsm)}>
              <option value="6">6: 本文ブロック向け（おすすめ）</option>
              <option value="11">11: ばらけた文字向け</option>
              <option value="7">7: 1行だけ読む</option>
            </select>

            <details className="scan-details">
              <summary>前処理の設定</summary>
              <div className="scan-option-grid">
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={preprocessOptions.grayscale}
                    onChange={(event) =>
                      setPreprocessOptions((prev) => ({ ...prev, grayscale: event.target.checked }))
                    }
                  />
                  <span>グレースケール</span>
                </label>
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={preprocessOptions.threshold}
                    onChange={(event) =>
                      setPreprocessOptions((prev) => ({ ...prev, threshold: event.target.checked }))
                    }
                  />
                  <span>二値化</span>
                </label>
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={preprocessOptions.invert}
                    onChange={(event) =>
                      setPreprocessOptions((prev) => ({ ...prev, invert: event.target.checked }))
                    }
                  />
                  <span>白黒反転</span>
                </label>
              </div>
              <label>Threshold: {Math.round(preprocessOptions.thresholdValue)}</label>
              <input
                type="range"
                min={0}
                max={255}
                value={preprocessOptions.thresholdValue}
                onChange={(event) =>
                  setPreprocessOptions((prev) => ({
                    ...prev,
                    thresholdValue: Number(event.target.value)
                  }))
                }
              />
              <label>Contrast: {preprocessOptions.contrast.toFixed(2)}</label>
              <input
                type="range"
                min={0.6}
                max={1.8}
                step={0.02}
                value={preprocessOptions.contrast}
                onChange={(event) =>
                  setPreprocessOptions((prev) => ({ ...prev, contrast: Number(event.target.value) }))
                }
              />
              <label>Brightness: {Math.round(preprocessOptions.brightness)}</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={1}
                value={preprocessOptions.brightness}
                onChange={(event) =>
                  setPreprocessOptions((prev) => ({ ...prev, brightness: Number(event.target.value) }))
                }
              />
            </details>

            <div className="scan-inline-actions">
              {!ocrRunning && (
                <button type="button" onClick={handleRunOcr}>
                  OCRを実行
                </button>
              )}
              {ocrRunning && (
                <>
                  <button type="button" disabled>
                    OCR実行中…
                  </button>
                  <button className="secondary" type="button" onClick={handleCancelOcr}>
                    キャンセル
                  </button>
                </>
              )}
            </div>
            {ocrError && <p className="counter">{ocrError}</p>}

            {settings.ocrDebug && beforeDataUrl && afterDataUrl && (
              <div className="scan-debug-grid">
                <div>
                  <p className="counter">前処理前</p>
                  <img src={beforeDataUrl} alt="前処理前" className="debug-image" />
                </div>
                <div>
                  <p className="counter">前処理後</p>
                  <img src={afterDataUrl} alt="前処理後" className="debug-image" />
                </div>
                <div className="scan-debug-metrics">
                  <p className="counter">前処理時間: {Math.round(preprocessMs)}ms</p>
                  <p className="counter">OCR時間: {Math.round(ocrDurationMs)}ms</p>
                  <p className="counter">
                    信頼度: {ocrConfidence == null ? '取得なし' : `${ocrConfidence.toFixed(1)}%`}
                  </p>
                  <p className="counter">PSM: {ocrPsm}</p>
                </div>
              </div>
            )}

            {ocrText && (
              <>
                <label>OCR結果（ここで修正できます）</label>
                <textarea
                  value={ocrText}
                  onChange={(event) => setOcrText(event.target.value)}
                  placeholder="OCR結果を確認して修正"
                />
                <div className="scan-inline-actions">
                  <button className="secondary" type="button" onClick={handleRebuildCandidates}>
                    このテキストで候補を再作成
                  </button>
                  <button type="button" onClick={() => setCurrentStep(4)}>
                    候補選択へ進む
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {currentStep === 4 && (
          <div className="scan-step-content">
            <p className="badge">辞書検索: {LOOKUP_STATUS_LABEL[lookupStatus]}</p>
            {lookupError && <p className="counter">{lookupError}</p>}
            <div className="scan-toolbar">
              <div className="scan-inline-actions">
                <button className="secondary" type="button" onClick={selectAllCandidates}>
                  Select all
                </button>
                <button className="secondary" type="button" onClick={clearAllCandidates}>
                  Clear
                </button>
              </div>
              <label>
                ソート
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as 'freq' | 'alpha')}
                >
                  <option value="freq">頻度順</option>
                  <option value="alpha">アルファベット順</option>
                </select>
              </label>
            </div>

            <p className="counter">追加予定: {selectedCandidates.length}語</p>
            <div className="word-grid candidate-grid">
              {selectedCandidates.map((item) => (
                <div key={item.id} className="word-item candidate-item">
                  <div className="candidate-row">
                    <div>
                      <strong>{item.quality === 'review' ? '単語（要確認）' : '単語'}</strong>
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
                    <div className="counter">英字の単語を入れてください</div>
                  )}
                  <input
                    type="text"
                    value={item.meaning}
                    placeholder={
                      item.source === 'found' ? '辞書の意味（必要なら修正）' : '意味を入力'
                    }
                    maxLength={LIMITS.meaning}
                    onChange={(event) => updateMeaning(item.id, event.target.value)}
                  />
                  {item.meaning.length === 0 && <div className="counter">意味を入力してください</div>}
                </div>
              ))}

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

            <div className="scan-inline-actions">
              <button className="secondary" type="button" onClick={() => setCurrentStep(3)}>
                OCRステップに戻る
              </button>
              <button type="button" onClick={() => setCurrentStep(5)}>
                ノート作成へ
              </button>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="scan-step-content">
            <label>ノート名</label>
            <input
              type="text"
              value={deckTitle}
              onChange={(event) => setDeckTitle(sanitizeShortText(event.target.value, 60))}
              placeholder="例: Unit1 テスト前"
            />
            <button type="button" onClick={handleCreateDeck} disabled={!canCreateDeck}>
              ノートを作って復習を始める
            </button>
            {status && <p className="counter">{status}</p>}
            <p className="counter">カットした候補は保存対象から除外されています。</p>
          </div>
        )}
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
