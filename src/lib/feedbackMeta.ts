type OcrMetrics = {
  preprocessMs: number;
  ocrMs: number;
  confidence: number | null;
  psm: string;
  timestamp: string;
};

const METRICS_KEY = 'nanjyo.feedback.ocrMetrics.v1';

export const saveLastOcrMetrics = (metrics: OcrMetrics) => {
  localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
};

export const loadLastOcrMetrics = (): OcrMetrics | null => {
  const raw = localStorage.getItem(METRICS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OcrMetrics;
    if (
      typeof parsed?.preprocessMs !== 'number' ||
      typeof parsed?.ocrMs !== 'number' ||
      typeof parsed?.psm !== 'string' ||
      typeof parsed?.timestamp !== 'string'
    ) {
      return null;
    }
    return {
      preprocessMs: parsed.preprocessMs,
      ocrMs: parsed.ocrMs,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      psm: parsed.psm,
      timestamp: parsed.timestamp
    };
  } catch {
    return null;
  }
};
