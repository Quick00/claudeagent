import { useEffect, useRef, useState } from 'react';

const DEFAULT_DELAY_MS = 180;
const DEFAULT_MIN_DURATION_MS = 400;

interface UseDeferredSkeletonOptions {
  /** Time to wait after loading starts before showing the skeleton at all. */
  delay?: number;
  /** Once shown, the minimum time the skeleton stays visible. */
  minDuration?: number;
}

/**
 * Adds hysteresis to a fetch-driven loading flag so a skeleton placeholder
 * never flickers.
 *
 * Two well-established thresholds (Nielsen Norman / Material Design's
 * guidance on "instant" vs "perceptible" delay) drive this:
 *
 * - `delay` (180ms, default): loading has to persist past this before the
 *   skeleton shows at all. Anything under ~200ms reads as instant to a user,
 *   so a response that lands inside the window never shows a skeleton —
 *   the UI goes straight from nothing to content.
 * - `minDuration` (400ms, default): once the skeleton *has* appeared, it
 *   stays for at least this long even if the data already arrived, so it
 *   can never flash for a single frame — long enough to register as a
 *   deliberate state, short enough not to feel like padding.
 *
 * This hook is for CLIENT-SIDE fetch loading state only — a `useState` +
 * `useEffect(() => fetch(...))` pattern inside a component. It is not for
 * `loading.tsx` files: those are React Suspense fallbacks the server
 * controls during navigation/streaming, rendered before any client
 * JavaScript (including this hook) can run, so there is nothing for a
 * client hook to defer there.
 *
 * Implementation note: state is only ever updated inside `setTimeout`
 * callbacks, never synchronously inside the effect body, and every timer
 * is cleared on cleanup — so there is no "setState during an effect" that
 * the React Compiler's rules would flag, and no timer outlives its effect.
 */
export function useDeferredSkeleton(
  isLoading: boolean,
  options?: UseDeferredSkeletonOptions,
): boolean {
  const delay = options?.delay ?? DEFAULT_DELAY_MS;
  const minDuration = options?.minDuration ?? DEFAULT_MIN_DURATION_MS;

  const [showSkeleton, setShowSkeleton] = useState(false);
  // When the skeleton was actually shown (ms, from Date.now()), so the
  // "still loading when the timer fires" callback below can compute how
  // much of the minimum duration remains. Not read during render.
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      // Not visible yet: wait out the delay before showing it. If loading
      // resolves first, this timer is cleared by the cleanup below and the
      // skeleton is never shown.
      const showTimer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setShowSkeleton(true);
      }, delay);

      return () => clearTimeout(showTimer);
    }

    // Loading has stopped. If the skeleton was never shown, there is
    // nothing to hide and nothing to wait for.
    if (shownAtRef.current === null) {
      return;
    }

    const elapsed = Date.now() - shownAtRef.current;
    const remaining = Math.max(0, minDuration - elapsed);

    const hideTimer = setTimeout(() => {
      shownAtRef.current = null;
      setShowSkeleton(false);
    }, remaining);

    return () => clearTimeout(hideTimer);
  }, [isLoading, delay, minDuration]);

  return showSkeleton;
}
