/**
 * マジックリンク検証ページ
 * メールのリンクからリダイレクトされる
 */
import { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import { verifyMagicLink } from '../lib/auth';

type AuthVerifyPageProps = {
    navigate: (to: string) => void;
};

export const AuthVerifyPage = ({ navigate }: AuthVerifyPageProps) => {
    const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
    const [message, setMessage] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (!token) {
            setStatus('error');
            setMessage('トークンがありません');
            return;
        }

        verifyMagicLink(token)
            .then((session) => {
                setStatus('success');
                setMessage(`ようこそ！${session.email ? `(${session.email})` : ''}`);
                // Redirect after 2 seconds
                setTimeout(() => {
                    navigate('/character');
                }, 2000);
            })
            .catch((err) => {
                setStatus('error');
                setMessage(err.message || '認証に失敗しました');
            });
    }, [navigate]);

    return (
        <div className="page auth-verify-page">
            {status === 'verifying' && (
                <>
                    <h1>🔄 認証中...</h1>
                    <p>少々お待ちください</p>
                </>
            )}

            {status === 'success' && (
                <>
                    <h1>✅ ログイン成功！</h1>
                    <p>{message}</p>
                    <p className="hint">まもなくリダイレクトします...</p>
                </>
            )}

            {status === 'error' && (
                <>
                    <h1>❌ エラー</h1>
                    <p>{message}</p>
                    <Link to="/auth" className="pill primary">
                        ↩️ ログイン画面に戻る
                    </Link>
                </>
            )}
        </div>
    );
};

export default AuthVerifyPage;
