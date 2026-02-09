import { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import { AuthApiError, getPendingEmail, requestMagicLink, verifyMagicLink } from '../lib/auth';

type AuthVerifyPageProps = {
  navigate: (to: string) => void;
};

type VerifyState = 'verifying' | 'success' | 'error';

export const AuthVerifyPage = ({ navigate }: AuthVerifyPageProps) => {
  const [state, setState] = useState<VerifyState>('verifying');
  const [message, setMessage] = useState('認証中です…');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [retryAfterSec, setRetryAfterSec] = useState(0);
  const pendingEmail = getPendingEmail();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setState('error');
      setMessage('認証リンクが不正です。ログイン画面から再送してください。');
      return;
    }

    let cancelled = false;
    void verifyMagicLink(token)
      .then((session) => {
        if (cancelled) return;
        setState('success');
        setMessage(`ログイン完了: ${session.email ?? ''}`);
        window.setTimeout(() => {
          navigate('/character');
        }, 1500);
      })
      .catch((error) => {
        if (cancelled) return;
        const authError = error as AuthApiError;
        setState('error');
        if (authError.code === 'TOKEN_EXPIRED') {
          setMessage('リンクの有効期限が切れました。再送してください。');
          return;
        }
        if (authError.code === 'TOKEN_USED') {
          setMessage('このリンクはすでに使用されています。新しいリンクを送ってください。');
          return;
        }
        if (authError.code === 'VERIFY_RATE_LIMITED') {
          setMessage('認証試行が多すぎます。少し待ってから再試行してください。');
          if (typeof authError.retryAfter === 'number' && authError.retryAfter > 0) {
            setRetryAfterSec(authError.retryAfter);
          }
          return;
        }
        setMessage(authError.message || '認証に失敗しました。');
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (retryAfterSec <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfterSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfterSec]);

  const handleResend = async () => {
    if (!pendingEmail || resendLoading) return;
    setResendLoading(true);
    setResendMessage('');
    try {
      const result = await requestMagicLink(pendingEmail);
      setResendMessage(result.message || '再送しました。メールをご確認ください。');
      setRetryAfterSec(45);
    } catch (error) {
      const authError = error as AuthApiError;
      setResendMessage(authError.message || '再送に失敗しました。');
      if (typeof authError.retryAfter === 'number' && authError.retryAfter > 0) {
        setRetryAfterSec(authError.retryAfter);
      }
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <section className="section-grid">
      <div className="card auth-card">
        {state === 'verifying' && (
          <>
            <h2>🔄 認証中</h2>
            <p className="counter">{message}</p>
          </>
        )}

        {state === 'success' && (
          <>
            <h2>✅ ログイン成功</h2>
            <p className="counter">{message}</p>
            <p className="candidate-meta">まもなく画面を移動します。</p>
            <button type="button" onClick={() => navigate('/character')}>
              今すぐ進む
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <h2>❌ 認証エラー</h2>
            <p className="counter">{message}</p>
            {retryAfterSec > 0 && (
              <p className="counter">再試行まで {retryAfterSec} 秒</p>
            )}
            <div className="scan-inline-actions" style={{ marginTop: 12 }}>
              <Link to="/auth" className="pill">ログイン画面へ戻る</Link>
              {pendingEmail && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleResend()}
                  disabled={resendLoading || retryAfterSec > 0}
                >
                  {resendLoading ? '再送中…' : '同じメールに再送'}
                </button>
              )}
            </div>
            {resendMessage && <p className="counter">{resendMessage}</p>}
          </>
        )}
      </div>
    </section>
  );
};

export default AuthVerifyPage;

