export type ReviewResult = 'again' | 'good' | 'easy';

export type SrsState = {
  headword: string;
  dueAt: number;
  intervalDays: number;
  ease: number;
  correctStreak: number;
  lastReviewedAt?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const applyReview = (state: SrsState, result: ReviewResult, now = Date.now()): SrsState => {
  let ease = state.ease || 2.4;
  let intervalDays = state.intervalDays || 0;
  let correctStreak = state.correctStreak || 0;
  let dueAt = now;

  if (result === 'again') {
    ease = Math.max(1.3, ease - 0.2);
    intervalDays = 0;
    correctStreak = 0;
    dueAt = now + 5 * 60 * 1000;
  }

  if (result === 'good') {
    intervalDays = intervalDays === 0 ? 1 : Math.round(intervalDays * ease);
    correctStreak += 1;
    dueAt = now + intervalDays * DAY_MS;
  }

  if (result === 'easy') {
    ease = Math.min(2.8, ease + 0.15);
    intervalDays = intervalDays === 0 ? 2 : Math.round(intervalDays * (ease + 0.15));
    correctStreak += 1;
    dueAt = now + intervalDays * DAY_MS;
  }

  return {
    ...state,
    ease,
    intervalDays,
    correctStreak,
    lastReviewedAt: now,
    dueAt
  };
};
