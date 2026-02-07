const STORAGE_KEY = 'nanjyo.usage.minutes.v1';
const MAX_MINUTES_PER_DAY = 24 * 60;

const getDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const readUsageMap = (): Record<string, number> => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        next[key] = Math.min(MAX_MINUTES_PER_DAY, Math.floor(value));
      }
    }
    return next;
  } catch {
    return {};
  }
};

const writeUsageMap = (map: Record<string, number>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
};

export const bumpUsageMinute = () => {
  if (document.hidden) return;
  const map = readUsageMap();
  const dateKey = getDateKey();
  const current = map[dateKey] ?? 0;
  map[dateKey] = Math.min(MAX_MINUTES_PER_DAY, current + 1);
  writeUsageMap(map);
};

export const getUsageMinutesToday = () => {
  const map = readUsageMap();
  return map[getDateKey()] ?? 0;
};

