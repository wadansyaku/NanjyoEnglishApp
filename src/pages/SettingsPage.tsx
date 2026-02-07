import { defaultSettings, type AppSettings } from '../lib/settings';
import type { OcrPsm } from '../lib/ocr';

type SettingsPageProps = {
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
};

export default function SettingsPage({ settings, onChangeSettings }: SettingsPageProps) {
  const preprocess = settings.defaultPreprocess;

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

  return (
    <section className="section-grid">
      <div className="card">
        <h2>Settings</h2>
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
    </section>
  );
}
