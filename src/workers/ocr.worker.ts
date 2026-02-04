import { createWorker } from 'tesseract.js';

let workerPromise: ReturnType<typeof createWorker> | null = null;

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  return workerPromise;
};

const send = (message: unknown) => {
  (self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message);
};

self.onmessage = async (event) => {
  const { id, type, dataUrl } = event.data as {
    id: number;
    type: 'recognize' | 'terminate';
    dataUrl?: string;
  };

  if (type === 'terminate') {
    const worker = await getWorker();
    await worker.terminate();
    workerPromise = null;
    send({ id, type: 'terminated' });
    return;
  }

  if (type !== 'recognize' || !dataUrl) {
    send({ id, type: 'error', error: 'Invalid request.' });
    return;
  }

  try {
    const worker = await getWorker();
    const result = await worker.recognize(dataUrl);
    send({ id, type: 'result', text: result.data.text || '' });
  } catch (error) {
    send({ id, type: 'error', error: (error as Error).message });
  }
};
