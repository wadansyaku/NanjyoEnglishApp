let ocrWorker: Worker | null = null;
let requestId = 0;

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

const pending = new Map<number, PendingRequest>();

const ensureWorker = () => {
  if (!ocrWorker) {
    ocrWorker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
      type: 'module'
    });
    ocrWorker.onmessage = (event) => {
      const { id, type, text, error } = event.data as {
        id: number;
        type: 'result' | 'error' | 'terminated';
        text?: string;
        error?: string;
      };
      const entry = pending.get(id);
      if (!entry) return;
      if (type === 'result') {
        entry.resolve(text ?? '');
      } else if (type === 'error') {
        entry.reject(new Error(error ?? 'OCR failed'));
      }
      pending.delete(id);
    };
  }
  return ocrWorker;
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

export const runOcr = async (file: File) => {
  const dataUrl = await fileToDataUrl(file);
  const worker = ensureWorker();
  const id = ++requestId;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type: 'recognize', dataUrl });
  });
};
