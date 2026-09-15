/**
 * jsdom's `Location.assign` is a non-writable, non-configurable own
 * property, so no test can spy on or replace `window.location.assign`
 * directly. Routing every browser navigation through this one function gives
 * tests a seam to mock instead.
 */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
