import { jest } from '@jest/globals';

/** Recorded, not drawn: jsdom has no canvas, and the tests assert on the calls. */
export const mockConfetti = jest.fn();

export default mockConfetti;
