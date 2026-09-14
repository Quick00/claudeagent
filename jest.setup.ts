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
