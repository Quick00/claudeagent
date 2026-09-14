/**
 * Read an SSE `Response` body to the end and return its frames as parsed
 * objects. Shared by the route tests that assert on what the client would see.
 *
 * Not named `*.test.ts`, so the node project's `testMatch` leaves it alone.
 */
export async function drainSse<T = Record<string, unknown>>(res: Response): Promise<T[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)) as T);
}
