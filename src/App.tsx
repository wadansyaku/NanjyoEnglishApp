import { useEffect, useState } from 'react';
import ScanPage from './pages/ScanPage';
import ReviewPage from './pages/ReviewPage';
import CharacterPage from './pages/CharacterPage';
import { Link, usePath } from './lib/router';
import { ensureAuth } from './lib/auth';

export default function App() {
  const { path, navigate } = usePath();
  const normalizedPath = path === '/' ? '/scan' : path;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'ocr' | 'ux' | 'bug' | 'feature'>('ux');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);

  if (path === '/') {
    navigate('/scan');
  }

  let content: JSX.Element = <ScanPage />;
  if (normalizedPath.startsWith('/review/')) {
    const deckId = normalizedPath.replace('/review/', '');
    content = <ReviewPage deckId={deckId} />;
  } else if (normalizedPath === '/character') {
    content = <CharacterPage />;
  } else if (normalizedPath === '/scan') {
    content = <ScanPage />;
  }

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

  const handleSendFeedback = async () => {
    const message = feedbackMessage.replace(/[\r\n]+/g, ' ').trim();
    if (!message) return;
    setFeedbackSending(true);
    setFeedbackStatus('');
    try {
      const session = await ensureAuth();
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
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
          }
        })
      });
      if (!response.ok) {
        throw new Error('送信に失敗しました');
      }
      setFeedbackMessage('');
      setFeedbackStatus('送信しました。ありがとうございます！');
    } catch (error) {
      setFeedbackStatus((error as Error).message);
    } finally {
      setFeedbackSending(false);
    }
  };

  return (
    <main>
      <header>
        <h1>えいたんメイト</h1>
        <p>写真から単語を見つけて、自分だけの単語ノートで復習しよう。</p>
        <nav className="pill-group">
          <Link className="pill" to="/scan">
            📷 写真で単語
          </Link>
          <Link className="pill" to="/character">
            ⭐ がんばり記録
          </Link>
          <button className="pill" type="button" onClick={() => setFeedbackOpen(true)}>
            💬 アプリに意見
          </button>
        </nav>
      </header>

      {content}

      {feedbackOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setFeedbackOpen(false)}>
          <section
            className="card modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header-row">
              <h2 id="feedback-modal-title">アプリへの意見</h2>
              <button
                className="modal-close"
                type="button"
                aria-label="閉じる"
                onClick={() => setFeedbackOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="notice">
              名前・連絡先・本文の全文は書かないで、短く教えてください。
            </p>
            <label>どの内容？</label>
            <select
              value={feedbackType}
              onChange={(event) =>
                setFeedbackType(event.target.value as 'ocr' | 'ux' | 'bug' | 'feature')
              }
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
              placeholder="例: 写真が暗いときに読み取りしづらい"
            />
            <p className="counter">{feedbackMessage.trim().length}/200</p>
            <button
              style={{ marginTop: 12 }}
              onClick={handleSendFeedback}
              disabled={feedbackSending || feedbackMessage.trim().length === 0}
            >
              意見を送る
            </button>
            {feedbackStatus && <p className="counter">{feedbackStatus}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
