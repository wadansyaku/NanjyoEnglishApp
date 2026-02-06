import { useState } from 'react';
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
        <h1>学習フロー（ローカル）</h1>
        <p>辞書→デッキ→SRS→XP→キャラを端末内だけで回します。</p>
        <nav className="pill-group">
          <Link className="pill" to="/scan">
            /scan
          </Link>
          <Link className="pill" to="/character">
            /character
          </Link>
          <button
            className="pill"
            type="button"
            onClick={() => setFeedbackOpen((prev) => !prev)}
          >
            フィードバック
          </button>
        </nav>
      </header>

      {feedbackOpen && (
        <section className="card" style={{ marginBottom: 24 }}>
          <h2>フィードバック</h2>
          <p className="notice">本文やOCR全文は送信しないでください。</p>
          <label>種類</label>
          <select
            value={feedbackType}
            onChange={(event) =>
              setFeedbackType(event.target.value as 'ocr' | 'ux' | 'bug' | 'feature')
            }
          >
            <option value="ocr">OCR</option>
            <option value="ux">UX</option>
            <option value="bug">Bug</option>
            <option value="feature">Feature</option>
          </select>
          <label style={{ marginTop: 12 }}>メッセージ（短文）</label>
          <input
            type="text"
            value={feedbackMessage}
            maxLength={200}
            onChange={(event) => setFeedbackMessage(event.target.value)}
            placeholder="例: OCR結果が改行で崩れる"
          />
          <button
            style={{ marginTop: 12 }}
            onClick={handleSendFeedback}
            disabled={feedbackSending || feedbackMessage.trim().length === 0}
          >
            送信
          </button>
          {feedbackStatus && <p className="counter">{feedbackStatus}</p>}
        </section>
      )}

      {content}
    </main>
  );
}
