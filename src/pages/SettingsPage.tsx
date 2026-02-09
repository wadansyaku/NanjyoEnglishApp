import { useMemo, useState } from 'react';
import { Modal } from '../components/ui';
import { Link } from '../lib/router';
import { type AppSettings } from '../lib/settings';
import { getAuth, logout, type AuthSession } from '../lib/auth';
import { buildSyncSnapshot } from '../db';
import { isSyncEnabled, syncPush } from '../lib/sync';

type SettingsPageProps = {
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
};

type ConsentTarget = 'cloud' | 'ai' | null;

export default function SettingsPage({ settings, onChangeSettings }: SettingsPageProps) {
  const [consentTarget, setConsentTarget] = useState<ConsentTarget>(null);
  const [agreedDataTransfer, setAgreedDataTransfer] = useState(false);
  const [agreedSafetyRule, setAgreedSafetyRule] = useState(false);
  const [auth, setAuth] = useState<AuthSession | null>(() => getAuth());
  const [syncStatus, setSyncStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

  const updateSettings = (patch: Partial<AppSettings>) => {
    onChangeSettings({
      ...settings,
      ...patch
    });
  };

  const openConsent = (target: Exclude<ConsentTarget, null>) => {
    setAgreedDataTransfer(false);
    setAgreedSafetyRule(false);
    setConsentTarget(target);
  };

  const closeConsent = () => {
    setConsentTarget(null);
  };

  const applyConsent = () => {
    if (!consentTarget || !agreedDataTransfer || !agreedSafetyRule) return;
    if (consentTarget === 'cloud') {
      updateSettings({
        cloudOcrConsentAccepted: true,
        cloudOcrEnabled: true
      });
    }
    if (consentTarget === 'ai') {
      updateSettings({
        aiMeaningConsentAccepted: true,
        aiMeaningAssistEnabled: true
      });
    }
    closeConsent();
  };

  const handleLogout = () => {
    logout();
    setAuth(null);
  };

  const handleSyncNow = async () => {
    if (!isSyncEnabled()) {
      setSyncStatus('メール認証済みでログインしてから同期してください。');
      return;
    }
    setSyncing(true);
    setSyncStatus('');
    try {
      const payload = await buildSyncSnapshot();
      await syncPush({
        decks: payload.decks,
        progress: payload.progress
      });
      setSyncStatus(`同期完了: ${payload.decks.length}ノート`);
    } catch (error) {
      setSyncStatus((error as Error).message || '同期に失敗しました。');
    } finally {
      setSyncing(false);
    }
  };

  const consentTitle = useMemo(() => {
    if (consentTarget === 'cloud') return 'クラウド読み取りの同意';
    if (consentTarget === 'ai') return 'AI意味提案の同意';
    return '同意';
  }, [consentTarget]);

  const consentDataLabel = useMemo(() => {
    if (consentTarget === 'cloud') {
      return '画像が外部へ送信される場合があることを理解しました';
    }
    if (consentTarget === 'ai') {
      return '単語リストが外部へ送信される場合があることを理解しました';
    }
    return '外部送信を理解しました';
  }, [consentTarget]);

  return (
    <section className="section-grid">
      {/* アカウント */}
      <div className="card">
        <h2>👤 アカウント</h2>
        {auth?.isEmailVerified ? (
          <>
            <p className="notice">✅ ログイン済み</p>
            <p>メール: {auth.email}</p>
            <div className="scan-inline-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? '同期中…' : '☁️ 学習データを同期'}
              </button>
              <button className="secondary" type="button" onClick={handleLogout}>
                ログアウト
              </button>
            </div>
            {syncStatus && <p className="counter">{syncStatus}</p>}
          </>
        ) : (
          <>
            <p className="notice">
              ログインすると、他のデバイスと単語帳を同期できます
            </p>
            <Link to="/auth" className="pill primary">
              🔐 ログイン / 新規登録
            </Link>
          </>
        )}
      </div>

      {/* クラウド機能 - シンプルなトグルのみ */}
      <div className="card">
        <h2>☁️ クラウド機能</h2>
        <p className="notice">高精度な文字読み取りやAI提案を使えます</p>

        <label className="candidate-toggle">
          <input
            type="checkbox"
            checked={settings.cloudOcrEnabled}
            onChange={(event) => {
              const checked = event.target.checked;
              if (!checked) {
                updateSettings({ cloudOcrEnabled: false });
                return;
              }
              if (settings.cloudOcrConsentAccepted) {
                updateSettings({ cloudOcrEnabled: true });
                return;
              }
              openConsent('cloud');
            }}
          />
          <span>☁️ クラウドで読み取る（高精度）</span>
        </label>

        <label className="candidate-toggle" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.aiMeaningAssistEnabled}
            onChange={(event) => {
              const checked = event.target.checked;
              if (!checked) {
                updateSettings({ aiMeaningAssistEnabled: false });
                return;
              }
              if (settings.aiMeaningConsentAccepted) {
                updateSettings({ aiMeaningAssistEnabled: true });
                return;
              }
              openConsent('ai');
            }}
          />
          <span>🤖 AIで意味を自動入力</span>
        </label>
      </div>

      {/* 同意モーダル */}
      <Modal open={consentTarget !== null} onClose={closeConsent} title={consentTitle}>
        <p className="notice">
          データは保存しない設計ですが、送信先の取り扱いは提供事業者のポリシーに依存します。
        </p>
        <label className="candidate-toggle">
          <input
            type="checkbox"
            checked={agreedDataTransfer}
            onChange={(event) => setAgreedDataTransfer(event.target.checked)}
          />
          <span>{consentDataLabel}</span>
        </label>
        <label className="candidate-toggle">
          <input
            type="checkbox"
            checked={agreedSafetyRule}
            onChange={(event) => setAgreedSafetyRule(event.target.checked)}
          />
          <span>著作権物・個人情報は送らないことに同意</span>
        </label>
        <div className="scan-inline-actions" style={{ marginTop: 12 }}>
          <button className="secondary" type="button" onClick={closeConsent}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={applyConsent}
            disabled={!agreedDataTransfer || !agreedSafetyRule}
          >
            同意して有効化
          </button>
        </div>
      </Modal>
    </section>
  );
}
