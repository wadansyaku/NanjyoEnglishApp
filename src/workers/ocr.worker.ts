import { createWorker } from 'tesseract.js';

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
let activeTaskId: number | null = null;

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = Promise.resolve(createWorker('eng'));
  }
  return workerPromise;
};

const send = (message: unknown) => {
  (self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message);
};

self.onmessage = async (event) => {
  const { id, type, dataUrl, options } = event.data as {
    id: number;
    type: 'recognize' | 'terminate' | 'cancel';
    dataUrl?: string;
    options?: { psm?: '6' | '11' | '7' };
  };

  if (type === 'cancel') {
    if (workerPromise) {
      const worker = await getWorker();
      await worker.terminate();
      workerPromise = null;
    }
    activeTaskId = null;
    send({ id: id ?? 0, type: 'canceled' });
    return;
  }

  if (type === 'terminate') {
    if (workerPromise) {
      const worker = await getWorker();
      await worker.terminate();
      workerPromise = null;
    }
    activeTaskId = null;
    send({ id, type: 'terminated' });
    return;
  }

  if (type !== 'recognize' || !dataUrl) {
    send({ id, type: 'error', error: 'Invalid request.' });
    return;
  }

  try {
    const startedAt = Date.now();
    activeTaskId = id;
    const worker = await getWorker();
    const psm = options?.psm ?? '6';
    await worker.setParameters({
      tessedit_pageseg_mode: psm
    } as never);
    const result = await worker.recognize(dataUrl);
    if (activeTaskId !== id) return;
    send({
      id,
      type: 'result',
      text: result.data.text || '',
      confidence: typeof result.data.confidence === 'number' ? result.data.confidence : undefined,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    send({ id, type: 'error', error: (error as Error).message });
  } finally {
    if (activeTaskId === id) {
      activeTaskId = null;
    }
  }
};
