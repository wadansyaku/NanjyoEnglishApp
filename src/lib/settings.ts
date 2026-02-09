import type { OcrPsm } from './ocr';
import type { OcrPreprocessOptions } from './ocrImage';

export type AppSettings = {
  ocrDebug: boolean;
  defaultPsm: OcrPsm;
  defaultPreprocess: OcrPreprocessOptions;
  cloudOcrEnabled: boolean;
  aiMeaningAssistEnabled: boolean;
  cloudOcrConsentAccepted: boolean;
  aiMeaningConsentAccepted: boolean;
};

export type ManagedAppSettings = Pick<
  AppSettings,
  'ocrDebug' | 'defaultPsm' | 'defaultPreprocess' | 'cloudOcrEnabled' | 'aiMeaningAssistEnabled'
>;

const STORAGE_KEY = 'nanjyo.settings.v1';

export const defaultSettings: AppSettings = {
  ocrDebug: false,
  defaultPsm: '6',
  defaultPreprocess: {
    grayscale: true,
    threshold: false,
    thresholdValue: 160,
    invert: false,
    contrast: 1.12,
    brightness: 2,
    maxSide: 1900
  },
  cloudOcrEnabled: false,
  aiMeaningAssistEnabled: false,
  cloudOcrConsentAccepted: false,
  aiMeaningConsentAccepted: false
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeNumber = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const normalizePsm = (value: unknown): OcrPsm => {
  if (value === '6' || value === '7' || value === '11') return value;
  return defaultSettings.defaultPsm;
};

export const loadSettings = (): AppSettings => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultSettings;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return defaultSettings;
    const preprocess = isObject(parsed.defaultPreprocess)
      ? parsed.defaultPreprocess
      : defaultSettings.defaultPreprocess;
    return {
      ocrDebug: Boolean(parsed.ocrDebug),
      defaultPsm: normalizePsm(parsed.defaultPsm),
      defaultPreprocess: {
        grayscale:
          typeof preprocess.grayscale === 'boolean'
            ? preprocess.grayscale
            : defaultSettings.defaultPreprocess.grayscale,
        threshold:
          typeof preprocess.threshold === 'boolean'
            ? preprocess.threshold
            : defaultSettings.defaultPreprocess.threshold,
        thresholdValue: normalizeNumber(
          preprocess.thresholdValue,
          defaultSettings.defaultPreprocess.thresholdValue,
          0,
          255
        ),
        invert:
          typeof preprocess.invert === 'boolean'
            ? preprocess.invert
            : defaultSettings.defaultPreprocess.invert,
        contrast: normalizeNumber(
          preprocess.contrast,
          defaultSettings.defaultPreprocess.contrast,
          0.5,
          2
        ),
        brightness: normalizeNumber(
          preprocess.brightness,
          defaultSettings.defaultPreprocess.brightness,
          -80,
          80
        ),
        maxSide: normalizeNumber(
          preprocess.maxSide,
          defaultSettings.defaultPreprocess.maxSide,
          1200,
          2600
        )
      },
      cloudOcrEnabled:
        typeof parsed.cloudOcrEnabled === 'boolean'
          ? parsed.cloudOcrEnabled
          : defaultSettings.cloudOcrEnabled,
      aiMeaningAssistEnabled:
        typeof parsed.aiMeaningAssistEnabled === 'boolean'
          ? parsed.aiMeaningAssistEnabled
          : defaultSettings.aiMeaningAssistEnabled,
      cloudOcrConsentAccepted:
        typeof parsed.cloudOcrConsentAccepted === 'boolean'
          ? parsed.cloudOcrConsentAccepted
          : defaultSettings.cloudOcrConsentAccepted,
      aiMeaningConsentAccepted:
        typeof parsed.aiMeaningConsentAccepted === 'boolean'
          ? parsed.aiMeaningConsentAccepted
          : defaultSettings.aiMeaningConsentAccepted
    };
  } catch {
    return defaultSettings;
  }
};

export const saveSettings = (settings: AppSettings) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const toManagedSettings = (settings: AppSettings): ManagedAppSettings => ({
  ocrDebug: settings.ocrDebug,
  defaultPsm: settings.defaultPsm,
  defaultPreprocess: settings.defaultPreprocess,
  cloudOcrEnabled: settings.cloudOcrEnabled,
  aiMeaningAssistEnabled: settings.aiMeaningAssistEnabled
});

export const applyManagedSettings = (
  current: AppSettings,
  managed: Partial<ManagedAppSettings> | null | undefined
): AppSettings => {
  if (!managed) return current;
  const preprocess = managed.defaultPreprocess ?? current.defaultPreprocess;
  return {
    ...current,
    ocrDebug: typeof managed.ocrDebug === 'boolean' ? managed.ocrDebug : current.ocrDebug,
    defaultPsm: normalizePsm(managed.defaultPsm ?? current.defaultPsm),
    defaultPreprocess: {
      grayscale:
        typeof preprocess.grayscale === 'boolean'
          ? preprocess.grayscale
          : current.defaultPreprocess.grayscale,
      threshold:
        typeof preprocess.threshold === 'boolean'
          ? preprocess.threshold
          : current.defaultPreprocess.threshold,
      thresholdValue: normalizeNumber(
        preprocess.thresholdValue,
        current.defaultPreprocess.thresholdValue,
        0,
        255
      ),
      invert:
        typeof preprocess.invert === 'boolean'
          ? preprocess.invert
          : current.defaultPreprocess.invert,
      contrast: normalizeNumber(
        preprocess.contrast,
        current.defaultPreprocess.contrast,
        0.5,
        2
      ),
      brightness: normalizeNumber(
        preprocess.brightness,
        current.defaultPreprocess.brightness,
        -80,
        80
      ),
      maxSide: normalizeNumber(
        preprocess.maxSide,
        current.defaultPreprocess.maxSide,
        1200,
        2600
      )
    },
    cloudOcrEnabled:
      typeof managed.cloudOcrEnabled === 'boolean'
        ? managed.cloudOcrEnabled && current.cloudOcrConsentAccepted
        : current.cloudOcrEnabled,
    aiMeaningAssistEnabled:
      typeof managed.aiMeaningAssistEnabled === 'boolean'
        ? managed.aiMeaningAssistEnabled && current.aiMeaningConsentAccepted
        : current.aiMeaningAssistEnabled
  };
};

export const summarizeDevice = (userAgent: string) => {
  const isIPhone = /iphone/i.test(userAgent);
  const isIPad = /ipad/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const isMobile = /mobile/i.test(userAgent);
  const device = isIPhone ? 'iPhone' : isIPad ? 'iPad' : isAndroid ? 'Android' : 'Desktop';
  const layout = isMobile || isIPhone || isAndroid ? 'mobile' : 'desktop';
  return `${device}/${layout}`;
};
