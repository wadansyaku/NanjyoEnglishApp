import { useMemo, useState, type FormEvent } from 'react';
import { client as webauthnClient } from '@passwordless-id/webauthn';
import {
  AuthApiError,
  getAuth,
  requestPasskeyLoginOptions,
  requestPasskeyRegisterOptions,
  verifyPasskeyLogin,
  verifyPasskeyRegister
} from '../lib/auth';

type AuthPageProps = {
  navigate: (to: string) => void;
};

type BusyState = 'idle' | 'register' | 'login';

const mapAuthError = (error: unknown) => {
  const authError = error as AuthApiError;
  if (authError?.message) return authError.message;

  const domError = error as { name?: string; message?: string };
  if (domError?.name === 'NotAllowedError') {
    return '操作がキャンセルされました。もう一度お試しください。';
  }
  if (domError?.name === 'NotSupportedError') {
    return 'この端末/ブラウザはPasskeyに対応していません。';
  }
  if (domError?.name === 'InvalidStateError') {
    return 'このPasskeyは既に登録済みです。ログインをお試しください。';
  }
  return domError?.message || '認証に失敗しました。';
};

export const AuthPage = ({ navigate }: AuthPageProps) => {
  const auth = getAuth();
  const [displayName, setDisplayName] = useState('AIYuMe User');
  const [busy, setBusy] = useState<BusyState>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const passkeyAvailable = useMemo(() => {
    try {
      return webauthnClient.isAvailable();
    } catch {
      return false;
    }
  }, []);

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    if (!passkeyAvailable || busy !== 'idle') return;

    const safeDisplayName = displayName.trim().slice(0, 32) || 'AIYuMe User';
    setBusy('register');
    setError('');
    setMessage('');
    try {
      const { challengeId, options } = await requestPasskeyRegisterOptions(safeDisplayName);
      const registration = await webauthnClient.register(options);
      const session = await verifyPasskeyRegister({ challengeId, registration });
      setMessage('Passkey登録が完了しました。');
      window.setTimeout(() => navigate('/character'), 500);
      if (!session.userId) {
        throw new Error('セッション情報が不正です。');
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleLogin = async () => {
    if (!passkeyAvailable || busy !== 'idle') return;
    setBusy('login');
    setError('');
    setMessage('');
    try {
      const { challengeId, options } = await requestPasskeyLoginOptions();
      const authentication = await webauthnClient.authenticate(options);
      await verifyPasskeyLogin({ challengeId, authentication });
      setMessage('ログインしました。');
      window.setTimeout(() => navigate('/character'), 300);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy('idle');
    }
  };

  if (auth?.isEmailVerified || auth?.authMethod === 'passkey') {
    return (
      <section className="section-grid">
        <div className="card auth-card">
          <h2>✅ ログイン済み</h2>
          <p className="counter">{auth.email || 'Passkeyアカウント'}</p>
          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <button type="button" className="pill" onClick={() => navigate('/review')}>
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
        <h2>🔐 Passkey ログイン</h2>
        <p className="notice">
          メールなしでログインできます。端末の顔認証・指紋認証・PINを使います。
        </p>

        {!passkeyAvailable && (
          <p className="counter">
            このブラウザはPasskeyに対応していません。別ブラウザ（Safari/Chrome最新版）をお試しください。
          </p>
        )}

        <form onSubmit={handleRegister} className="auth-form-grid">
          <label htmlFor="display-name-input">表示名（任意）</label>
          <input
            id="display-name-input"
            type="text"
            value={displayName}
            maxLength={32}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={busy !== 'idle'}
            placeholder="AIYuMe User"
          />
          <button type="submit" disabled={!passkeyAvailable || busy !== 'idle'}>
            {busy === 'register' ? '登録中…' : '🆕 Passkeyで新規登録'}
          </button>
        </form>

        <button
          type="button"
          className="secondary"
          style={{ marginTop: 12 }}
          onClick={() => void handleLogin()}
          disabled={!passkeyAvailable || busy !== 'idle'}
        >
          {busy === 'login' ? 'ログイン中…' : '🔓 Passkeyでログイン'}
        </button>

        {message && <p className="counter">{message}</p>}
        {error && <p className="counter">{error}</p>}
      </div>
    </section>
  );
};

export default AuthPage;
