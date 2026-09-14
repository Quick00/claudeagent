import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useDeferredSkeleton } from './use-deferred-skeleton';

const DELAY = 180;
const MIN_DURATION = 400;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useDeferredSkeleton', () => {
  test('does not show the skeleton immediately when loading starts', () => {
    const { result } = renderHook(() => useDeferredSkeleton(true));
    expect(result.current).toBe(false);
  });

  test('shows the skeleton once the delay elapses while still loading', () => {
    const { result } = renderHook(() => useDeferredSkeleton(true));

    act(() => {
      jest.advanceTimersByTime(DELAY);
    });

    expect(result.current).toBe(true);
  });

  test('loading resolves before the delay elapses: skeleton is never shown', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredSkeleton(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      jest.advanceTimersByTime(DELAY - 20);
    });
    expect(result.current).toBe(false);

    rerender({ isLoading: false });

    // Even after the original delay would have elapsed, it must never flip on.
    act(() => {
      jest.advanceTimersByTime(DELAY + MIN_DURATION + 100);
    });
    expect(result.current).toBe(false);
  });

  test('loading resolves just after the skeleton appears: it still stays for the minimum duration', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredSkeleton(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      jest.advanceTimersByTime(DELAY);
    });
    expect(result.current).toBe(true);

    // Data arrives almost immediately after the skeleton appeared.
    rerender({ isLoading: false });
    act(() => {
      jest.advanceTimersByTime(10);
    });
    expect(result.current).toBe(true);

    // Just before the minimum duration is up, it must still be visible.
    act(() => {
      jest.advanceTimersByTime(MIN_DURATION - 20);
    });
    expect(result.current).toBe(true);

    // Once the minimum has elapsed, it goes away.
    act(() => {
      jest.advanceTimersByTime(30);
    });
    expect(result.current).toBe(false);
  });

  test('loading flips true -> false -> true rapidly within the delay window without thrashing', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useDeferredSkeleton(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      jest.advanceTimersByTime(50);
    });
    rerender({ isLoading: false });
    act(() => {
      jest.advanceTimersByTime(10);
    });
    rerender({ isLoading: true });

    // Skeleton must never have appeared during that flicker.
    expect(result.current).toBe(false);

    // A fresh delay window starts from the latest loading=true.
    act(() => {
      jest.advanceTimersByTime(DELAY - 10);
    });
    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(result.current).toBe(true);
  });

  test('unmounting mid-delay clears the timer and never sets state', () => {
    const { unmount } = renderHook(() => useDeferredSkeleton(true));

    unmount();

    expect(() => {
      act(() => {
        jest.advanceTimersByTime(DELAY + MIN_DURATION + 100);
      });
    }).not.toThrow();
  });

  test('unmounting mid-minimum-duration clears the timer and never sets state', () => {
    const { result, rerender, unmount } = renderHook(({ isLoading }) => useDeferredSkeleton(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      jest.advanceTimersByTime(DELAY);
    });
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    unmount();

    expect(() => {
      act(() => {
        jest.advanceTimersByTime(MIN_DURATION + 100);
      });
    }).not.toThrow();
  });

  test('respects custom delay and minDuration options', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredSkeleton(isLoading, { delay: 50, minDuration: 100 }),
      { initialProps: { isLoading: true } },
    );

    act(() => {
      jest.advanceTimersByTime(49);
    });
    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    act(() => {
      jest.advanceTimersByTime(99);
    });
    expect(result.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  test('never shows the skeleton at all if loading is false throughout', () => {
    const { result } = renderHook(() => useDeferredSkeleton(false));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(false);
  });
});
