export type CurriculumStepProgress = {
  offset: number;
  chunkSize: 5 | 10 | 20;
  total: number;
  updatedAt: number;
};

const STORAGE_KEY = 'wordbank_curriculum_step_progress_v2';

const normalizeChunk = (value: number): 5 | 10 | 20 => {
  if (value === 5 || value === 20) return value;
  return 10;
};

export const loadCurriculumProgressMap = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {} as Record<string, CurriculumStepProgress>;
    const parsed = JSON.parse(raw) as Record<string, CurriculumStepProgress>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, CurriculumStepProgress> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      out[key] = {
        offset: Math.max(0, Number(value.offset ?? 0)),
        total: Math.max(0, Number(value.total ?? 0)),
        chunkSize: normalizeChunk(Number(value.chunkSize ?? 10)),
        updatedAt: Math.max(0, Number(value.updatedAt ?? Date.now()))
      };
    }
    return out;
  } catch {
    return {} as Record<string, CurriculumStepProgress>;
  }
};

export const saveCurriculumProgressMap = (next: Record<string, CurriculumStepProgress>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
};

export const getCurriculumProgress = (stepId: string) => {
  const map = loadCurriculumProgressMap();
  return map[stepId];
};

export const setCurriculumProgress = (
  stepId: string,
  input: {
    offset: number;
    total: number;
    chunkSize: number;
  }
) => {
  const map = loadCurriculumProgressMap();
  map[stepId] = {
    offset: Math.max(0, Math.floor(input.offset)),
    total: Math.max(0, Math.floor(input.total)),
    chunkSize: normalizeChunk(Math.floor(input.chunkSize)),
    updatedAt: Date.now()
  };
  saveCurriculumProgressMap(map);
  return map[stepId];
};
