let ocrWorker: Worker | null = null;
let requestId = 0;

export type OcrPsm = '6' | '11' | '7';

export type OcrRequestOptions = {
  psm: OcrPsm;
};

export type OcrResult = {
  text: string;
  confidence: number | null;
  durationMs: number;
};

type PendingRequest = {
  resolve: (result: OcrResult) => void;
  reject: (error: Error) => void;
};

const pending = new Map<number, PendingRequest>();

const ensureWorker = () => {
  if (!ocrWorker) {
    ocrWorker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
      type: 'module'
    });
    ocrWorker.onmessage = (event) => {
      const { id, type, text, error, confidence, durationMs } = event.data as {
        id: number;
        type: 'result' | 'error' | 'terminated' | 'canceled';
        text?: string;
        error?: string;
        confidence?: number;
        durationMs?: number;
      };
      if (type === 'canceled') {
        pending.forEach((entry) => entry.reject(new Error('OCR canceled.')));
        pending.clear();
        return;
      }
      const entry = pending.get(id);
      if (!entry) return;
      if (type === 'result') {
        entry.resolve({
          text: text ?? '',
          confidence: typeof confidence === 'number' ? confidence : null,
          durationMs: typeof durationMs === 'number' ? durationMs : 0
        });
      } else if (type === 'error') {
        entry.reject(new Error(error ?? 'OCR failed'));
      }
      pending.delete(id);
    };
  }
  return ocrWorker;
};

export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

export const runOcr = async (dataUrl: string, options: OcrRequestOptions) => {
  const worker = ensureWorker();
  const id = ++requestId;
  return new Promise<OcrResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type: 'recognize', dataUrl, options });
  });
};

export const cancelOcr = () => {
  if (!ocrWorker) return;
  pending.forEach((entry) => entry.reject(new Error('OCR canceled.')));
  pending.clear();
  ocrWorker.postMessage({ type: 'cancel' });
};

export const resetOcrWorker = () => {
  if (!ocrWorker) return;
  ocrWorker.postMessage({ type: 'terminate', id: 0 });
  ocrWorker.terminate();
  ocrWorker = null;
  pending.clear();
};

export const runOcrFromFile = async (file: File, options: OcrRequestOptions) => {
  const dataUrl = await fileToDataUrl(file);
  return runOcr(dataUrl, options);
};

export const summarizeUserAgent = (userAgent: string) => {
  const isIPhone = /iphone/i.test(userAgent);
  const isIPad = /ipad/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const isMobile = /mobile/i.test(userAgent);
  const device = isIPhone ? 'iPhone' : isIPad ? 'iPad' : isAndroid ? 'Android' : 'Desktop';
  const mobileLabel = isMobile || isIPhone || isAndroid ? 'mobile' : 'desktop';
  return `${device}/${mobileLabel}`;
};

export const sanitizeSingleLine = (value: string) => {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
};

export const sanitizeShortText = (value: string, max: number) => {
  return sanitizeSingleLine(value).slice(0, max);
};

export const isLikelyOcrGarbage = (token: string) => {
  const cleaned = token.toLowerCase();
  if (cleaned.length < 2) return true;
  if (!/[a-z]/.test(cleaned)) return true;
  const symbolRatio = (cleaned.match(/[^a-z0-9']/g) ?? []).length / cleaned.length;
  if (symbolRatio > 0.35) return true;
  const digitRatio = (cleaned.match(/[0-9]/g) ?? []).length / cleaned.length;
  if (digitRatio > 0.4) return true;
  return false;
};

export const normalizeTokenForLookup = (token: string) => {
  return token.toLowerCase().replace(/[^a-z']/g, '');
};

export const createOcrRequestId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
