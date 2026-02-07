/**
 * 認証ページ - マジックリンクログイン/サインアップ
 */
import { useState, type FormEvent } from 'react';
import { Link } from '../lib/router';
import { getAuth, requestMagicLink } from '../lib/auth';

type AuthPageProps = {
    navigate: (to: string) => void;
};

export const AuthPage = ({ navigate }: AuthPageProps) => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [devLink, setDevLink] = useState('');

    const auth = getAuth();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;

        setStatus('loading');
        setDevLink('');

        try {
            const result = await requestMagicLink(email.trim());
            if (result.ok) {
                setStatus('sent');
                setMessage(result.message);
                if (result.magicLink) {
                    setDevLink(result.magicLink);
                }
            } else {
                setStatus('error');
                setMessage(result.message);
            }
        } catch {
            setStatus('error');
            setMessage('通信エラーが発生しました');
        }
    };

    if (auth?.isEmailVerified) {
        return (
            <div className="page auth-page">
                <h1>👋 すでにログインしています</h1>
                <p>メールアドレス: {auth.email}</p>
                <Link to="/settings" className="pill primary">
                    ⚙️ 設定に戻る
                </Link>
            </div>
        );
    }

    if (status === 'sent') {
        return (
            <div className="page auth-page">
                <h1>📧 メールを確認してね！</h1>
                <p>{message}</p>
                <p className="hint">
                    メールに届いたリンクをタップしてログインしてね
                </p>

                {devLink && (
                    <div className="dev-section">
                        <p className="dev-label">🔧 開発モード:</p>
                        <a href={devLink} className="pill secondary">
                            マジックリンクを開く
                        </a>
                    </div>
                )}

                <button
                    className="pill ghost"
                    onClick={() => setStatus('idle')}
                >
                    ← やり直す
                </button>
            </div>
        );
    }

    return (
        <div className="page auth-page">
            <h1>🔐 ログイン / 新規登録</h1>
            <p className="subtitle">
                メールアドレスを入力してね。
                <br />
                パスワードは不要！メールに届くリンクでログインできるよ。
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
                <input
                    type="email"
                    placeholder="example@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={status === 'loading'}
                    autoComplete="email"
                    autoFocus
                />

                <button
                    type="submit"
                    className="pill primary"
                    disabled={status === 'loading' || !email.trim()}
                >
                    {status === 'loading' ? '送信中...' : '📨 ログインリンクを送る'}
                </button>
            </form>

            {status === 'error' && (
                <p className="error-message">{message}</p>
            )}

            <div className="auth-footer">
                <button className="pill ghost" onClick={() => navigate('/review')}>
                    あとでログインする →
                </button>
            </div>
        </div>
    );
};

export default AuthPage;
