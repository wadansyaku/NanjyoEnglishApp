import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '../lib/router';
import { AuthApiError, getAuth, requestMagicLink } from '../lib/auth';

type AuthPageProps = {
  navigate: (to: string) => void;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const AuthPage = ({ navigate }: AuthPageProps) => {
  const auth = getAuth();

  const [email, setEmail] = useState(auth?.email ?? '');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [devLink, setDevLink] = useState('');
  const [cooldownSec, setCooldownSec] = useState(0);

  const normalizedEmail = email.trim().toLowerCase();
  const canSubmit = useMemo(
    () => isValidEmail(normalizedEmail) && !sending && cooldownSec <= 0,
    [normalizedEmail, sending, cooldownSec]
  );

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  const submit = async (targetEmail: string) => {
    if (!isValidEmail(targetEmail)) {
      setError('メールアドレスの形式が正しくありません。');
      return;
    }

    setSending(true);
    setError('');
    setMessage('');
    setDevLink('');
    try {
      const result = await requestMagicLink(targetEmail);
      setSent(true);
      setMessage(result.message);
      setDevLink(result.magicLink ?? '');
      setCooldownSec(45);
    } catch (err) {
      const apiError = err as AuthApiError;
      setError(apiError.message || '通信エラーが発生しました。');
      if (typeof apiError.retryAfter === 'number' && apiError.retryAfter > 0) {
        setCooldownSec(apiError.retryAfter);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submit(normalizedEmail);
  };

  if (auth?.isEmailVerified) {
    return (
      <section className="section-grid">
        <div className="card auth-card">
          <h2>✅ ログイン済み</h2>
          <p className="counter">{auth.email}</p>
          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <Link to="/settings" className="pill">設定へ戻る</Link>
            <button type="button" className="secondary" onClick={() => navigate('/review')}>
              復習へ進む
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section-grid">
      <div className="card auth-card">
        <h2>🔐 ログイン / 新規登録</h2>
        <p className="notice">
          メールに届くリンクでログインします。パスワードは不要です。ログイン後に学習を開始できます。
        </p>

        <form onSubmit={handleSubmit} className="auth-form-grid">
          <label htmlFor="email-input">メールアドレス</label>
          <input
            id="email-input"
            type="email"
            autoComplete="email"
            placeholder="example@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={!canSubmit}>
            {sending ? '送信中…' : 'ログインリンクを送る'}
          </button>
        </form>

        {cooldownSec > 0 && (
          <p className="counter">再送まで {cooldownSec} 秒</p>
        )}
        {error && <p className="counter">{error}</p>}

        {sent && (
          <div className="cut-candidate-box" style={{ marginTop: 12 }}>
            <p className="counter">{message || 'メールを送信しました。'}</p>
            <p className="candidate-meta">
              メールのリンクを開くとログインが完了します。
            </p>
            <div className="scan-inline-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => void submit(normalizedEmail)}
                disabled={cooldownSec > 0 || sending}
              >
                再送する
              </button>
              <button type="button" className="secondary" onClick={() => setSent(false)}>
                入力をやり直す
              </button>
            </div>
            {devLink && (
              <a href={devLink} className="pill" style={{ marginTop: 8 }}>
                開発用リンクを開く
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default AuthPage;
