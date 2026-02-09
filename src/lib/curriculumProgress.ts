export type CurriculumStepProgress = {
  offset: number;
  chunkSize: 5 | 10 | 20;
  total: number;
  mastered: number;
  isCompleted: boolean;
  completedAt?: number;
  updatedAt: number;
};

const STORAGE_KEY = 'wordbank_curriculum_step_progress_v2';
const ACTIVE_STEP_KEY = 'wordbank_curriculum_active_step_v1';

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
        mastered: 0,
        isCompleted: Boolean(value.isCompleted ?? false),
        completedAt:
          Number(value.completedAt ?? 0) > 0
            ? Math.max(0, Number(value.completedAt ?? 0))
            : undefined,
        chunkSize: normalizeChunk(Number(value.chunkSize ?? 10)),
        updatedAt: Math.max(0, Number(value.updatedAt ?? Date.now()))
      };
      out[key].mastered = Math.max(0, Math.min(out[key].total, Number(value.mastered ?? 0)));
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
    mastered?: number;
    isCompleted?: boolean;
    completedAt?: number;
  }
) => {
  const map = loadCurriculumProgressMap();
  const prev = map[stepId];
  const total = Math.max(0, Math.floor(input.total));
  const offset = Math.max(0, Math.min(Math.floor(input.offset), total));
  const mastered = Math.max(
    0,
    Math.min(
      total,
      Math.floor(
        input.mastered ??
          prev?.mastered ??
          0
      )
    )
  );
  const inferredCompleted = total > 0 && offset >= total && mastered >= total;
  const completionFlag = input.isCompleted ?? prev?.isCompleted ?? inferredCompleted;
  const isCompleted = Boolean(completionFlag);
  const completedAt = isCompleted
    ? Math.max(0, Number(input.completedAt ?? prev?.completedAt ?? Date.now()))
    : undefined;

  map[stepId] = {
    offset,
    total,
    mastered,
    isCompleted,
    completedAt,
    chunkSize: normalizeChunk(Math.floor(input.chunkSize)),
    updatedAt: Date.now()
  };
  saveCurriculumProgressMap(map);
  return map[stepId];
};

export const markCurriculumStepCompleted = (stepId: string) => {
  const current = getCurriculumProgress(stepId);
  if (!current) return null;
  return setCurriculumProgress(stepId, {
    offset: current.offset,
    total: current.total,
    chunkSize: current.chunkSize,
    mastered: Math.max(current.mastered, Math.min(current.total, current.offset)),
    isCompleted: true,
    completedAt: Date.now()
  });
};

export const getActiveCurriculumStepId = () => {
  return localStorage.getItem(ACTIVE_STEP_KEY) ?? '';
};

export const setActiveCurriculumStepId = (stepId: string) => {
  const normalized = stepId.trim();
  if (!normalized) {
    localStorage.removeItem(ACTIVE_STEP_KEY);
    return '';
  }
  localStorage.setItem(ACTIVE_STEP_KEY, normalized);
  return normalized;
};
