export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export type SrsState = {
  cardId: string;
  deckId: string;
  headwordNorm: string;
  dueAt: number;
  interval: number;
  ease: number;
  lapses: number;
  reps: number;
  lastReviewedAt?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 10 * 60 * 1000;

const gradeToQuality: Record<ReviewGrade, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5
};

export const createInitialSrsState = (
  cardId: string,
  deckId: string,
  headwordNorm: string,
  now = Date.now()
): SrsState => ({
  cardId,
  deckId,
  headwordNorm,
  dueAt: now,
  interval: 0,
  ease: 2.5,
  lapses: 0,
  reps: 0
});

export const applySm2 = (state: SrsState, grade: ReviewGrade, now = Date.now()): SrsState => {
  const quality = gradeToQuality[grade];
  let { interval, ease, lapses, reps } = state;

  if (quality < 3) {
    lapses += 1;
    reps = 0;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    return {
      ...state,
      interval,
      ease,
      lapses,
      reps,
      dueAt: now + AGAIN_DELAY_MS,
      lastReviewedAt: now
    };
  }

  const newEase =
    ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  ease = Math.max(1.3, newEase);

  if (reps === 0) {
    interval = 1;
  } else if (reps === 1) {
    interval = 6;
  } else {
    interval = Math.max(1, Math.round(interval * ease));
  }

  reps += 1;

  return {
    ...state,
    interval,
    ease,
    lapses,
    reps,
    dueAt: now + interval * DAY_MS,
    lastReviewedAt: now
  };
};
