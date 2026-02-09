import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from '../lib/router';
import { ensureAuth } from '../lib/auth';
import { saveLastOcrMetrics } from '../lib/feedbackMeta';
import { cancelOcr, fileToDataUrl, runOcr, sanitizeShortText, type OcrPsm } from '../lib/ocr';
import {
  compressImageForCloud,
  prepareOcrImage,
  type CropRect,
  type OcrPreprocessOptions
} from '../lib/ocrImage';
import { extractCandidates } from '../lib/words';
import {
  addLexemeToDeck,
  createDeck,
  getMasteredHeadwordNormSet,
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
  aiSuggested: boolean;
  mastered: boolean;
};

// 5ステップを維持しつつ、用語を中学生向けに改善
type ScanStep = 1 | 2 | 3 | 4 | 5;

type LookupState = 'idle' | 'loading' | 'done' | 'error';

type OcrMode = 'local' | 'cloud';

const MAX_CANDIDATES = 12;
const LIMITS = {
  meaning: 80
};

// 用語を中学生向けに改善（OCR→文字読取、ウィザード→ステップ）
const STEP_LABELS: Array<{ id: ScanStep; title: string; hint: string }> = [
  { id: 1, title: '📷 写真を選ぶ', hint: '教科書の写真を撮影' },
  { id: 2, title: '✂️ 範囲を選ぶ', hint: '読み取る場所を指定' },
  { id: 3, title: '📖 文字を読取', hint: '自動で文字認識' },
  { id: 4, title: '✏️ 単語を選ぶ', hint: '意味を入力' },
  { id: 5, title: '✅ 完成', hint: '単語帳を作成' }
];

const LOOKUP_STATUS_LABEL: Record<LookupState, string> = {
  idle: 'まだ検索していません',
  loading: '辞書検索中…',
  done: '検索が終わりました',
  error: '検索に失敗しました'
};

const getPointFromEvent = (event: PointerEvent<HTMLDivElement>, container: HTMLDivElement) => {
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

const createCandidates = (
  rows: Array<{ word: string; count: number; quality: 'ok' | 'review' }>
): Candidate[] => {
  return rows.slice(0, MAX_CANDIDATES).map((item, index) => {
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
      quality: item.quality,
      aiSuggested: false,
      mastered: false
    };
  });
};

const createCandidatesFromHeadwords = (headwords: string[]) => {
  const stats = new Map<string, { word: string; count: number; quality: 'ok' | 'review' }>();
  for (const raw of headwords) {
    const word = sanitizeShortText(raw, 40);
    const headwordNorm = normalizeHeadword(word);
    if (!headwordNorm) continue;
    const current = stats.get(headwordNorm);
    const quality = inferQuality(word);
    if (current) {
      current.count += 1;
      if (quality === 'review') current.quality = 'review';
      continue;
    }
    stats.set(headwordNorm, {
      word,
      count: 1,
      quality
    });
  }
  return createCandidates(
    [...stats.values()]
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
      .map((item) => ({ word: item.word, count: item.count, quality: item.quality }))
  );
};

const getApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }
  } catch {
    // ignore parse error
  }
  return fallback;
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

  const [ocrMode, setOcrMode] = useState<OcrMode>('local');
  const [ocrPsm, setOcrPsm] = useState<OcrPsm>(settings.defaultPsm);
  const [preprocessOptions, setPreprocessOptions] = useState<OcrPreprocessOptions>(settings.defaultPreprocess);
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
  const [showMastered, setShowMastered] = useState(false);
  const [masteredNormSet, setMasteredNormSet] = useState<Set<string>>(new Set());

  const cloudAbortRef = useRef<AbortController | null>(null);
  const cloudOcrReady = settings.cloudOcrEnabled && settings.cloudOcrConsentAccepted;
  const aiAssistReady = settings.aiMeaningAssistEnabled && settings.aiMeaningConsentAccepted;

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

  useEffect(() => {
    if (ocrMode === 'cloud' && !cloudOcrReady) {
      setOcrMode('local');
    }
  }, [ocrMode, cloudOcrReady]);

  const masteredHiddenCount = useMemo(() => {
    if (showMastered) return 0;
    return candidates.filter((item) => item.mastered).length;
  }, [candidates, showMastered]);

  const visibleCandidates = useMemo(
    () => candidates.filter((item) => showMastered || !item.mastered),
    [candidates, showMastered]
  );

  const selectedCandidates = useMemo(
    () => sortCandidates(visibleCandidates.filter((item) => item.selected), sortMode),
    [visibleCandidates, sortMode]
  );

  const cutCandidates = useMemo(
    () => sortCandidates(visibleCandidates.filter((item) => !item.selected), sortMode),
    [visibleCandidates, sortMode]
  );

  const canCreateDeck = useMemo(() => {
    if (!deckTitle.trim()) return false;
    if (selectedCandidates.length === 0) return false;
    return selectedCandidates.every((item) => item.headwordNorm.length > 0 && item.meaning.trim().length > 0);
  }, [deckTitle, selectedCandidates]);

  const hydrateCandidates = useCallback(
    async (base: Candidate[]) => {
      if (base.length === 0) {
        setCandidates([]);
        setMasteredNormSet(new Set());
        setLookupStatus('idle');
        return;
      }

      const masteredSet = await getMasteredHeadwordNormSet();
      setMasteredNormSet(masteredSet);
      setCandidates(
        base.map((item) => {
          const mastered = masteredSet.has(item.headwordNorm);
          return {
            ...item,
            mastered,
            selected: mastered ? false : item.selected
          };
        })
      );
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
          // OCR全文は送らない。headword配列だけ送る。
          body: JSON.stringify({ headwords: base.map((item) => item.headword) })
        });

        if (!response.ok) {
          const message = await getApiErrorMessage(response, '辞書検索に失敗しました。');
          throw new Error(message);
        }

        const data = (await response.json()) as {
          found: Array<{ headwordNorm: string; entries: Array<{ meaning_ja: string }> }>;
        };

        const foundMap = new Map(
          data.found.map((entry) => [entry.headwordNorm, entry.entries?.[0]?.meaning_ja ?? ''])
        );

        const merged = base.map((item) => {
          const foundMeaning = foundMap.get(item.headwordNorm);
          const mastered = masteredSet.has(item.headwordNorm);
          if (foundMeaning) {
            return {
              ...item,
              source: 'found' as const,
              meaning: sanitizeShortText(foundMeaning, LIMITS.meaning),
              aiSuggested: false,
              mastered,
              selected: mastered ? false : item.selected
            };
          }
          return {
            ...item,
            mastered,
            selected: mastered ? false : item.selected
          };
        });

        setCandidates(merged);
        setLookupStatus('done');

        if (aiAssistReady) {
          const missingHeadwords = [...new Set(merged.filter((item) => item.source === 'missing').map((item) => item.headwordNorm))];
          if (missingHeadwords.length > 0) {
            const aiResponse = await fetch('/api/v1/ai/meaning-suggest', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${session.apiKey}`
              },
              body: JSON.stringify({ headwords: missingHeadwords })
            });

            if (!aiResponse.ok) {
              const message = await getApiErrorMessage(
                aiResponse,
                aiResponse.status === 429 ? 'AI提案の本日の上限に達しました。' : 'AI提案に失敗しました。'
              );
              throw new Error(message);
            }

            const aiData = (await aiResponse.json()) as {
              suggestions: Array<{ headword: string; meaningJa: string }>;
            };

            const suggestionMap = new Map(
              aiData.suggestions
                .filter((item) => typeof item.headword === 'string' && typeof item.meaningJa === 'string')
                .map((item) => [normalizeHeadword(item.headword), sanitizeShortText(item.meaningJa, LIMITS.meaning)])
            );

            if (suggestionMap.size > 0) {
              setCandidates((prev) =>
                prev.map((item) => {
                  if (item.mastered) return item;
                  if (item.source !== 'missing') return item;
                  if (item.meaning.trim().length > 0) return item;
                  const suggested = suggestionMap.get(item.headwordNorm);
                  if (!suggested) return item;
                  return {
                    ...item,
                    meaning: suggested,
                    aiSuggested: true
                  };
                })
              );
              showToast('AI提案を意味欄に反映しました。必要なら修正してください。', 'info');
            }
          }
        }
      } catch (error) {
        setLookupStatus('error');
        const message = (error as Error).message;
        setLookupError(message);
        showToast(message, 'error');
      }
    },
    [aiAssistReady, showToast]
  );

  const buildCandidatesFromText = useCallback(
    async (text: string) => {
      const extracted = extractCandidates(text).slice(0, MAX_CANDIDATES);
      const base = createCandidates(extracted);
      await hydrateCandidates(base);
    },
    [hydrateCandidates]
  );

  const buildCandidatesFromCloudResult = useCallback(
    async (headwords: string[], words: string[]) => {
      const fromText = extractCandidates(words.join(' ')).slice(0, MAX_CANDIDATES);
      if (fromText.length > 0) {
        await hydrateCandidates(createCandidates(fromText));
        return;
      }
      await hydrateCandidates(createCandidatesFromHeadwords(headwords));
    },
    [hydrateCandidates]
  );

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
    setShowMastered(false);
    setMasteredNormSet(new Set());
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

  const handleRunLocalOcr = async () => {
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
      mode: 'local',
      provider: 'tesseract-local',
      timestamp: new Date().toISOString()
    });

    await incrementEvent('ocr_done');
    await buildCandidatesFromText(text);
    showToast('OCRが完了しました。単語を確認してください。', 'success');
  };

  const handleRunCloudOcr = async () => {
    if (!cloudOcrReady) {
      throw new Error('クラウドOCRはSettingsで有効化と同意をすると使えます。');
    }

    const prepared = await prepareOcrImage(imageDataUrl, cropRect, preprocessOptions);
    setBeforeDataUrl(prepared.beforeDataUrl);
    setAfterDataUrl(prepared.afterDataUrl);

    const prepStarted = performance.now();
    const uploadImage = await compressImageForCloud(prepared.beforeDataUrl, {
      maxSide: 1600,
      quality: 0.8,
      maxBytes: 2_000_000
    });
    const prepMs = prepared.timings.cropMs + (performance.now() - prepStarted);
    setPreprocessMs(prepMs);

    const session = await ensureAuth();
    const requestStarted = performance.now();
    const controller = new AbortController();
    cloudAbortRef.current = controller;

    const response = await fetch('/api/v1/ocr/cloud', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`
      },
      // サーバ送信は圧縮画像のみ。保存用途では使わない。
      body: JSON.stringify({
        imageBase64: uploadImage.base64,
        mime: uploadImage.mime,
        mode: 'document'
      }),
      signal: controller.signal
    });

    const cloudMs = performance.now() - requestStarted;
    setOcrDurationMs(cloudMs);
    setOcrConfidence(null);

    if (!response.ok) {
      const message = await getApiErrorMessage(
        response,
        response.status === 429 ? 'クラウドOCRの本日の上限に達しました。' : 'クラウドOCRに失敗しました。'
      );
      throw new Error(message);
    }

    const data = (await response.json()) as {
      words?: Array<{ text: string; confidence?: number }>;
      headwords?: string[];
    };

    const words = (data.words ?? [])
      .map((item) => sanitizeShortText(item.text ?? '', 40))
      .filter((item) => item.length > 0);
    const headwords = (data.headwords ?? [])
      .map((item) => normalizeHeadword(item))
      .filter((item) => item.length > 0);

    const text = words.join(' ');
    setOcrText(text);
    setCurrentStep(4);

    saveLastOcrMetrics({
      preprocessMs: prepMs,
      ocrMs: cloudMs,
      confidence: null,
      psm: ocrPsm,
      mode: 'cloud',
      provider: 'google-vision',
      timestamp: new Date().toISOString()
    });

    await incrementEvent('ocr_done');
    await buildCandidatesFromCloudResult(headwords, words);
    showToast('クラウドOCRが完了しました。単語を確認してください。', 'success');
  };

  const handleRunOcr = async () => {
    if (!imageDataUrl) {
      showToast('先に画像を選んでください。', 'error');
      return;
    }

    setOcrRunning(true);
    setOcrError('');

    try {
      if (ocrMode === 'cloud') {
        await handleRunCloudOcr();
      } else {
        await handleRunLocalOcr();
      }
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes('canceled') || message.toLowerCase().includes('abort')) {
        showToast('キャンセルしたよ。もう一度試してね！', 'info');
      } else {
        // 親しみやすいエラーメッセージに変換
        const friendlyMessage = 'うまく読めなかったみたい。もう一度トリミングを調整してみよう！';
        setOcrError(friendlyMessage);
        showToast(friendlyMessage, 'error');
      }
    } finally {
      cloudAbortRef.current = null;
      setOcrRunning(false);
    }
  };

  const handleCancelOcr = () => {
    if (ocrMode === 'cloud') {
      cloudAbortRef.current?.abort();
      cloudAbortRef.current = null;
    } else {
      cancelOcr();
    }
    setOcrRunning(false);
  };

  const handleRebuildCandidates = async () => {
    await buildCandidatesFromText(ocrText);
    setCurrentStep(4);
  };

  const toggleCandidate = (candidateId: string) => {
    setCandidates((prev) => prev.map((item) => (item.id === candidateId ? { ...item, selected: !item.selected } : item)));
  };

  const updateHeadword = (candidateId: string, nextHeadword: string) => {
    setCandidates((prev) =>
      prev.map((item) => {
        if (item.id !== candidateId) return item;
        const headword = sanitizeShortText(nextHeadword, 40);
        const headwordNorm = normalizeHeadword(headword);
        const mastered = headwordNorm ? masteredNormSet.has(headwordNorm) : false;
        return {
          ...item,
          headword,
          headwordNorm,
          source: 'missing',
          quality: inferQuality(headword),
          aiSuggested: false,
          mastered,
          selected: mastered ? false : item.selected
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
            source: item.source,
            aiSuggested: item.aiSuggested
          }
          : item
      )
    );
  };

  const selectAllCandidates = () => {
    setCandidates((prev) =>
      prev.map((item) => {
        if (item.mastered && !showMastered) return item;
        return { ...item, selected: true };
      })
    );
  };

  const clearAllCandidates = () => {
    setCandidates((prev) =>
      prev.map((item) => {
        if (item.mastered && !showMastered) return item;
        return { ...item, selected: false };
      })
    );
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
        <h2>単語帳を作る</h2>
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
                  <button className="secondary" type="button" onClick={() => setCropRect({ x: 0, y: 0, width: 1, height: 1 })}>
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
            <p className="notice">文字を自動で読み取ります。通常はそのまま実行してください。</p>

            <div className="scan-ocr-mode-grid" role="radiogroup" aria-label="読み取り方法">
              <label className={`scan-ocr-mode ${ocrMode === 'local' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="ocrMode"
                  checked={ocrMode === 'local'}
                  onChange={() => setOcrMode('local')}
                />
                <span>📱 端末内で処理（無料）</span>
              </label>
              <label
                className={`scan-ocr-mode ${ocrMode === 'cloud' ? 'active' : ''} ${!cloudOcrReady ? 'disabled' : ''}`}
              >
                <input
                  type="radio"
                  name="ocrMode"
                  checked={ocrMode === 'cloud'}
                  disabled={!cloudOcrReady}
                  onChange={() => setOcrMode('cloud')}
                />
                <span>☁️ クラウド処理（高精度）</span>
              </label>
            </div>
            {!cloudOcrReady && (
              <p className="counter">
                クラウド処理は「設定 {'>'} クラウド機能」で有効化と同意をすると使えます。
              </p>
            )}

            <details className="scan-details">
              <summary>詳細設定（上級者向け）</summary>
              <label>読み取りモード</label>
              <select value={ocrPsm} onChange={(event) => setOcrPsm(event.target.value as OcrPsm)}>
                <option value="6">文章ブロック（おすすめ）</option>
                <option value="11">バラバラの文字</option>
                <option value="7">1行だけ</option>
              </select>
              <div className="scan-option-grid">
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={preprocessOptions.grayscale}
                    onChange={(event) => setPreprocessOptions((prev) => ({ ...prev, grayscale: event.target.checked }))}
                  />
                  <span>グレースケール</span>
                </label>
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={preprocessOptions.threshold}
                    onChange={(event) => setPreprocessOptions((prev) => ({ ...prev, threshold: event.target.checked }))}
                  />
                  <span>二値化</span>
                </label>
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={preprocessOptions.invert}
                    onChange={(event) => setPreprocessOptions((prev) => ({ ...prev, invert: event.target.checked }))}
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
                onChange={(event) => setPreprocessOptions((prev) => ({ ...prev, contrast: Number(event.target.value) }))}
              />
              <label>Brightness: {Math.round(preprocessOptions.brightness)}</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={1}
                value={preprocessOptions.brightness}
                onChange={(event) => setPreprocessOptions((prev) => ({ ...prev, brightness: Number(event.target.value) }))}
              />
            </details>

            <div className="scan-inline-actions">
              {!ocrRunning && (
                <button type="button" onClick={handleRunOcr}>
                  📏 文字を読み取る
                </button>
              )}
              {ocrRunning && (
                <>
                  <button type="button" disabled>
                    読み取り中…
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
                  <p className="counter">モード: {ocrMode === 'local' ? 'ローカルOCR' : 'クラウドOCR'}</p>
                </div>
              </div>
            )}

            {ocrText && (
              <>
                <label>読み取り結果（必要なら修正）</label>
                <textarea
                  value={ocrText}
                  onChange={(event) => setOcrText(event.target.value)}
                  placeholder="読み取り結果を確認して修正"
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
              {candidates.some((item) => item.mastered) && (
                <label className="candidate-toggle">
                  <input
                    type="checkbox"
                    checked={showMastered}
                    onChange={(event) => setShowMastered(event.target.checked)}
                  />
                  <span>
                    {showMastered
                      ? '学習済み単語を表示中'
                      : `学習済みを${masteredHiddenCount}語かくす`}
                  </span>
                </label>
              )}
              <label>
                ソート
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'freq' | 'alpha')}>
                  <option value="freq">頻度順</option>
                  <option value="alpha">アルファベット順</option>
                </select>
              </label>
            </div>
            {masteredHiddenCount > 0 && (
              <p className="counter">学習済みの単語は自動で候補から外しています。</p>
            )}

            <p className="counter">追加予定: {selectedCandidates.length}語</p>
            <div className="word-grid candidate-grid">
              {selectedCandidates.map((item) => (
                <div key={item.id} className="word-item candidate-item">
                  <div className="candidate-row">
                    <div>
                      <strong>{item.quality === 'review' ? '単語（要確認）' : '単語'}</strong>
                      <small className="candidate-meta">出現 {item.count}回</small>
                      {item.aiSuggested && <small className="candidate-meta">AI提案</small>}
                    </div>
                    <button className="secondary candidate-cut-button" type="button" onClick={() => toggleCandidate(item.id)}>
                      カット
                    </button>
                  </div>
                  <input
                    type="text"
                    value={item.headword}
                    placeholder="単語を修正"
                    onChange={(event) => updateHeadword(item.id, event.target.value)}
                  />
                  {item.headwordNorm.length === 0 && <div className="counter">英字の単語を入れてください</div>}
                  <input
                    type="text"
                    value={item.meaning}
                    placeholder={
                      item.source === 'found'
                        ? '辞書の意味（必要なら修正）'
                        : item.aiSuggested
                          ? 'AI提案（必要なら修正）'
                          : '意味を入力'
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
                        <button className="secondary candidate-cut-button" type="button" onClick={() => toggleCandidate(item.id)}>
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
