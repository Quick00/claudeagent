import { hasSourceReference, stripSourceReferences } from '@/lib/sanitize-response';
import type { SseSink } from '@/lib/claude-process-stream';

// Identifiers with three or more humps: SessionTagLimit, getSessionLimit. Two
// humps are left alone so product names like HubSpot or LinkedIn survive.
const CODE_IDENTIFIER = /\b(?:[A-Z][a-z0-9]+|[a-z]+)(?:[A-Z][a-z0-9]+){2,}\b/;
// Repositories sit on disk under their GitLab project id, e.g. 16310549.
const LONG_NUMBER = /\b\d{6,}\b/;
const CODE_WORDS = /\b(?:repos?|repositor(?:y|ies)|codebases?|php|composer|npm|javascript|typescript|symfony|laravel|twig|controllers?|components?|endpoints?|middleware|schema|cron|grep|glob|regex|api)\b/i;

/**
 * Whether a note Claude wrote on its way to a tool call reads as code talk.
 * Such a note is dropped whole rather than stripped: it is never the answer,
 * and "OK, repo 16310549 = Eventinsight" has no plain-language remainder.
 * A false positive only costs a progress bubble.
 */
export function isLeakyNote(text: string): boolean {
  return (
    text.includes('`') ||
    hasSourceReference(text) ||
    CODE_IDENTIFIER.test(text) ||
    LONG_NUMBER.test(text) ||
    CODE_WORDS.test(text)
  );
}

/**
 * One stretch of answer text, to be rendered and stored as its own bubble.
 * `sentLength` is how much of the sanitized text has already gone out as
 * `text` frames, so a delta only ever streams the tail.
 */
type Segment = { raw: string; sentLength: number };

/**
 * The answer as bubbles: one per stretch of text between tool calls, streamed
 * to `sink` as `text` frames, sanitized, and split by `text_break`. A stretch
 * that ends at a tool call is a note; a leaky one is taken back with
 * `text_retract` and kept out of `contents()`.
 */
export function createAnswerSegments(sink: SseSink) {
  let segments: Segment[] = [{ raw: '', sentLength: 0 }];
  let current = segments[0];
  let droppedNotes = 0;

  return {
    append(delta: string) {
      current.raw += delta;
      const sanitized = stripSourceReferences(current.raw);
      // If sanitization shortened already-sent text, reset so
      // subsequent clean text isn't permanently dropped.
      if (sanitized.length < current.sentLength) {
        current.sentLength = sanitized.length;
      }
      const newContent = sanitized.slice(current.sentLength);
      if (newContent) {
        sink.send(JSON.stringify({ type: 'text', content: newContent }));
        current.sentLength = sanitized.length;
      }
    },

    /**
     * End the bubble being written and open the next: flush whatever of it
     * has not gone out yet, then announce the break — or, for a leaky note,
     * take it back and write the next bubble in its place.
     *
     * A no-op on a segment with no text, which is what keeps a tool fired
     * before any prose from opening an empty leading bubble — and what makes
     * it safe to call twice, as `attachClaudeProcess` does for every tool
     * (once from `content_block_start`, once from the complete `assistant`
     * event; see the ['Read', 'Read'] assertion in
     * claude-process-stream.test.ts). Emptiness is judged on the *sanitized*
     * text: a segment that was nothing but a stripped file path is no bubble.
     */
    closeAtTool() {
      const closing = stripSourceReferences(current.raw);
      if (!closing.trim()) return;
      if (isLeakyNote(current.raw)) {
        sink.send(JSON.stringify({ type: 'text_retract' }));
        current.raw = '';
        current.sentLength = 0;
        droppedNotes++;
        return;
      }
      const remaining = closing.slice(current.sentLength);
      if (remaining) {
        sink.send(JSON.stringify({ type: 'text', content: remaining }));
      }
      current.sentLength = closing.length;
      sink.send(JSON.stringify({ type: 'text_break' }));
      current = { raw: '', sentLength: 0 };
      segments.push(current);
    },

    /** Flush the tail of the open segment. Closed ones went out at their tool call. */
    flushOpen() {
      const finalCurrent = stripSourceReferences(current.raw);
      if (finalCurrent.length > current.sentLength) {
        sink.send(JSON.stringify({ type: 'text', content: finalCurrent.slice(current.sentLength) }));
        current.sentLength = finalCurrent.length;
      }
    },

    /**
     * The bubbles to store. A boundary lands exactly where trailing newlines
     * pile up, so trim — otherwise a bubble ends in a blank line. Empty
     * segments (a tool before any text, a tool after the last) never become rows.
     */
    contents(): string[] {
      return segments
        .map((segment) => stripSourceReferences(segment.raw).trim())
        .filter((content) => content.length > 0);
    },

    /** Drop the partial answer, e.g. when an error row is what the turn becomes. */
    reset() {
      segments = [{ raw: '', sentLength: 0 }];
      current = segments[0];
    },

    get rawLength() {
      return segments.reduce((n, s) => n + s.raw.length, 0);
    },
    get count() {
      return segments.length;
    },
    get droppedNotes() {
      return droppedNotes;
    },
  };
}
