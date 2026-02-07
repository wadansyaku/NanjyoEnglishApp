export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrPreprocessOptions = {
  grayscale: boolean;
  threshold: boolean;
  thresholdValue: number;
  invert: boolean;
  contrast: number;
  brightness: number;
  maxSide: number;
};

export type PrepareOcrImageResult = {
  beforeDataUrl: string;
  afterDataUrl: string;
  width: number;
  height: number;
  timings: {
    cropMs: number;
    preprocessMs: number;
  };
};

export type CloudUploadImage = {
  mime: 'image/jpeg';
  base64: string;
  bytes: number;
  width: number;
  height: number;
  dataUrl: string;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    img.src = dataUrl;
  });

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
};

const estimateBase64Bytes = (base64: string) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const normalizeCrop = (crop: CropRect | null) => {
  if (!crop) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const x = clamp(crop.x, 0, 1);
  const y = clamp(crop.y, 0, 1);
  const width = clamp(crop.width, 0.01, 1 - x);
  const height = clamp(crop.height, 0.01, 1 - y);
  return { x, y, width, height };
};

const applyPreprocess = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: OcrPreprocessOptions
) => {
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const thresholdValue = clamp(options.thresholdValue, 0, 255);
  const contrast = options.contrast;
  const brightness = options.brightness;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (contrast !== 1 || brightness !== 0) {
      r = clamp((r - 128) * contrast + 128 + brightness, 0, 255);
      g = clamp((g - 128) * contrast + 128 + brightness, 0, 255);
      b = clamp((b - 128) * contrast + 128 + brightness, 0, 255);
    }

    if (options.grayscale || options.threshold) {
      const gray = Math.round((r + g + b) / 3);
      r = gray;
      g = gray;
      b = gray;
    }

    if (options.threshold) {
      const binary = r >= thresholdValue ? 255 : 0;
      r = binary;
      g = binary;
      b = binary;
    }

    if (options.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  context.putImageData(imageData, 0, 0);
};

export const prepareOcrImage = async (
  sourceDataUrl: string,
  cropRect: CropRect | null,
  options: OcrPreprocessOptions
): Promise<PrepareOcrImageResult> => {
  const image = await loadImage(sourceDataUrl);
  const normalizedCrop = normalizeCrop(cropRect);

  const cropStartedAt = performance.now();
  const sourceX = Math.floor(image.naturalWidth * normalizedCrop.x);
  const sourceY = Math.floor(image.naturalHeight * normalizedCrop.y);
  const sourceWidth = Math.max(1, Math.floor(image.naturalWidth * normalizedCrop.width));
  const sourceHeight = Math.max(1, Math.floor(image.naturalHeight * normalizedCrop.height));

  const maxSide = clamp(options.maxSide, 1200, 2600);
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const resizeScale = longestSide > maxSide ? maxSide / longestSide : 1;
  const targetWidth = Math.max(1, Math.floor(sourceWidth * resizeScale));
  const targetHeight = Math.max(1, Math.floor(sourceHeight * resizeScale));

  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas初期化に失敗しました。');
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
  const beforeDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const cropMs = performance.now() - cropStartedAt;

  const preprocessStartedAt = performance.now();
  applyPreprocess(context, targetWidth, targetHeight, options);
  const afterDataUrl = canvas.toDataURL('image/png');
  const preprocessMs = performance.now() - preprocessStartedAt;

  return {
    beforeDataUrl,
    afterDataUrl,
    width: targetWidth,
    height: targetHeight,
    timings: {
      cropMs,
      preprocessMs
    }
  };
};

export const compressImageForCloud = async (
  sourceDataUrl: string,
  options: { maxSide?: number; quality?: number; maxBytes?: number } = {}
): Promise<CloudUploadImage> => {
  const image = await loadImage(sourceDataUrl);
  const maxSide = clamp(options.maxSide ?? 1600, 800, 2200);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > maxSide ? maxSide / longest : 1;
  const width = Math.max(1, Math.floor(image.naturalWidth * scale));
  const height = Math.max(1, Math.floor(image.naturalHeight * scale));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas初期化に失敗しました。');
  }

  context.drawImage(image, 0, 0, width, height);
  const maxBytes = Math.max(200_000, options.maxBytes ?? 2_000_000);
  let quality = clamp(options.quality ?? 0.8, 0.45, 0.92);
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let base64 = dataUrl.split(',')[1] ?? '';
  let bytes = estimateBase64Bytes(base64);

  for (let i = 0; i < 5 && bytes > maxBytes && quality > 0.46; i += 1) {
    quality = Math.max(0.45, quality - 0.1);
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    base64 = dataUrl.split(',')[1] ?? '';
    bytes = estimateBase64Bytes(base64);
  }

  if (!base64 || bytes > maxBytes) {
    throw new Error('画像サイズが大きすぎます。範囲を狭めるか、解像度を下げてください。');
  }

  return {
    mime: 'image/jpeg',
    base64,
    bytes,
    width,
    height,
    dataUrl
  };
};
