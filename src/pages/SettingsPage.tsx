import { useMemo, useState } from 'react';
import { Modal } from '../components/ui';
import { defaultSettings, type AppSettings } from '../lib/settings';
import type { OcrPsm } from '../lib/ocr';

type SettingsPageProps = {
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
};

type ConsentTarget = 'cloud' | 'ai' | null;

export default function SettingsPage({ settings, onChangeSettings }: SettingsPageProps) {
  const preprocess = settings.defaultPreprocess;
  const [consentTarget, setConsentTarget] = useState<ConsentTarget>(null);
  const [agreedDataTransfer, setAgreedDataTransfer] = useState(false);
  const [agreedSafetyRule, setAgreedSafetyRule] = useState(false);

  const updateSettings = (patch: Partial<AppSettings>) => {
    onChangeSettings({
      ...settings,
      ...patch
    });
  };

  const updatePreprocess = (patch: Partial<AppSettings['defaultPreprocess']>) => {
    onChangeSettings({
      ...settings,
      defaultPreprocess: {
        ...settings.defaultPreprocess,
        ...patch
      }
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

  const consentTitle = useMemo(() => {
    if (consentTarget === 'cloud') return 'クラウドOCRの同意';
    if (consentTarget === 'ai') return 'AI意味提案の同意';
    return '同意';
  }, [consentTarget]);

  const consentDataLabel = useMemo(() => {
    if (consentTarget === 'cloud') {
      return '画像が外部OCR APIへ送信される場合があることを理解しました';
    }
    if (consentTarget === 'ai') {
      return '単語リストが外部AI APIへ送信される場合があることを理解しました';
    }
    return '外部API送信を理解しました';
  }, [consentTarget]);

  return (
    <section className="section-grid">
      <div className="card">
        <h2>クラウド機能</h2>
        <p className="notice">初期設定はOFFです。必要なときだけONにできます。</p>

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
          <span>クラウドOCRを有効にする（高精度）</span>
        </label>
        <p className="counter">画像は保存しません。未同意のままは選択できません。</p>

        <label className="candidate-toggle">
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
          <span>AIで意味を自動入力する</span>
        </label>
        <p className="counter">提案は短い意味のみ。最終的に編集・確認してから保存します。</p>
      </div>

      <div className="card">
        <h2>OCR設定</h2>
        <label className="candidate-toggle">
          <input
            type="checkbox"
            checked={settings.ocrDebug}
            onChange={(event) => updateSettings({ ocrDebug: event.target.checked })}
          />
          <span>OCRデバッグを表示する</span>
        </label>

        <label>既定PSM</label>
        <select
          value={settings.defaultPsm}
          onChange={(event) => updateSettings({ defaultPsm: event.target.value as OcrPsm })}
        >
          <option value="6">6: 本文ブロック向け</option>
          <option value="11">11: ばらけた文字向け</option>
          <option value="7">7: 1行向け</option>
        </select>
      </div>

      <div className="card">
        <h2>OCR前処理の既定値</h2>

        <div className="scan-option-grid">
          <label className="candidate-toggle">
            <input
              type="checkbox"
              checked={preprocess.grayscale}
              onChange={(event) => updatePreprocess({ grayscale: event.target.checked })}
            />
            <span>グレースケール</span>
          </label>
          <label className="candidate-toggle">
            <input
              type="checkbox"
              checked={preprocess.threshold}
              onChange={(event) => updatePreprocess({ threshold: event.target.checked })}
            />
            <span>二値化</span>
          </label>
          <label className="candidate-toggle">
            <input
              type="checkbox"
              checked={preprocess.invert}
              onChange={(event) => updatePreprocess({ invert: event.target.checked })}
            />
            <span>白黒反転</span>
          </label>
        </div>

        <label>Threshold: {Math.round(preprocess.thresholdValue)}</label>
        <input
          type="range"
          min={0}
          max={255}
          value={preprocess.thresholdValue}
          onChange={(event) => updatePreprocess({ thresholdValue: Number(event.target.value) })}
        />

        <label>Contrast: {preprocess.contrast.toFixed(2)}</label>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.02}
          value={preprocess.contrast}
          onChange={(event) => updatePreprocess({ contrast: Number(event.target.value) })}
        />

        <label>Brightness: {Math.round(preprocess.brightness)}</label>
        <input
          type="range"
          min={-50}
          max={50}
          step={1}
          value={preprocess.brightness}
          onChange={(event) => updatePreprocess({ brightness: Number(event.target.value) })}
        />

        <label>最大辺(px): {Math.round(preprocess.maxSide)}</label>
        <input
          type="range"
          min={1200}
          max={2600}
          step={50}
          value={preprocess.maxSide}
          onChange={(event) => updatePreprocess({ maxSide: Number(event.target.value) })}
        />

        <div className="scan-inline-actions">
          <button type="button" className="secondary" onClick={() => onChangeSettings(defaultSettings)}>
            初期値に戻す
          </button>
        </div>
      </div>

      <Modal open={consentTarget !== null} onClose={closeConsent} title={consentTitle}>
        <p className="notice">
          画像や単語のデータは保存しない設計ですが、送信先の取り扱いは提供事業者のポリシーに依存します。
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
          <span>著作権物・個人情報・試験問題などを送らないことに同意します</span>
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
