'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';

// ogl builds a WebGL context on mount, so this must never run on the server.
const Aurora = dynamic(() => import('@/components/Aurora'), { ssr: false });

/** Tuned per theme: stops that read as "aurora" on black turn to mud on white. */
const STOPS_DARK: [string, string, string] = ['#2563eb', '#7c3aed', '#06b6d4'];
const STOPS_LIGHT: [string, string, string] = ['#60a5fa', '#a78bfa', '#67e8f9'];

/**
 * The aurora behind the chat pane.
 *
 * Decorative: `aria-hidden`, `pointer-events-none`, and masked so it fades in
 * from the top rather than sitting as a band behind the text.
 *
 * Two things it does that the vendored component does not:
 *
 * - It renders nothing under `prefers-reduced-motion`. For a full-surface
 *   shader, stopping the animation is not enough — the honest response is to
 *   not start a GPU render loop the user asked not to see.
 * Gated on mount. `resolvedTheme` is unknowable on the server, so anything
 * derived from it — opacity, colour stops — differs between the server HTML
 * and the first client render, which is a hydration mismatch. Rendering
 * nothing until mounted is free here: the aurora is decorative and its canvas
 * is client-only anyway.
 *
 * There is deliberately no pause-when-hidden logic: browsers already stop
 * `requestAnimationFrame` in a background tab, so it would buy nothing — and
 * an earlier attempt keyed on `document.hidden` hid the aurora permanently in
 * an embedded browser that reports itself hidden while visible.
 */
export function ChatBackdrop() {
  const prefersReducedMotion = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // `resolvedTheme` is unknowable on the server, so anything derived from it —
  // the opacity below, the colour stops — differs between the server HTML and
  // the first client render, which React reports as a hydration mismatch.
  // Rendering nothing until mounted costs nothing here: the aurora is purely
  // decorative and its canvas is client-only regardless.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted || prefersReducedMotion) return null;

  const dark = resolvedTheme === 'dark';

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent,black_30%)]"
      style={{ opacity: dark ? 0.9 : 0.55 }}
    >
      <Aurora
        colorStops={dark ? STOPS_DARK : STOPS_LIGHT}
        amplitude={1.1}
        blend={0.45}
        speed={0.4}
        lightMode={!dark}
      />
    </div>
  );
}
