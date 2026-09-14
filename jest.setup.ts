import '@testing-library/jest-dom/jest-globals';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, jest } from '@jest/globals';

// jsdom implements none of these; Radix and the force graph all need them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/**
 * Make `:fullscreen` / `:modal` / `:picture-in-picture` cheap.
 *
 * nwsapi (jsdom's selector engine) resolves these by asking the *native*
 * matcher first — but under jsdom the native matcher IS nwsapi, so
 * `isFullscreen` re-enters itself until the stack overflows and nwsapi's
 * try/catch swallows the error. One Radix menu mount produced 33 million
 * `matches(':fullscreen')` calls and took ~8 seconds.
 *
 * jsdom implements none of these states, so answering `false` directly is
 * both correct here and what breaks the recursion. Everything else is
 * delegated untouched.
 */
const UNSUPPORTED_STATE_SELECTORS = new Set([
  ':fullscreen',
  ':modal',
  ':picture-in-picture',
]);

const nativeMatches = Element.prototype.matches;
Element.prototype.matches = function (selectors: string) {
  if (UNSUPPORTED_STATE_SELECTORS.has(selectors)) return false;
  return nativeMatches.call(this, selectors);
};

// jest-environment-jsdom ships neither encoder; the SSE reader needs both.
globalThis.TextDecoder ??= NodeTextDecoder as unknown as typeof globalThis.TextDecoder;
globalThis.TextEncoder ??= NodeTextEncoder as unknown as typeof globalThis.TextEncoder;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});
