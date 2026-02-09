import { useCallback, useEffect, useMemo, useState } from 'react';
import ScanPage from './pages/ScanPage';
import ReviewPage from './pages/ReviewPage';
import ReviewHomePage from './pages/ReviewHomePage';
import CharacterPage from './pages/CharacterPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import TestPage from './pages/TestPage';
import AuthPage from './pages/AuthPage';
import AuthVerifyPage from './pages/AuthVerifyPage';
import { Link, usePath } from './lib/router';
import { ensureAuth } from './lib/auth';
import { loadLastOcrMetrics } from './lib/feedbackMeta';
import { getXpSummary } from './db';
import {
  applyManagedSettings,
  loadSettings,
  saveSettings,
  summarizeDevice,
  type AppSettings,
  type ManagedAppSettings
} from './lib/settings';
import { bumpUsageMinute } from './lib/usage';
import { Modal, ToastHost, type ToastItem } from './components/ui';

type FeedbackType = 'ocr' | 'ux' | 'bug' | 'feature';

type ToastLevel = ToastItem['type'];

const makeToastId = () => Date.now() + Math.floor(Math.random() * 1000);

export default function App() {
  const { path, navigate } = usePath();
  const normalizedPath = path === '/' ? '/scan' : path;

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('ux');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [xpLabel, setXpLabel] = useState('Lv.1 / 0pt');

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/v1/settings/public');
        if (!response.ok) return;
        const data = (await response.json()) as {
          ok: boolean;
          settings?: ManagedAppSettings | null;
        };
        if (!data.ok || !data.settings || cancelled) return;
        setSettings((prev) => applyManagedSettings(prev, data.settings));
      } catch {
        // ignore public settings fetch errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (path === '/') {
      navigate('/scan');
    }
  }, [path, navigate]);

  useEffect(() => {
    if (!feedbackOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFeedbackOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [feedbackOpen]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const summary = await getXpSummary();
      if (cancelled) return;
      setXpLabel(`Lv.${summary.level} / ${summary.xpTotal}pt`);
    })();
    return () => {
      cancelled = true;
    };
  }, [normalizedPath]);

  useEffect(() => {
    bumpUsageMinute();
    const timer = window.setInterval(() => {
      bumpUsageMinute();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const showToast = useCallback((message: string, type: ToastLevel = 'info') => {
    const id = makeToastId();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  const handleChangeSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    showToast('設定を保存しました。', 'success');
  }, [showToast]);

  const handleSendFeedback = async () => {
    const message = feedbackMessage.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    if (!message) return;
    setFeedbackSending(true);
    setFeedbackStatus('');

    try {
      const session = await ensureAuth();
      const ocrMetrics = loadLastOcrMetrics();
      const response = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.apiKey}`
        },
        body: JSON.stringify({
          type: feedbackType,
          message,
          contextJson: {
            screen: normalizedPath,
            device: summarizeDevice(navigator.userAgent),
            latestOcr: ocrMetrics
              ? {
                mode: ocrMetrics.mode ?? 'local',
                provider: ocrMetrics.provider ?? 'tesseract-local',
                preprocessMs: Math.round(ocrMetrics.preprocessMs),
                ocrMs: Math.round(ocrMetrics.ocrMs),
                totalMs: Math.round(ocrMetrics.preprocessMs + ocrMetrics.ocrMs),
                confidence: ocrMetrics.confidence,
                psm: ocrMetrics.psm
              }
              : null,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        throw new Error('送信に失敗しました');
      }

      setFeedbackMessage('');
      setFeedbackStatus('送信しました。ありがとうございます！');
      showToast('意見を送信しました。', 'success');
    } catch (error) {
      const messageText = (error as Error).message;
      setFeedbackStatus(messageText);
      showToast(messageText, 'error');
    } finally {
      setFeedbackSending(false);
    }
  };

  const content = useMemo(() => {
    if (normalizedPath.startsWith('/review/')) {
      const deckId = normalizedPath.replace('/review/', '');
      return <ReviewPage deckId={deckId} settings={settings} showToast={showToast} />;
    }
    if (normalizedPath.startsWith('/test/')) {
      const deckId = normalizedPath.replace('/test/', '');
      return <TestPage deckId={deckId} />;
    }
    if (normalizedPath === '/review') {
      return <ReviewHomePage settings={settings} />;
    }
    if (normalizedPath === '/character') {
      return <CharacterPage />;
    }
    if (normalizedPath === '/settings') {
      return <SettingsPage settings={settings} onChangeSettings={handleChangeSettings} />;
    }
    if (normalizedPath === '/admin') {
      return <AdminPage settings={settings} onChangeSettings={handleChangeSettings} />;
    }
    if (normalizedPath === '/auth') {
      return <AuthPage navigate={navigate} />;
    }
    if (normalizedPath === '/auth/verify') {
      return <AuthVerifyPage navigate={navigate} />;
    }
    return <ScanPage settings={settings} showToast={showToast} navigate={navigate} />;
  }, [normalizedPath, navigate, settings, showToast, handleChangeSettings]);

  const isScanActive = normalizedPath === '/scan';
  const isReviewActive =
    normalizedPath === '/review' ||
    normalizedPath.startsWith('/review/') ||
    normalizedPath.startsWith('/test/');
  const isCharacterActive = normalizedPath === '/character';

  return (
    <main className="app-shell">
      <header className="app-header app-header-compact">
        <h1>えいたんメイト</h1>
        <div className="app-header-actions">
          <span className="badge badge-sm">{xpLabel}</span>
          <Link className="pill pill-sm" to="/settings">⚙️</Link>
          <button className="pill pill-sm" type="button" onClick={() => setFeedbackOpen(true)}>💬</button>
        </div>
      </header>

      <div className="app-content">{content}</div>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <Link className={`bottom-nav-item ${isScanActive ? 'active' : ''}`} to="/scan">
          <span>📷</span>
          <small>写真で単語</small>
        </Link>
        <Link className={`bottom-nav-item ${isReviewActive ? 'active' : ''}`} to="/review">
          <span>📖</span>
          <small>復習</small>
        </Link>
        <Link className={`bottom-nav-item ${isCharacterActive ? 'active' : ''}`} to="/character">
          <span>⭐</span>
          <small>がんばり記録</small>
        </Link>
      </nav>

      <Modal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="アプリへの意見">
        <p className="notice">名前・連絡先・本文の全文は書かず、短文で送ってください。</p>
        <label>どの内容？</label>
        <select
          value={feedbackType}
          onChange={(event) => setFeedbackType(event.target.value as FeedbackType)}
        >
          <option value="ocr">読み取り（OCR）</option>
          <option value="ux">使いやすさ</option>
          <option value="bug">うまく動かない</option>
          <option value="feature">ほしい機能</option>
        </select>
        <label style={{ marginTop: 12 }}>メッセージ（200文字まで）</label>
        <input
          type="text"
          value={feedbackMessage}
          maxLength={200}
          onChange={(event) => setFeedbackMessage(event.target.value)}
          placeholder="例: OCRの文字欠けを減らしたい"
        />
        <p className="counter">{feedbackMessage.trim().length}/200</p>
        <button
          style={{ marginTop: 12 }}
          onClick={handleSendFeedback}
          disabled={feedbackSending || feedbackMessage.trim().length === 0}
        >
          {feedbackSending ? '送信中…' : '意見を送る'}
        </button>
        {feedbackStatus && <p className="counter">{feedbackStatus}</p>}
      </Modal>

      <ToastHost items={toasts} />
    </main>
  );
}
