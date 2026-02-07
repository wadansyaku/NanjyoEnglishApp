export type MasteryRule = {
  minIntervalDays: number;
  minEase: number;
  minReps: number;
};

export const DEFAULT_MASTERY_RULE: MasteryRule = {
  minIntervalDays: 21,
  minEase: 2.3,
  minReps: 6
};

export type MasteryLikeState = {
  interval: number;
  ease: number;
  reps: number;
};

export const isMastered = (
  state: MasteryLikeState,
  rule: MasteryRule = DEFAULT_MASTERY_RULE
) => {
  return (
    state.interval >= rule.minIntervalDays &&
    state.ease >= rule.minEase &&
    state.reps >= rule.minReps
  );
};

