import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

const DURATION_SECONDS = 0.6;

/**
 * Displays `target`, a real numeric value (e.g. a stat count). The returned
 * number always equals `target` except while transitioning between the
 * previous real value and a newly-changed one — it is never a function of
 * "did the animation run", so a stalled or skipped animation can never show
 * a figure that was never true.
 *
 * On mount it shows `target` immediately (no counting up from zero). Only
 * when `target` changes afterwards does it animate old -> new. Honours
 * `useReducedMotion`, in which case changes apply instantly.
 */
export function useAnimatedNumber(target: number): number {
  const [display, setDisplay] = useState(target);
  const [prevTarget, setPrevTarget] = useState(target);
  // Tracks the true value currently on screen, so the next animation always
  // starts from what the user actually sees rather than from a stale target.
  // Only ever read or written inside effects/callbacks below, never during
  // render.
  const displayRef = useRef(target);
  const mountedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  // Reduced motion: snap straight to the new target. This runs during
  // render — React's supported pattern for reacting to a changed value
  // without an extra commit ("adjusting state when a prop changes") —
  // rather than inside the effect below, so the always-true invariant above
  // holds even before that effect gets a chance to run.
  if (prefersReducedMotion && target !== prevTarget) {
    setPrevTarget(target);
    setDisplay(target);
  }

  // Keeps the ref the animation effect reads from in sync with whatever is
  // actually on screen, including snaps applied during render above.
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (!mountedRef.current) {
      // Initial mount: the true value is already on screen (see useState
      // above) — nothing to animate toward.
      mountedRef.current = true;
      return;
    }

    if (prefersReducedMotion) {
      // Already snapped to `target` during render, above.
      return;
    }

    const controls = animate(displayRef.current, target, {
      duration: DURATION_SECONDS,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => {
        const rounded = Math.round(value);
        displayRef.current = rounded;
        setDisplay(rounded);
      },
      onComplete: () => {
        // Guarantee the exact target lands, regardless of float rounding.
        displayRef.current = target;
        setDisplay(target);
      },
    });

    return () => controls.stop();
  }, [target, prefersReducedMotion]);

  return display;
}
