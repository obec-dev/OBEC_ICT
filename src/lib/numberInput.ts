import type { WheelEvent, KeyboardEvent } from "react";

/** Prevent accidental value changes while scrolling or using arrow keys. */
export const numberInputGuards = {
  onWheel: (e: WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  },
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
    }
  },
};

/** Points for scoring: explicit 0 stays 0; undefined defaults to 1. */
export function questionPoints(points: number | undefined | null): number {
  return typeof points === "number" && !Number.isNaN(points) ? points : 1;
}

/** Sum only graded (points > 0) questions toward max score. */
export function sumGradedMaxScore(
  questions: { points?: number | null }[],
  fallback = 0
): number {
  const total = questions.reduce((acc, q) => {
    const pts = questionPoints(q.points);
    return pts > 0 ? acc + pts : acc;
  }, 0);
  return total > 0 ? total : fallback;
}
