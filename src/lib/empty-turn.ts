import * as Sentry from '@sentry/nextjs';

const MAX_TURNS_MESSAGE =
  'I ran out of steps before I could write an answer. Try asking a narrower question, or split it into parts.';
const GENERIC_MESSAGE = 'Something went wrong and I could not write an answer. Please try again.';

/** What the user is told when a Claude turn ends without any answer text. */
export function emptyTurnMessage(resultSubtype: string | null): string {
  return resultSubtype === 'error_max_turns' ? MAX_TURNS_MESSAGE : GENERIC_MESSAGE;
}

/** Reports a turn that ended without any answer text, shared by /api/chat and the admin send route. */
export function reportEmptyTurn(details: {
  resultSubtype: string | null;
  exitCode: number | null;
  droppedNotes: number;
  extra: Record<string, unknown>;
}) {
  Sentry.captureMessage('Claude turn ended without an answer', {
    level: 'error',
    tags: {
      resultSubtype: details.resultSubtype ?? 'none',
      exitCode: String(details.exitCode),
      droppedNotes: String(details.droppedNotes),
    },
    extra: details.extra,
  });
}
